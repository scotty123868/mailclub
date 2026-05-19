-- =========================================================================
-- 2026-05-19 — redeem_postcard_claim atomic update (Codex audit P1)
-- =========================================================================
--
-- Background: redeem_postcard_claim read claimed_at without FOR UPDATE,
-- then updated by id alone (no claimed_at IS NULL predicate). Two
-- concurrent valid POSTs for the same token could both pass the
-- claimed_at IS NULL check, both succeed the redeem, and both trigger
-- the claim → lob-send-postcard handoff — resulting in two Lob
-- submissions for one postcard.
--
-- This migration:
--   1. Performs the redemption as an atomic UPDATE with the
--      `claimed_at IS NULL AND expires_at > now()` predicate baked
--      into the WHERE clause. RETURNING id; null returning means no
--      row matched — could be NOT_FOUND, EXPIRED, or already-claimed.
--   2. After the atomic update, a follow-up SELECT distinguishes the
--      three failure modes for the response payload.
--
-- The lob-send-postcard companion fix lives in code: an early-return
-- guard checks if lob_id is already populated and skips the Lob POST.
-- =========================================================================

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
begin
  -- Atomic redemption. If the WHERE clause doesn't match (NOT_FOUND,
  -- EXPIRED, or ALREADY_CLAIMED), no row updates and v_claim_id stays
  -- null. The follow-up SELECT then identifies which case it was, so
  -- the client gets a specific reason.
  update public.postcard_claims
    set claimed_at = now(),
        claimed_name = p_name,
        claimed_address_line1 = p_address_line1,
        claimed_address_line2 = p_address_line2,
        claimed_city = p_city,
        claimed_state = p_state,
        claimed_zip = p_zip,
        claimed_country = p_country,
        expires_at = now() + interval '5 years',
        flavor = 'reciprocation'
    where claim_token = p_claim_token
      and claimed_at is null
      and expires_at > now()
    returning id into v_claim_id;

  if v_claim_id is null then
    -- Disambiguate why the update didn't match.
    declare
      v_exists boolean;
      v_already_claimed timestamptz;
      v_expires_at timestamptz;
    begin
      select true, claimed_at, expires_at
        into v_exists, v_already_claimed, v_expires_at
        from public.postcard_claims
        where claim_token = p_claim_token;
      if not coalesce(v_exists, false) then
        return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
      end if;
      if v_already_claimed is not null then
        return jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
      end if;
      if v_expires_at < now() then
        return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
      end if;
      -- Shouldn't reach here, but fail clean.
      return jsonb_build_object('ok', false, 'reason', 'UNKNOWN');
    end;
  end if;

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

comment on function public.redeem_postcard_claim is
  'v0.7.0.49: redemption now atomic — UPDATE ... WHERE claimed_at IS NULL ensures '
  'concurrent POSTs for the same token can''t both pass the check. The companion '
  'lob-send-postcard guard rejects re-submission to Lob if lob_id is already set.';
