-- Reciprocation tokens — the QR-on-the-back viral loop.
--
-- Every Mailroom-printed postcard carries a QR code on the back. The receiver
-- scans it with their iPhone camera, lands in the app (or web fallback), and
-- gets a pre-onboarded experience:
--   • Sender is already in their friends rolodex
--   • The postcard is already in their received map
--   • A "send one back, free" CTA primes the loop
--
-- This is the v0.5.0 Phase 3 unlock for organic growth.
--
-- ---------------------------------------------------------------------------
-- 0. Pre-flight schema alignment
-- ---------------------------------------------------------------------------
-- Earlier migrations (2026051206 lob_postcards_trigger, 2026051208
-- postcard_claims) reference postcards.sender_id and postcards.photo_path,
-- but the initial schema (2026051200) defines those columns as owner_id and
-- photo_uri. Either the earlier migrations never ran cleanly on a fresh DB,
-- or the schema was patched manually outside of migration history. Be
-- self-healing: rename to the new names if needed, and add 'queued' +
-- 'awaiting_address' to the status check constraint so redeem_postcard_claim
-- (in 2026051208) and create_reciprocation_token below both work.

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'postcards' and column_name = 'owner_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'postcards' and column_name = 'sender_id'
  ) then
    alter table public.postcards rename column owner_id to sender_id;
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'postcards' and column_name = 'photo_uri'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'postcards' and column_name = 'photo_path'
  ) then
    alter table public.postcards rename column photo_uri to photo_path;
  end if;
end $$;

-- Loosen the status check so the magic-link flow can transition through
-- 'awaiting_address' → 'queued' and Lob can move it to 'in_transit'/'returned'.
do $$ begin
  alter table public.postcards drop constraint if exists postcards_status_check;
  alter table public.postcards
    add constraint postcards_status_check
    check (status in (
      'draft', 'sent', 'delivered',
      'queued', 'awaiting_address',
      'in_transit', 'returned'
    ));
exception
  when undefined_table then null;
end $$;

-- ---------------------------------------------------------------------------
-- Phase 3 design notes
-- ---------------------------------------------------------------------------
-- One claim row per send, never both flavors at once. Address-collection
-- claims become reciprocation claims by flipping the flavor after the
-- recipient submits their address (so the printed card still has a working
-- QR — same token, different mode).

-- ---------------------------------------------------------------------------
-- 1. Schema extensions
-- ---------------------------------------------------------------------------

alter table public.postcard_claims
  add column if not exists flavor text not null default 'address_collection';

do $$ begin
  alter table public.postcard_claims
    add constraint postcard_claims_flavor_check
    check (flavor in ('address_collection', 'reciprocation'));
exception
  when duplicate_object then null;
end $$;

-- The Mailroom user who scanned the QR. NULL until someone scans.
-- Distinct from sender_id (who created the token) and from claimed_at
-- (which is only used by address-collection flavor).
alter table public.postcard_claims
  add column if not exists scanned_by_user_id uuid
    references public.profiles (id) on delete set null;

alter table public.postcard_claims
  add column if not exists scanned_at timestamptz;

-- Index for the "did I scan this token?" lookup the receiver app does on
-- re-open. Sparse so it stays cheap as most rows have NULL here.
create index if not exists postcard_claims_scanned_by_user_id_idx
  on public.postcard_claims (scanned_by_user_id)
  where scanned_by_user_id is not null;

-- ---------------------------------------------------------------------------
-- 1b. Friends table extension — track source_user_id so we know which
--     friends came from QR scans. Added BEFORE record_reciprocation_scan
--     so the function compiles cleanly against the new column.
-- ---------------------------------------------------------------------------
alter table public.friends
  add column if not exists source_user_id uuid
    references public.profiles (id) on delete set null;

create index if not exists friends_source_user_id_idx
  on public.friends (source_user_id)
  where source_user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. create_reciprocation_token RPC — called from the app at send time for
--    DIRECT-ADDRESS sends (the sender already knows the recipient's address).
--    For magic-link sends, the existing send_postcard_via_claim already
--    creates a row; this RPC instead flips that row's flavor to
--    'reciprocation' after the recipient claims their address (handled by
--    the redeem path; see RPC 4 below).
-- ---------------------------------------------------------------------------
create or replace function public.create_reciprocation_token(
  p_postcard_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_postcard record;
  v_token text;
  v_claim_id uuid;
  v_sender_name text;
  v_sender_city text;
  attempt integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Verify the postcard exists + belongs to this user + has no existing claim
  -- (which would happen on a magic-link send; that row already exists)
  select id, sender_id, claim_id
    into v_postcard
    from public.postcards
    where id = p_postcard_id
    for update;

  if v_postcard.id is null then
    raise exception 'POSTCARD_NOT_FOUND';
  end if;
  if v_postcard.sender_id <> v_user_id then
    raise exception 'NOT_OWNER';
  end if;

  -- If a claim row already exists (magic-link path), no-op — that token
  -- will become the reciprocation token after the recipient claims their
  -- address. Return the existing token.
  if v_postcard.claim_id is not null then
    select claim_token into v_token
      from public.postcard_claims
      where id = v_postcard.claim_id;
    return jsonb_build_object(
      'token', v_token,
      'reused', true
    );
  end if;

  -- Fetch sender display snapshot to freeze on the claim row.
  select name, city
    into v_sender_name, v_sender_city
    from public.profiles
    where id = v_user_id;

  -- Generate an 8-char base32 token + retry up to 5 times on the (very
  -- unlikely) collision against the unique claim_token constraint. Token
  -- space is 32^8 ≈ 1.1T so collisions are vanishingly rare, but a unique
  -- violation here would silently print a card without a working QR, which
  -- is the kind of small embarrassment worth defending against.
  for attempt in 1..5 loop
    v_token := upper(
      translate(
        substr(encode(gen_random_bytes(8), 'base64'), 1, 8),
        '+/=', 'XYZ'
      )
    );

    begin
      insert into public.postcard_claims
        (claim_token, sender_id, sender_name_snapshot, sender_city_snapshot,
         flavor, expires_at)
      values
        (v_token, v_user_id, v_sender_name, v_sender_city,
         'reciprocation',
         -- Reciprocation tokens last 5 years (postcards live on receivers'
         -- desks for years; want the QR to keep working).
         now() + interval '5 years')
      returning id into v_claim_id;
      exit; -- success
    exception
      when unique_violation then
        if attempt = 5 then raise; end if;
        -- Continue loop with a fresh token
    end;
  end loop;

  -- Point the postcard at the new claim row.
  update public.postcards
    set claim_id = v_claim_id
    where id = p_postcard_id;

  return jsonb_build_object(
    'token', v_token,
    'reused', false,
    'claim_id', v_claim_id
  );
end;
$$;

comment on function public.create_reciprocation_token is
  'App calls this for direct-address sends to mint the QR token embedded on '
  'the printed postcard back. For magic-link sends, the existing claim row '
  'is reused — it transitions to reciprocation flavor after redemption.';

grant execute on function public.create_reciprocation_token(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. lookup_reciprocation RPC — receiver app calls this with the QR token to
--    fetch sender display info + postcard preview. No auth required so the
--    web fallback page can call it too.
-- ---------------------------------------------------------------------------
create or replace function public.lookup_reciprocation(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim record;
  v_postcard record;
begin
  select pc.id, pc.sender_id, pc.sender_name_snapshot, pc.sender_city_snapshot,
         pc.flavor, pc.expires_at, pc.scanned_by_user_id
    into v_claim
    from public.postcard_claims pc
    where pc.claim_token = p_token;

  if v_claim.id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_claim.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;

  -- Fetch the postcard for preview. For address-collection-flavor tokens
  -- that haven't been claimed yet, the QR isn't on a physical card yet —
  -- but we still surface the preview so the web claim page works.
  select message, category, photo_path, sent_at, lob_status
    into v_postcard
    from public.postcards
    where claim_id = v_claim.id;

  return jsonb_build_object(
    'ok', true,
    'flavor', v_claim.flavor,
    'sender_name', v_claim.sender_name_snapshot,
    'sender_city', v_claim.sender_city_snapshot,
    'message_preview', left(v_postcard.message, 280),
    'category', v_postcard.category,
    'photo_path', v_postcard.photo_path,
    'sent_at', v_postcard.sent_at,
    'lob_status', v_postcard.lob_status,
    'already_scanned', v_claim.scanned_by_user_id is not null
  );
end;
$$;

revoke execute on function public.lookup_reciprocation(text)
  from public, authenticated, anon;
grant execute on function public.lookup_reciprocation(text)
  to service_role, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. record_reciprocation_scan RPC — receiver taps "Send one back" / opens
--    the app at /welcome-mail/[token]. Marks the token scanned, creates a
--    friendship from receiver → sender (if not already friends), and
--    inserts the postcard into the receiver's received list for their map.
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

  -- Reject self-scans (sender shouldn't be able to add themselves as their
  -- own friend by scanning their own card).
  if v_claim.sender_id = v_user_id then
    return jsonb_build_object('ok', false, 'reason', 'OWN_CARD');
  end if;

  -- If already scanned by THIS user, return the existing friend reference.
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

  -- Mark scanned. First-write-wins — a token can only seed ONE friendship.
  -- Subsequent scans from other users return ALREADY_SCANNED_BY_OTHER.
  if v_claim.scanned_by_user_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_SCANNED_BY_OTHER');
  end if;

  update public.postcard_claims
    set scanned_by_user_id = v_user_id,
        scanned_at = now()
    where id = v_claim.id;

  -- Pull the sender's current display info (may have updated since the
  -- snapshot, in which case we prefer the latest — receiver should see the
  -- sender's actual name).
  select name, city, state, avatar_initials
    into v_sender_profile
    from public.profiles
    where id = v_claim.sender_id;

  -- Insert a friend row from receiver → sender. If the friends table has a
  -- unique (owner_id, source_user_id) constraint, ON CONFLICT no-ops. If it
  -- doesn't, the IF NOT EXISTS guard below covers it.
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

  -- Pull the postcard for return payload so the app can render the received
  -- card immediately in the welcome screen.
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

comment on function public.record_reciprocation_scan is
  'Receiver app calls this after scanning the QR on a Mailroom postcard. '
  'Marks the token scanned, creates a friend row from receiver to sender, '
  'and returns enough data to render the welcome hero. First scan wins.';

grant execute on function public.record_reciprocation_scan(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Flavor flip on redeem — when an address-collection claim is redeemed
--    (recipient submits their address), the token's flavor transitions to
--    'reciprocation' so the QR on the eventually-printed card still works.
--    Patch the existing redeem_postcard_claim RPC to do the flip.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_postcard_claim(
  p_claim_token text,
  p_name text,
  p_address_line1 text,
  p_city text,
  p_state text,
  p_zip text,
  p_address_line2 text default null,
  p_country text default 'US'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id uuid;
  v_postcard_id uuid;
  v_already_claimed timestamptz;
  v_expired boolean;
begin
  select id, claimed_at, (expires_at < now())
    into v_claim_id, v_already_claimed, v_expired
    from public.postcard_claims
    where claim_token = p_claim_token;

  if v_claim_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_already_claimed is not null then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
  end if;
  if v_expired then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;

  update public.postcard_claims
    set claimed_at = now(),
        claimed_name = p_name,
        claimed_address_line1 = p_address_line1,
        claimed_address_line2 = p_address_line2,
        claimed_city = p_city,
        claimed_state = p_state,
        claimed_zip = p_zip,
        claimed_country = p_country,
        -- Phase 3: extend lifetime to 5 years now that the token's job is
        -- reciprocation (printed QR on the recipient's desk for years).
        expires_at = now() + interval '5 years',
        -- Phase 3: flip flavor so the QR scan path works post-print.
        flavor = 'reciprocation'
    where id = v_claim_id;

  update public.postcards
    set status = 'queued'
    where claim_id = v_claim_id
    returning id into v_postcard_id;

  return jsonb_build_object(
    'ok', true,
    'claim_id', v_claim_id,
    'postcard_id', v_postcard_id
  );
end;
$$;

revoke execute on function public.redeem_postcard_claim(text, text, text, text, text, text, text, text)
  from public, authenticated, anon;
grant execute on function public.redeem_postcard_claim(text, text, text, text, text, text, text, text)
  to service_role;
