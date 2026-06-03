-- Turn loop_inbound_dedup into a processing ledger (codex P1).
--
-- Before: a message_id was inserted ("seen") BEFORE the async handler ran.
-- If the handler threw or the function was killed mid-handle, the row stayed
-- forever and LoopMessage's at-least-once redelivery was skipped as a
-- "duplicate" — a permanently lost message. Now we track a status. Only
-- 'succeeded' counts as done. A row stuck 'processing' past a few minutes (a
-- prior crash where we never reached the catch) is reprocessed on redelivery.
-- 'failed' (a caught error) stays terminal so a poison message can't loop.
alter table public.loop_inbound_dedup
  add column if not exists status text not null default 'succeeded',
  add column if not exists updated_at timestamptz not null default now();

-- Existing rows predate the ledger and were all processed under the old
-- insert-on-conflict scheme, so the 'succeeded' default is correct for them.
