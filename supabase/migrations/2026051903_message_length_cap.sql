-- =========================================================================
-- 2026-05-19 — server-side message length cap (Codex audit P2)
-- =========================================================================
--
-- Background: the client caps postcard messages at 300 codepoints in
-- MessageEditorSheet.tsx, but the server RPCs (send_postcard,
-- send_postcard_via_claim, send_into_void_with_matching) accept
-- unbounded p_message. A malicious or hacked client could submit a
-- 2000-char message that pushes the compactHtml() output past Lob's
-- 10KB inline cap — at which point Lob rejects the send AND the
-- credit has already been deducted (atomic update fired first).
--
-- Codex measurement: 1000 chars of escapable HTML text (&, <, >)
-- expanded to 12,296 compacted bytes — already over the cap. Even
-- 2000 plain chars hit 9,496 bytes (close to cap, fragile).
--
-- Defense: a CHECK constraint at the column level. Rejects any
-- INSERT/UPDATE that attempts to store a message > 500 chars (cushion
-- above the client's 300 so legitimate edits don't fail, but still
-- well under the danger zone). The error message is structured so
-- client code can surface a clean "message too long" instead of the
-- raw constraint name.
-- =========================================================================

-- Drop any old constraint first so the migration is re-applyable.
alter table public.postcards
  drop constraint if exists postcards_message_length_chk;

alter table public.postcards
  add constraint postcards_message_length_chk
  check (char_length(coalesce(message, '')) <= 500);

comment on constraint postcards_message_length_chk on public.postcards is
  'v0.7.0.49 Codex P2: messages > 500 chars can push the Lob inline HTML '
  'payload past 10KB after compactHtml() expansion of escaped characters. '
  'Client caps at 300 chars; this is the server defense.';
