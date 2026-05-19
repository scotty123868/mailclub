-- =========================================================================
-- 2026-05-19 — Drop dead RLS policies on postcard_claims + postcards
-- =========================================================================
--
-- Background: 2026051210_receiver_postcard_visibility.sql created two RLS
-- policies that 2026051211_phase6_hardening.sql then made unreachable:
--
--   1. `postcard_claims_receiver_select` (2026051210:25-28)
--      → SELECT permission on postcard_claims was REVOKED from
--        authenticated in 2026051211:36. With no table-level GRANT, the
--        policy can never fire.
--
--   2. `postcards_receiver_select` (2026051210:38-47)
--      → joins through postcard_claims via an EXISTS subquery. That
--        subquery runs as the invoker, which has no SELECT on
--        postcard_claims, so the EXISTS always returns false. The
--        policy can never let a receiver see a postcard.
--
-- The receiver-visibility user need is now served by the
-- `fetch_received_postcards` SECURITY DEFINER RPC introduced later in
-- 2026051210 and used by the client. Both dead policies are pure noise
-- — they look protective but do nothing.
--
-- Drop both. Reduces audit surface, removes the "looks like RLS is
-- broken" confusion for anyone reading the schema.
-- =========================================================================

drop policy if exists postcard_claims_receiver_select on public.postcard_claims;
drop policy if exists postcards_receiver_select on public.postcards;
