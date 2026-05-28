-- =========================================================================
-- 2026-05-18. Reciprocation photo URL hardening (P2 audit closure)
-- =========================================================================
--
-- Background: `lookup_reciprocation(token)` was returning `photo_path`
-- (a Supabase Storage object key like "<user-id>/<timestamp>-<name>.jpg")
-- directly to anon callers. The bucket is private so the path can't be
-- used to fetch the photo without a signed URL, BUT the path itself
-- reveals the sender's user_id and an upload timestamp. With many tokens
-- collected, an attacker could enumerate user activity windows.
--
-- This migration:
--   1. Updates `lookup_reciprocation` to return `has_photo` (boolean)
--      instead of the raw `photo_path`. The path stays inside the
--      database where it belongs.
--   2. Adds a new RPC `_internal_get_reciprocation_photo_path(token)`
--      restricted to service_role only. The new `reciprocation-photo`
--      Edge Function calls this, then mints a signed URL using the
--      service-role storage client, and returns just the URL to the
--      receiver. No path leakage.
--
-- Callers that need to change:
--   - app/welcome-mail/[token].tsx          → use new edge function
--   - supabase/functions/welcome-mail/index.ts → uses internal RPC + signs
--   - src/services/api.ts                   → lookupReciprocation type changes
-- =========================================================================

-- Drop the old version so we don't keep two return shapes around.
drop function if exists public.lookup_reciprocation(text);

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
    -- v0.7.0.49: was photo_path, now has_photo. Storage key stays
    -- server-side; clients fetch the photo via the reciprocation-photo
    -- Edge Function, which signs URLs with service_role and returns
    -- only the signed URL.
    'has_photo', (v_postcard.photo_path is not null),
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

-- -------------------------------------------------------------------------
-- _internal_get_reciprocation_photo_path. restricted to service_role.
-- Called ONLY by the reciprocation-photo Edge Function, which has the
-- service-role JWT. Returns the photo storage key for a valid token.
-- -------------------------------------------------------------------------
create or replace function public._internal_get_reciprocation_photo_path(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim record;
  v_photo_path text;
begin
  select pc.id, pc.expires_at
    into v_claim
    from public.postcard_claims pc
    where pc.claim_token = p_token;

  if v_claim.id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_claim.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;

  select photo_path
    into v_photo_path
    from public.postcards
    where claim_id = v_claim.id;

  if v_photo_path is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_PHOTO');
  end if;

  return jsonb_build_object('ok', true, 'photo_path', v_photo_path);
end;
$$;

revoke execute on function public._internal_get_reciprocation_photo_path(text)
  from public, authenticated, anon;
grant execute on function public._internal_get_reciprocation_photo_path(text)
  to service_role;

comment on function public._internal_get_reciprocation_photo_path is
  'Service-role-only helper for the reciprocation-photo Edge Function. '
  'Validates the token and returns the storage key so the function can '
  'mint a signed URL. Never callable directly by clients.';
