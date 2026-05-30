-- Webhook idempotency for loop-inbound.
--
-- LoopMessage (like most webhook providers) is at-least-once: the same
-- message_inbound event can be delivered more than once (retry on a slow
-- ACK, network blips, provider-side redelivery). Without dedup, a single
-- inbound photo could create two drafts + two "Got it" bubbles, and a
-- duplicate SEND could double-charge a credit.
--
-- This table records every processed inbound message_id. The handler
-- does an insert-on-conflict at the top; a conflict means "already seen,
-- skip." Rows are tiny; a periodic prune (or a TTL policy) can trim them
-- later — we keep ~30 days implicitly via the cleanup helper below.

create table if not exists public.loop_inbound_dedup (
  message_id text primary key,
  seen_at timestamptz not null default now()
);

comment on table public.loop_inbound_dedup is
  'Idempotency ledger for loop-inbound webhooks. One row per processed message_id. Insert-on-conflict at handler entry dedupes LoopMessage at-least-once redelivery.';

-- Optional housekeeping: callable to drop rows older than 30 days so the
-- table never grows unbounded. Safe to run from a cron later.
create or replace function public.prune_loop_inbound_dedup()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.loop_inbound_dedup where seen_at < now() - interval '30 days';
$$;
