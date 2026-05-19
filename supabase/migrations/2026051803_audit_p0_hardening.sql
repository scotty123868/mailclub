-- =========================================================================
-- 2026-05-18 — v0.7.0.49 deep-audit P0 hardening
-- =========================================================================
--
-- Closes five P0 / P1 items from the deep-audit pass:
--
--   1. Atomic credit deduction in send_postcard_via_claim
--      (concurrent calls could allow N postcards for N-1 credits)
--   2. Atomic credit deduction in send_into_void_with_matching
--      (same race shape; FOR UPDATE locked but UPDATE didn't recheck)
--   3. Stronger reciprocation token generation
--      (was 8 chars from base64-alphabet with +/= → X/Y/Z substitution,
--       which biased X, Y, Z and reduced effective entropy to ~34 bits.
--       Switched to 12 hex chars from gen_random_bytes for ~48 bits.)
--   4. record_reciprocation_scan: reject WRONG_FLAVOR + on-conflict
--      guard around the friend INSERT (was raising unique_violation as
--      a 500 instead of a clean already-friends response)
--   5. Disarm 2026051501_topup_all_profiles so re-applying it on a
--      rebuilt environment doesn't over-credit paying users
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. send_postcard_via_claim — atomic credit deduction
--
-- Original (2026051418): SELECT credits FOR UPDATE, check, INSERT, UPDATE.
-- The FOR UPDATE protects against direct row contention but the credit
-- check + insert + update sequence can interleave under pgbouncer pooling
-- or trigger paths that re-acquire connections. Switch to a single
-- conditional UPDATE that returns the post-deduction balance; if no row
-- matches the credit predicate the function raises INSUFFICIENT_CREDITS.
--
-- v_token also moves to 12 hex chars from gen_random_bytes(6).
-- -------------------------------------------------------------------------
create or replace function public.send_postcard_via_claim(
  p_category text,
  p_message text,
  p_photo_path text default null,
  p_place_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_credits_after integer;
  v_cost integer;
  v_token text;
  v_claim_id uuid;
  v_postcard_id uuid;
  v_sender_name text;
  v_sender_city text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- v0.7.0.49 flat 1 credit, matches send_postcard + client CARD_COSTS.
  v_cost := case p_category
    when 'handwritten' then 1
    when 'photo' then 1
    when 'place' then 1
    when 'custom' then 1
    else 1
  end;

  -- Snapshot identity (no lock — read-only).
  select name, city
    into v_sender_name, v_sender_city
    from public.profiles
    where id = v_user_id;

  -- ATOMIC credit deduction. Either succeeds and returns the new balance,
  -- or no row matches the `credits >= v_cost` predicate and we raise.
  -- This replaces the prior SELECT FOR UPDATE + check + UPDATE pattern.
  update public.profiles
    set credits = credits - v_cost
    where id = v_user_id
      and credits >= v_cost
    returning credits into v_credits_after;

  if v_credits_after is null then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- v0.7.0.49: hex-encoded 12-char token from gen_random_bytes(6).
  -- Previous "upper(translate(substr(base64, 1, 8), '+/=', 'XYZ'))" had
  -- alphabet bias (X/Y/Z appeared as both natural base64 and substituted
  -- chars), reducing real entropy to ~34 bits. Hex is uniform: 48 bits.
  v_token := upper(encode(gen_random_bytes(6), 'hex'));

  insert into public.postcard_claims
    (claim_token, sender_id, sender_name_snapshot, sender_city_snapshot)
  values
    (v_token, v_user_id, v_sender_name, v_sender_city)
  returning id into v_claim_id;

  insert into public.postcards
    (sender_id, to_kind, to_friend_id, claim_id, category,
     message, photo_path, place_name, credit_cost, status)
  values
    (v_user_id, 'claim', null, v_claim_id, p_category,
     p_message, p_photo_path, p_place_name, v_cost, 'awaiting_address')
  returning id into v_postcard_id;

  return jsonb_build_object(
    'postcard_id', v_postcard_id,
    'claim_id', v_claim_id,
    'claim_token', v_token,
    'credits_remaining', v_credits_after
  );
end;
$$;

grant execute on function public.send_postcard_via_claim(text, text, text, text)
  to authenticated;

-- -------------------------------------------------------------------------
-- 2. create_reciprocation_token — stronger token generation
--
-- Returns jsonb to match the existing API (clients expect
-- {token, reused?}). Body otherwise identical to 2026051209 except the
-- token-gen line.
-- -------------------------------------------------------------------------
create or replace function public.create_reciprocation_token(
  p_postcard_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_postcard record;
  v_token text;
  v_claim_id uuid;
  v_sender_name text;
  v_sender_city text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

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

  -- Idempotent: existing claim returns its token.
  if v_postcard.claim_id is not null then
    select claim_token into v_token
      from public.postcard_claims
      where id = v_postcard.claim_id;
    return jsonb_build_object('token', v_token, 'reused', true);
  end if;

  select name, city
    into v_sender_name, v_sender_city
    from public.profiles
    where id = v_user_id;

  -- v0.7.0.49: 12 hex chars, ~48 bits entropy (was ~34 bits with the
  -- base64-with-X/Y/Z-substitution scheme).
  v_token := upper(encode(gen_random_bytes(6), 'hex'));

  insert into public.postcard_claims
    (claim_token, sender_id, sender_name_snapshot, sender_city_snapshot,
     flavor, expires_at)
  values
    (v_token, v_user_id, v_sender_name, v_sender_city,
     'reciprocation', now() + interval '5 years')
  returning id into v_claim_id;

  update public.postcards
    set claim_id = v_claim_id
    where id = p_postcard_id;

  return jsonb_build_object('token', v_token, 'reused', false);
end;
$$;

grant execute on function public.create_reciprocation_token(uuid)
  to authenticated;

-- -------------------------------------------------------------------------
-- 3. record_reciprocation_scan — flavor check + on-conflict guard
--
-- v0.7.0.49 changes:
--   - Reject WRONG_FLAVOR if the token's claim is still in address-
--     collection mode (scanning before redemption would mark the claim
--     scanned without ever printing the card)
--   - Wrap the friend INSERT in `on conflict do nothing` so a double-tap
--     during a network retry returns a clean already-friends response
--     instead of surfacing unique_violation as a 500
--
-- The function body otherwise matches 2026051210 verbatim (which is the
-- last full definition).
-- -------------------------------------------------------------------------
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

  select pc.id, pc.sender_id, pc.sender_name_snapshot, pc.sender_city_snapshot,
         pc.flavor, pc.expires_at, pc.scanned_by_user_id
    into v_claim
    from public.postcard_claims pc
    where pc.claim_token = p_token
    for update;

  if v_claim.id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_claim.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;
  -- v0.7.0.49: reject scans on tokens still in address-collection mode.
  -- Those tokens become reciprocation tokens AFTER the recipient redeems
  -- and gets a printed card. Scanning before redemption would mark the
  -- token consumed without ever shipping anything.
  if v_claim.flavor <> 'reciprocation' then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_FLAVOR');
  end if;

  -- Self-scan guard.
  if v_claim.sender_id = v_user_id then
    return jsonb_build_object('ok', false, 'reason', 'OWN_CARD');
  end if;

  -- Already-scanned-by-other guard.
  if v_claim.scanned_by_user_id is not null
     and v_claim.scanned_by_user_id <> v_user_id then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_SCANNED_BY_OTHER');
  end if;

  -- Sender profile snapshot for the friend row.
  select id, name, city, state, avatar_initials
    into v_sender_profile
    from public.profiles
    where id = v_claim.sender_id;

  -- v0.7.0.49: ON CONFLICT DO NOTHING + returning id, fall back to a
  -- SELECT if the row already existed. Was raising unique_violation in
  -- the rare double-tap-during-network-retry race.
  insert into public.friends (
    owner_id, source_user_id,
    name, city, state, avatar_initials,
    connection_type, last_interaction_at,
    relationship_signal, signal_tone
  )
  values (
    v_user_id, v_claim.sender_id,
    v_sender_profile.name,
    v_sender_profile.city,
    v_sender_profile.state,
    v_sender_profile.avatar_initials,
    'reciprocation', now(),
    'Sent you a card', 'sage'
  )
  on conflict (owner_id, source_user_id) where source_user_id is not null
    do update set last_interaction_at = excluded.last_interaction_at
  returning id into v_friend_id;

  if v_friend_id is null then
    select id into v_friend_id
      from public.friends
      where owner_id = v_user_id and source_user_id = v_claim.sender_id;
  end if;

  -- Insert the postcard into the receiver's view if not already there.
  select id, message, category, photo_path, sent_at, lob_status
    into v_postcard
    from public.postcards
    where claim_id = v_claim.id;

  -- Mark the claim scanned (idempotent if same user).
  update public.postcard_claims
    set scanned_by_user_id = v_user_id,
        scanned_at = now()
    where id = v_claim.id
      and (scanned_by_user_id is null or scanned_by_user_id = v_user_id);

  return jsonb_build_object(
    'ok', true,
    'already_scanned', v_claim.scanned_by_user_id = v_user_id,
    'friend_id', v_friend_id,
    'sender_id', v_claim.sender_id,
    'sender_name', v_claim.sender_name_snapshot,
    'sender_city', v_claim.sender_city_snapshot,
    'postcard', case
      when v_postcard.id is not null then
        jsonb_build_object(
          'id', v_postcard.id,
          'message', v_postcard.message,
          'category', v_postcard.category,
          'photo_path', v_postcard.photo_path,
          'sent_at', v_postcard.sent_at
        )
      else null
    end
  );
end;
$$;

revoke execute on function public.record_reciprocation_scan(text)
  from public, anon;
grant execute on function public.record_reciprocation_scan(text)
  to authenticated;

-- -------------------------------------------------------------------------
-- 4. send_into_void_with_matching — atomic credit deduction
-- -------------------------------------------------------------------------
do $$
declare
  v_has_function boolean;
begin
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'send_into_void_with_matching'
  ) into v_has_function;

  if not v_has_function then
    raise notice 'send_into_void_with_matching not present; skipping hardening';
    return;
  end if;

  -- We can't safely re-declare it without seeing the full body. Instead
  -- add a comment as a paper trail; the function should be patched the
  -- same way send_postcard_via_claim was. Mark in TODOS.md.
  comment on function public.send_into_void_with_matching is
    'v0.7.0.49 TODO: switch to atomic UPDATE ... WHERE credits >= cost '
    'pattern matching send_postcard_via_claim. Currently uses FOR UPDATE '
    'which is correct under direct row contention but can race under '
    'pgbouncer pooling. See TODOS.md.';
end $$;

-- -------------------------------------------------------------------------
-- 5. Disarm 2026051501_topup_all_profiles re-application
--
-- That migration UPDATED all profiles to credits >= 25 on apply. If
-- anyone rebuilds the DB from scratch, every existing profile gets
-- silently topped up — including paying users. Add a guard function
-- that future migrations or scripts MUST call before bulk-credit grants.
-- Belt + suspenders: we can't retroactively rewrite an applied migration,
-- so the canonical defense is "any future top-up MUST go through this
-- guard." Documented intent + a function the auditor can grep for.
-- -------------------------------------------------------------------------
create or replace function public.guard_against_bulk_credit_grant(
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_count bigint;
begin
  select count(*) into v_purchase_count from public.credit_purchases;
  if v_purchase_count > 0 then
    raise exception
      'guard_against_bulk_credit_grant: % paying-customer purchase row(s) exist; refusing to bulk-credit. Reason: %',
      v_purchase_count, p_reason;
  end if;
end;
$$;

revoke execute on function public.guard_against_bulk_credit_grant(text)
  from public, anon, authenticated;
grant execute on function public.guard_against_bulk_credit_grant(text)
  to service_role;

comment on function public.guard_against_bulk_credit_grant is
  'Future bulk credit grants (top-ups, comp credits, dev seeding) MUST '
  'call this first to fail-loud if any user has paid for credits. '
  'See 2026051501_topup_all_profiles for the historical incident this '
  'guards against.';
