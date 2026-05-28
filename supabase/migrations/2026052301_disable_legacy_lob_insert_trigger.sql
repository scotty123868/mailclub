-- ===========================================================================
-- 2026-05-23 v1.0.7. disable legacy Lob insert trigger
-- ===========================================================================
--
-- The original 2026051206 trigger fires on direct friend postcard INSERT and
-- calls lob-send-postcard with empty front_url/back_url. Modern sends already
-- hand off to Lob explicitly from the app (or from claim/retry-orphan with
-- render_mode='html'), and lob-send-postcard now has a lease/idempotency layer.
--
-- Keeping the trigger enabled creates a stale production side effect on every
-- friend send: an unactionable Edge Function invocation that can never print
-- because it has no artwork payload. Drop it so there is one print path per
-- send flow.
-- ===========================================================================

drop trigger if exists postcards_fire_lob_submit on public.postcards;
drop function if exists public.fire_lob_submit_on_postcard_insert();
drop function if exists public.retry_lob_submit(uuid);
