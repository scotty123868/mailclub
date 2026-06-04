-- Per-phone spam guard for the public iMessage number.
--
-- Problem: anyone can text the public Mailroom number, and every inbound
-- message can trigger OpenAI calls (assistant, address parse, note ideas,
-- moderation) and photo downloads. A bad actor blasting non-photo messages
-- burns OpenAI/Lob/media spend without ever sending a card.
--
-- Guard: loop-inbound tracks a per-phone "non-photo streak". A real photo
-- (the start of any genuine card) resets it to 0, so legitimate users are
-- never affected. After ~20 non-photo messages with no photo, the number is
-- silenced for a cooldown (one heads-up, then quiet until they text a photo
-- or the cooldown elapses).
--
-- Service-role only: loop-inbound (admin client) is the sole reader/writer.

create table if not exists public.sms_abuse_guard (
  phone text primary key,
  nonphoto_streak integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.sms_abuse_guard enable row level security;
revoke all on public.sms_abuse_guard from anon, authenticated;
-- No RLS policies: the service role bypasses RLS; no other role gets access.
