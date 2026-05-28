-- v0.7.0.28. Postcrossing-style pen pal matching.
--
-- User spec: "I want the stranger mechanism to be the same as
-- Postcrossing so you get a card from a different stranger regardless."
--
-- Architecture:
--
--   penpal_queue table tracks users waiting to receive a stranger
--   card. Every time anyone sends a pen pal (to_kind='void'), the RPC:
--     1) Pops the oldest queue entry whose user_id ≠ current sender
--     2) Sets the new postcard's to_profile_id to that matched user
--     3) Inserts a new queue entry for the current sender
--
--   The matched user is now eligible to receive (the postcard row
--   they'll see in their journal has to_profile_id = their id, and
--   the SELECT policy below grants them read access).
--
--   Edge case. empty queue: first sender ever. Their postcard has
--   to_profile_id = null (orphan). They get queued. Next sender
--   fulfills the orphan: that sender's card is matched to the
--   first user, AND the first user's orphan gets retroactively
--   assigned. From two-users-deep onward, every send fulfills.
--
--   Addresses: Lob shipping is server-controlled. For now, the
--   matched recipient row carries to_profile_id but doesn't ship
--   physically until we wire address sharing for stranger receives
--   (a separate opt-in flow, build 45+). The journal renders inbound
--   stranger cards regardless.

-- ---------------------------------------------------------------------------
-- 1. Schema additions
-- ---------------------------------------------------------------------------

-- Matched recipient. NULL for orphan sends (no one in queue when sent)
-- or for non-void sends (friend/claim/self continue to use to_friend_id).
alter table public.postcards
  add column if not exists to_profile_id uuid references auth.users(id) on delete set null;

create index if not exists postcards_to_profile_id_idx
  on public.postcards (to_profile_id)
  where to_profile_id is not null;

-- Queue of users waiting to receive a stranger card.
-- One row per pending receive. user_id has NO uniqueness. a user can
-- have multiple pending receives if they've sent multiple pen pals
-- before getting matched.
create table if not exists public.penpal_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  queued_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  fulfilled_postcard_id uuid references public.postcards(id) on delete set null
);

create index if not exists penpal_queue_pending_idx
  on public.penpal_queue (queued_at)
  where fulfilled_at is null;

create index if not exists penpal_queue_user_idx
  on public.penpal_queue (user_id);

alter table public.penpal_queue enable row level security;

-- Read-your-own queue entries (the client can show "you're waiting on
-- N stranger cards"). Insert + update happens via security-definer RPCs.
create policy penpal_queue_select_own
  on public.penpal_queue for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. RLS: receiver can SELECT postcards where they're the to_profile_id
-- ---------------------------------------------------------------------------
-- The existing postcards SELECT policy allows sender_id = auth.uid().
-- Add a parallel policy for stranger-matched receivers.

drop policy if exists postcards_select_stranger_recipient on public.postcards;
create policy postcards_select_stranger_recipient
  on public.postcards for select
  using (to_profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Matching RPC. extends send_postcard for to_kind='void'
-- ---------------------------------------------------------------------------
-- Rather than rewrite send_postcard (which has 9 parameters and is
-- called from sendPostcardAction for friend sends too), introduce a
-- dedicated send_into_void_with_matching RPC that wraps the
-- queue-pop + insert + queue-push as a single transaction.
--
-- The client's sendIntoVoid() API call will be updated to call this
-- new RPC instead of the legacy send_postcard with p_to_kind='void'.

create or replace function public.send_into_void_with_matching(
  p_message text,
  p_photo_path text default null,
  p_category text default 'handwritten'
) returns public.postcards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid := auth.uid();
  v_credits integer;
  v_cost integer := 1;
  v_from_city text;
  v_matched_user_id uuid;
  v_matched_queue_id uuid;
  v_result public.postcards;
begin
  if v_sender_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Credit check
  select credits into v_credits
    from public.profiles
    where id = v_sender_id
    for update;
  if v_credits is null or v_credits < v_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- Sender's city for the postcard's from_city field.
  select city into v_from_city
    from public.profiles
    where id = v_sender_id;

  -- ----- The matching step -----
  -- Pop the oldest unfulfilled queue entry whose user_id != sender.
  -- FOR UPDATE SKIP LOCKED so concurrent sends can both fulfill
  -- without blocking on each other. LIMIT 1 ensures we only grab
  -- one match per send.
  select id, user_id
    into v_matched_queue_id, v_matched_user_id
    from public.penpal_queue
    where fulfilled_at is null
      and user_id <> v_sender_id
    order by queued_at asc
    limit 1
    for update skip locked;
  -- If no match, v_matched_user_id is null → postcard becomes an
  -- orphan that the NEXT pen pal sender will inherit (see below).

  -- Insert the postcard. to_profile_id is the matched receiver (may
  -- be null for orphans).
  insert into public.postcards (
    sender_id,
    to_kind,
    to_friend_id,
    to_profile_id,
    from_city,
    to_city,
    category,
    credit_cost,
    message,
    photo_path,
    status
  ) values (
    v_sender_id,
    'void',
    null,
    v_matched_user_id,
    coalesce(v_from_city, ''),
    '',
    p_category,
    v_cost,
    p_message,
    p_photo_path,
    'sent'
  )
  returning * into v_result;

  -- If we matched someone, mark their queue entry fulfilled.
  if v_matched_queue_id is not null then
    update public.penpal_queue
      set fulfilled_at = now(),
          fulfilled_postcard_id = v_result.id
      where id = v_matched_queue_id;
  end if;

  -- ----- Retro-fulfill any orphans waiting on us -----
  -- If THIS sender previously sent an orphan (to_profile_id is null,
  -- they fulfilled no one), AND we're now matching them on the
  -- inbound side (via THEIR queue entry just popped above), we leave
  -- the old orphan as-is. The orphan's recipient gets assigned the
  -- NEXT time someone else sends and we pop it from the queue.
  --
  -- More aggressive: when v_matched_user_id is non-null, also
  -- update the matched_user's PREVIOUS orphan (their oldest
  -- to_profile_id IS NULL postcard) to point to this sender. That
  -- closes the loop in two sends rather than three.
  if v_matched_user_id is not null then
    update public.postcards
      set to_profile_id = v_sender_id
      where id = (
        select id from public.postcards
        where sender_id = v_matched_user_id
          and to_kind = 'void'
          and to_profile_id is null
        order by sent_at asc
        limit 1
      );
  end if;

  -- Add the current sender to the queue so they receive next.
  insert into public.penpal_queue (user_id)
    values (v_sender_id);

  -- Charge credits, log the transaction.
  insert into public.credit_transactions (owner_id, delta, reason, postcard_id)
    values (v_sender_id, -v_cost, 'send_postcard', v_result.id);

  update public.profiles
    set credits = credits - v_cost
    where id = v_sender_id;

  return v_result;
end;
$$;

grant execute on function public.send_into_void_with_matching(
  text, text, text
) to authenticated;
