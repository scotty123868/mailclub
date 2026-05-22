-- ===========================================================================
-- 2026-05-22 v0.7.0.58 — postcards REPLICA IDENTITY FULL
-- ===========================================================================
--
-- WHY: The sender's app keeps showing "WAITING FOR THEIR ADDRESS" long
-- after the recipient submits their address. Symptom traced to
-- NSURLSession's URLCache serving stale PostgREST responses on iOS.
-- Two prior fixes (cache: "no-store" option, then explicit
-- Cache-Control request headers) were silently dropped by React Native's
-- fetch polyfill and/or iOS's networking stack.
--
-- WORKAROUND: route the update through Realtime instead of refetching
-- via HTTP. The Realtime channel uses WebSockets and is not subject to
-- URLCache. To make this useful, the Realtime payload must include the
-- ENTIRE updated row — not just the primary key. That requires REPLICA
-- IDENTITY FULL on the table, otherwise UPDATE events carry only the PK.
--
-- COST: a small bump in WAL/Realtime payload size per UPDATE. Postcards
-- have ~20 columns and most updates touch only status / lob_id / etc.
-- The overhead is negligible compared to the user-facing bug it fixes.
-- ===========================================================================

alter table public.postcards replica identity full;

comment on table public.postcards is
  'v0.7.0.58: REPLICA IDENTITY FULL set so Realtime UPDATE payloads carry '
  'the full new row. Client-side handler applies the update directly to '
  'React state without a follow-up HTTP fetch, bypassing iOS URLCache.';
