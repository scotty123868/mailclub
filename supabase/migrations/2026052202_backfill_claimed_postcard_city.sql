-- ===========================================================================
-- 2026-05-22 v0.7.0.59. backfill sender-visible city for claimed links
-- ===========================================================================
--
-- Migration 2026052201 copies claimed_city onto postcards.to_city for future
-- claim redemptions. This backfills already-claimed link postcards so the
-- sender app can immediately show "Recipient · Denver" / city map state
-- without exposing street address.
-- ===========================================================================

update public.postcards p
  set to_city = coalesce(nullif(trim(pc.claimed_city), ''), p.to_city),
      status = case
        when p.status = 'awaiting_address' and pc.claimed_at is not null then 'queued'
        else p.status
      end
  from public.postcard_claims pc
  where p.claim_id = pc.id
    and p.to_kind = 'claim'
    and pc.claimed_at is not null
    and (
      coalesce(p.to_city, '') = ''
      or p.status = 'awaiting_address'
    );
