-- Enable RLS on the two public tables that lacked it (Supabase security
-- advisor flagged "table publicly accessible"; our own audit confirmed
-- pen_pal_pairings and loop_inbound_dedup were the only public tables with
-- RLS off, vs 12 with it on).
--
-- Both are written ONLY by the bot (loop-inbound) via the service-role key,
-- which bypasses RLS. The iOS app never queries them (verified). So enabling
-- RLS with NO client policies = anon/authenticated get zero access
-- (default-deny), the bot keeps working, nothing else breaks.
--
-- pen_pal_pairings is the sensitive one: it maps sender_id -> recipient_id,
-- so a world-readable copy would expose who is paired with whom and break the
-- pen-pal anonymity promise ("you won't see their address, they won't see
-- yours"). loop_inbound_dedup is low-sensitivity but world-writable could let
-- someone poison webhook idempotency. Lock both down.

alter table public.pen_pal_pairings enable row level security;
alter table public.loop_inbound_dedup enable row level security;
