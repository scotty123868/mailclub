-- Pen pal mechanic: real matching pool + send_postcard_sms accepting
-- direct addresses (so stranger sends don't need to create friend rows
-- with PII the sender shouldn't see).
--
-- Architecture:
--   1. profiles.home_line1 + home_zip + city + state are required to be
--      in the pool (collected in round 14 via the sender address ask).
--      Sending via penpal mode auto-opts you in.
--   2. pen_pal_pairings logs every sender → recipient match. Used for:
--      - Tracking who's been paired with whom (avoid repeats)
--      - Reciprocation routing (when the recipient later sends, route
--        back to the original sender)
--      - Rate-limit (don't bomb one user with all the incoming cards)
--   3. match_pen_pal(sender_id) RPC picks a recipient: opted-in,
--      not the sender themselves, hasn't received in the last 7 days,
--      not previously paired with this sender. Random.
--   4. send_postcard_sms_direct() accepts inline address fields so we
--      don't need to materialize a friend record for the stranger.
--      The recipient never appears in the sender's friends list.

------------------------------------------------------------
-- 1. pen_pal_pairings
------------------------------------------------------------

create table if not exists public.pen_pal_pairings (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  postcard_id uuid references public.postcards(id) on delete set null,
  paired_at timestamptz not null default now(),
  -- True once the recipient has sent a card back to this sender via
  -- the reciprocation flow. Used to mark the loop "closed."
  reciprocated_at timestamptz,
  constraint pen_pal_pairings_no_self check (sender_id <> recipient_id)
);

create index if not exists pen_pal_pairings_sender_idx
  on public.pen_pal_pairings(sender_id, paired_at desc);

create index if not exists pen_pal_pairings_recipient_idx
  on public.pen_pal_pairings(recipient_id, paired_at desc);

comment on table public.pen_pal_pairings is
  'Every stranger pairing the bot has matched. Reciprocation routes back '
  'via this table: when the recipient later sends a card, we look up '
  'their most-recent pairing to find the original sender.';

------------------------------------------------------------
-- 2. profiles.accepts_strangers opt-in flag
------------------------------------------------------------

alter table public.profiles
  add column if not exists accepts_strangers boolean not null default false;

alter table public.profiles
  add column if not exists last_received_stranger_at timestamptz;

comment on column public.profiles.accepts_strangers is
  'True when the user has opted into the pen pal pool. Set automatically '
  'on their first stranger send (the act of sending TO a stranger implies '
  'willingness to receive). Can be toggled off via the bot keyword PAUSE.';

------------------------------------------------------------
-- 3. match_pen_pal RPC
------------------------------------------------------------

create or replace function public.match_pen_pal(p_sender_id uuid)
returns table (
  recipient_id uuid,
  recipient_line1 text,
  recipient_line2 text,
  recipient_city text,
  recipient_state text,
  recipient_zip text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Pick an eligible recipient:
  --   1. opted in (accepts_strangers = true)
  --   2. has full home address on file
  --   3. not the sender themselves
  --   4. hasn't received a stranger card in the last 7 days (cool-down)
  --   5. not previously paired with this sender (avoid repeats)
  -- Order by least-recently-received-from-anyone to keep distribution even,
  -- random tiebreaker for fairness.
  return query
    select
      pr.id as recipient_id,
      pr.home_line1 as recipient_line1,
      pr.home_line2 as recipient_line2,
      pr.city as recipient_city,
      pr.state as recipient_state,
      pr.home_zip as recipient_zip
    from public.profiles pr
    where pr.accepts_strangers = true
      and pr.home_line1 is not null
      and pr.home_zip is not null
      and pr.city is not null
      and pr.state is not null
      and pr.id <> p_sender_id
      and (
        pr.last_received_stranger_at is null
        or pr.last_received_stranger_at < now() - interval '7 days'
      )
      and not exists (
        select 1 from public.pen_pal_pairings pp
        where pp.sender_id = p_sender_id
          and pp.recipient_id = pr.id
          and pp.paired_at > now() - interval '90 days'
      )
    order by
      coalesce(pr.last_received_stranger_at, '1970-01-01'::timestamptz) asc,
      random()
    limit 1;
end;
$$;

grant execute on function public.match_pen_pal(uuid) to service_role;

comment on function public.match_pen_pal(uuid) is
  'Returns one eligible pen pal recipient for the given sender, or no rows '
  'if the pool is empty. Caller should also insert into pen_pal_pairings '
  'and update profiles.last_received_stranger_at after a successful match.';

------------------------------------------------------------
-- 4. send_postcard_sms_direct — direct-address variant
------------------------------------------------------------
--
-- Mirrors send_postcard_sms but skips the friend_id requirement.
-- Used by the pen pal flow: we want to mail to a specific address
-- without materializing a friends row (which would expose the
-- stranger's PII to the sender).

create or replace function public.send_postcard_sms_direct(
  p_user_id uuid,
  p_message text,
  p_photo_path text,
  p_to_line1 text,
  p_to_line2 text,
  p_to_city text,
  p_to_state text,
  p_to_zip text,
  p_from_city text default '',
  p_scheduled_send_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_cost integer := 1;
  v_postcard_id uuid;
  v_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select credits into v_credits from public.profiles where id = p_user_id;
  if v_credits is null or v_credits < v_cost then
    raise exception 'insufficient_credits' using
      detail = format('user has %s, needs %s', coalesce(v_credits, 0), v_cost);
  end if;

  v_status := case
    when p_scheduled_send_at is not null and p_scheduled_send_at > now()
      then 'scheduled'
    else 'sent'
  end;

  insert into public.postcards (
    sender_id, to_kind, to_friend_id,
    from_city, to_city, category,
    credit_cost, status, message, photo_path,
    sms_origin, scheduled_send_at,
    -- Inline recipient address — bypasses the friends table for privacy.
    to_address_line1, to_address_line2, to_address_state, to_address_zip
  ) values (
    p_user_id, 'stranger', null,
    p_from_city, p_to_city, 'photo',
    v_cost, v_status, p_message, p_photo_path,
    true, p_scheduled_send_at,
    p_to_line1, p_to_line2, p_to_state, p_to_zip
  )
  returning id into v_postcard_id;

  update public.profiles
    set credits = credits - v_cost
    where id = p_user_id;

  insert into public.credit_transactions (owner_id, delta, reason, postcard_id)
    values (p_user_id, -v_cost, 'send_postcard_sms_direct', v_postcard_id);

  return v_postcard_id;
end
$$;

grant execute on function public.send_postcard_sms_direct(
  uuid, text, text, text, text, text, text, text, text, timestamptz
) to service_role;

comment on function public.send_postcard_sms_direct(
  uuid, text, text, text, text, text, text, text, text, timestamptz
) is
  'Direct-address postcard send. Used by pen pal mode to mail without '
  'materializing a friend row, so the recipient stays private to the sender.';

------------------------------------------------------------
-- 5. Schema extensions: postcards inline-address columns + to_kind enum
------------------------------------------------------------
--
-- These columns may already exist from earlier iterations. add-if-missing.

alter table public.postcards
  add column if not exists to_address_line1 text;

alter table public.postcards
  add column if not exists to_address_line2 text;

alter table public.postcards
  add column if not exists to_address_state text;

alter table public.postcards
  add column if not exists to_address_zip text;

-- to_kind already exists with historical values ('friend', 'claim', 'void').
-- Union the new 'stranger' value with the existing ones so we don't break
-- prior rows.
do $$
begin
  alter table public.postcards drop constraint if exists postcards_to_kind_check;
exception when others then null;
end$$;

alter table public.postcards
  add constraint postcards_to_kind_check check (to_kind in ('friend', 'claim', 'void', 'stranger'));
