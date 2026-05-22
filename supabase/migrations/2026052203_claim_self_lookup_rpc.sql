-- ===========================================================================
-- 2026-05-22 v0.7.0.59 — sender-safe claim self-link check
-- ===========================================================================
--
-- The iOS /claim route needs to know whether the current signed-in user is
-- tapping their own outbound claim link. The client used to query
-- public.postcard_claims directly, but sender SELECT on that table was
-- revoked for privacy. Keep the behavior through a tiny SECURITY DEFINER RPC
-- that returns only a boolean and never exposes claim/address columns.
-- ===========================================================================

create or replace function public.claim_belongs_to_current_user(
  p_claim_token text
) returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.postcard_claims pc
    where pc.claim_token = p_claim_token
      and pc.sender_id = auth.uid()
  );
$$;

revoke execute on function public.claim_belongs_to_current_user(text) from public, anon;
grant execute on function public.claim_belongs_to_current_user(text) to authenticated;

comment on function public.claim_belongs_to_current_user is
  'Sender-safe boolean self-link check for the iOS /claim route. Does not '
  'return any postcard_claims columns or recipient address data.';
