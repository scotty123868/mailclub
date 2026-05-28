-- ===========================================================================
-- 2026-05-21 v0.7.0.58. create_reciprocation_token: allow service_role calls
-- ===========================================================================
--
-- BUG WE'RE FIXING:
--   When lob-send-postcard renders the back HTML for a claim-mode postcard
--   (send-via-link flow), it calls create_reciprocation_token to mint the
--   QR code's URL. The Edge Function uses the SERVICE_ROLE key, so
--   auth.uid() is null inside the RPC. The existing function raised
--   "Not authenticated" and the catch block in lob-send-postcard swallowed
--   it silently. Net effect: claim-mode postcards shipped with the QR +
--   "Respond to {senderFirstName} with a postcard for free" block
--   completely missing on the back.
--
-- FIX:
--   Replace the auth.uid()-only gate with a two-mode check:
--     - User JWT call: caller's auth.uid() must equal postcards.sender_id
--     - Service-role call: trusted; sender identity comes from the
--       postcard row itself
--   The sender_id used for the new postcard_claims row + the profile
--   lookup now comes from `v_postcard.sender_id` rather than auth.uid(),
--   so both paths land on the same authoritative source.
-- ===========================================================================

create or replace function public.create_reciprocation_token(
  p_postcard_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  -- request.jwt.claims is the standard pgrest+supabase context. Service-
  -- role calls set role='service_role' in the claims. anon/authenticated
  -- calls have a real auth.uid().
  v_role text := nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  );
  v_postcard record;
  v_token text;
  v_claim_id uuid;
  v_sender_name text;
  v_sender_city text;
begin
  -- v0.7.0.58: load the postcard FIRST so the auth checks below can use
  -- its sender_id as the authoritative source.
  select id, sender_id, claim_id
    into v_postcard
    from public.postcards
    where id = p_postcard_id
    for update;

  if v_postcard.id is null then
    raise exception 'POSTCARD_NOT_FOUND';
  end if;

  -- Authn/Authz:
  --   - service_role: trusted (internal call from lob-send-postcard).
  --   - authenticated user: must own the postcard.
  --   - anon / unknown: rejected.
  if v_role = 'service_role' then
    -- pass-through, no further check
    null;
  elsif v_user_id is null then
    raise exception 'Not authenticated';
  elsif v_postcard.sender_id <> v_user_id then
    raise exception 'NOT_OWNER';
  end if;

  -- Idempotent: postcards already linked to a claim return that claim's
  -- token (which is what the recipient already saw + uses, so we want it
  -- on the QR too).
  if v_postcard.claim_id is not null then
    select claim_token into v_token
      from public.postcard_claims
      where id = v_postcard.claim_id;
    return jsonb_build_object('token', v_token, 'reused', true);
  end if;

  -- Sender name/city for the snapshot. Pull from the postcard's sender_id
  -- so this works regardless of auth context (user JWT or service_role).
  select name, city
    into v_sender_name, v_sender_city
    from public.profiles
    where id = v_postcard.sender_id;

  -- 12 hex chars, ~48 bits entropy.
  v_token := upper(encode(gen_random_bytes(6), 'hex'));

  insert into public.postcard_claims
    (claim_token, sender_id, sender_name_snapshot, sender_city_snapshot,
     flavor, expires_at)
  values
    (v_token, v_postcard.sender_id, v_sender_name, v_sender_city,
     'reciprocation', now() + interval '5 years')
  returning id into v_claim_id;

  update public.postcards
    set claim_id = v_claim_id
    where id = p_postcard_id;

  return jsonb_build_object('token', v_token, 'reused', false);
end;
$$;

comment on function public.create_reciprocation_token is
  'v0.7.0.58: mints (or returns existing) reciprocation claim token for a '
  'postcard. Accepts service_role calls (lob-send-postcard internal) AND '
  'user JWT calls. Token doubles as the welcome-mail URL on the QR code.';

revoke execute on function public.create_reciprocation_token(uuid) from public, anon;
grant execute on function public.create_reciprocation_token(uuid)
  to authenticated, service_role;
