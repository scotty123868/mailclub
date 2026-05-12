-- Receiver-side postcard visibility — Phase 3.5
--
-- After Phase 3, a receiver who scans the QR has the sender added to their
-- friends rolodex, but the postcard itself isn't anywhere they can see in
-- the app. Map "Received" still hits an empty state. This migration:
--
--   1. Adds an RLS policy so a receiver can SELECT their own scanned
--      postcard_claims rows.
--   2. Adds a mirror RLS for the linked postcards row — so they can read
--      the message + photo_path of the card they received.
--   3. Adds `scanned_at` to postcards as a denormalized timestamp the
--      sender's app can read to display "Marcus opened your card on Apr 12"
--      without hitting postcard_claims directly.
--   4. Patches `record_reciprocation_scan` to write the scanned_at
--      timestamp through to the postcard so the sender's app sees it.

-- ---------------------------------------------------------------------------
-- 1. Receiver visibility on their own scanned claim rows
-- ---------------------------------------------------------------------------
-- Phase 3's only RLS policy on postcard_claims was for the SENDER. The
-- receiver (a different auth.uid()) needs to SELECT their claim row in
-- order to render the Received filter on Map. Limit to rows where the
-- current user IS the scanner.

drop policy if exists postcard_claims_receiver_select on public.postcard_claims;
create policy postcard_claims_receiver_select
  on public.postcard_claims for select
  using (scanned_by_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Receiver visibility on the underlying postcard row
-- ---------------------------------------------------------------------------
-- The postcards table's existing RLS only lets the SENDER see their own
-- rows. We add a second policy: if there's a scanned postcard_claims row
-- pointing at this postcard, and the current user is the scanner, they
-- can SELECT the postcard (message, photo_path, sent_at, etc.).

drop policy if exists postcards_receiver_select on public.postcards;
create policy postcards_receiver_select
  on public.postcards for select
  using (
    exists (
      select 1 from public.postcard_claims pc
      where pc.id = postcards.claim_id
        and pc.scanned_by_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Sender-side: scanned_at timestamp denormalized onto postcards
-- ---------------------------------------------------------------------------
-- The sender wants to see "Marcus opened your card on Apr 12" without
-- joining through postcard_claims. We denormalize the timestamp directly
-- onto the postcard row. Single writer (record_reciprocation_scan) so the
-- denormalization stays consistent.

alter table public.postcards
  add column if not exists scanned_at timestamptz;

create index if not exists postcards_scanned_at_idx
  on public.postcards (scanned_at)
  where scanned_at is not null;

-- ---------------------------------------------------------------------------
-- 4. Patch record_reciprocation_scan to write scanned_at to postcards
-- ---------------------------------------------------------------------------

create or replace function public.record_reciprocation_scan(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_claim record;
  v_postcard record;
  v_sender_profile record;
  v_friend_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, sender_id, sender_name_snapshot, sender_city_snapshot,
         expires_at, scanned_by_user_id, flavor
    into v_claim
    from public.postcard_claims
    where claim_token = p_token
    for update;

  if v_claim.id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_claim.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;
  if v_claim.sender_id = v_user_id then
    return jsonb_build_object('ok', false, 'reason', 'OWN_CARD');
  end if;

  if v_claim.scanned_by_user_id = v_user_id then
    select id into v_friend_id
      from public.friends
      where owner_id = v_user_id and source_user_id = v_claim.sender_id
      limit 1;
    return jsonb_build_object(
      'ok', true,
      'already_scanned', true,
      'friend_id', v_friend_id
    );
  end if;

  if v_claim.scanned_by_user_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_SCANNED_BY_OTHER');
  end if;

  update public.postcard_claims
    set scanned_by_user_id = v_user_id,
        scanned_at = now()
    where id = v_claim.id;

  -- Phase 3.5: denormalize scanned_at onto the postcard so the sender's
  -- app can render "Marcus opened your card" without joining through
  -- postcard_claims.
  update public.postcards
    set scanned_at = now()
    where claim_id = v_claim.id;

  select name, city, state, avatar_initials
    into v_sender_profile
    from public.profiles
    where id = v_claim.sender_id;

  select id into v_friend_id
    from public.friends
    where owner_id = v_user_id and source_user_id = v_claim.sender_id
    limit 1;

  if v_friend_id is null then
    insert into public.friends
      (owner_id, source_user_id, name, city, state, avatar_initials,
       connection_type, relationship_signal, signal_tone, last_interaction_at)
    values
      (v_user_id, v_claim.sender_id,
       coalesce(v_sender_profile.name, v_claim.sender_name_snapshot, 'Mailroom friend'),
       coalesce(v_sender_profile.city, v_claim.sender_city_snapshot, ''),
       coalesce(v_sender_profile.state, ''),
       coalesce(v_sender_profile.avatar_initials, 'MM'),
       'postcard-invite',
       'Sent you a postcard',
       'blue',
       now())
    returning id into v_friend_id;
  end if;

  select id, message, category, photo_path, sent_at
    into v_postcard
    from public.postcards
    where claim_id = v_claim.id;

  return jsonb_build_object(
    'ok', true,
    'already_scanned', false,
    'friend_id', v_friend_id,
    'sender_id', v_claim.sender_id,
    'sender_name', coalesce(v_sender_profile.name, v_claim.sender_name_snapshot),
    'sender_city', coalesce(v_sender_profile.city, v_claim.sender_city_snapshot),
    'postcard', jsonb_build_object(
      'id', v_postcard.id,
      'message', v_postcard.message,
      'category', v_postcard.category,
      'photo_path', v_postcard.photo_path,
      'sent_at', v_postcard.sent_at
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. fetch_received_postcards RPC — receiver-side feed
-- ---------------------------------------------------------------------------
-- The app's Map "Received" filter and Constellation will call this to list
-- the postcards the current user has received. Returns enough data to
-- render each card on the map + a list row: sender display, city for the
-- polyline, message preview, sent_at, and the photo_path so the client
-- can mint a signed URL.

create or replace function public.fetch_received_postcards()
returns table (
  postcard_id uuid,
  claim_id uuid,
  sender_id uuid,
  sender_name text,
  sender_city text,
  message text,
  category text,
  photo_path text,
  sent_at timestamptz,
  scanned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  return query
    select
      p.id as postcard_id,
      pc.id as claim_id,
      pc.sender_id,
      coalesce(prof.name, pc.sender_name_snapshot) as sender_name,
      coalesce(prof.city, pc.sender_city_snapshot) as sender_city,
      p.message,
      p.category,
      p.photo_path,
      p.sent_at,
      pc.scanned_at
    from public.postcard_claims pc
    join public.postcards p on p.claim_id = pc.id
    left join public.profiles prof on prof.id = pc.sender_id
    where pc.scanned_by_user_id = v_user_id
    order by pc.scanned_at desc nulls last;
end;
$$;

grant execute on function public.fetch_received_postcards() to authenticated;
