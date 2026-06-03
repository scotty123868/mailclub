-- Unclaimed-link sender nudge.
--
-- A claim link (send-a-link flow) expires 7 days after creation
-- (2026052100). If the recipient never adds their address, the card
-- silently expires and the sender hears nothing. This adds a one-time
-- nudge: the claim-nudge Edge Function (pg_cron, daily) texts the sender a
-- gentle reminder with the link ~2 days after an unclaimed link is created,
-- while it's still live, so they can re-forward it.
--
-- Deploy the function:  supabase functions deploy claim-nudge --no-verify-jwt
-- Auth: x-cron-trigger header == CRON_TRIGGER_SECRET (Vault: cron_trigger_secret).
--
-- Idempotent: re-running unschedules the prior job by name before scheduling.

-- 1. One-shot nudge marker. Null until the reminder is sent.
alter table public.postcard_claims
  add column if not exists nudge_sent_at timestamptz;

-- 2. Partial index for the cron scan — only ever touches still-open links.
create index if not exists postcard_claims_nudge_due_idx
  on public.postcard_claims (created_at)
  where claimed_at is null and nudge_sent_at is null;

------------------------------------------------------------
-- 3. Extensions (no-ops if already enabled)
------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

------------------------------------------------------------
-- 4. Daily schedule at 15:00 UTC (offset from the 14:00
--    fire-scheduled-postcards job). Uses the same cron_trigger_secret
--    Vault entry + x-cron-trigger header as fire-scheduled (v2).
------------------------------------------------------------
do $$
begin
  perform cron.unschedule('claim-nudge-daily');
exception when others then null;
end$$;

select cron.schedule(
  'claim-nudge-daily',
  '0 15 * * *',  -- 15:00 UTC daily
  $cron$
  select net.http_post(
    url := 'https://nlwnmgwylmmnaemdnzlq.supabase.co/functions/v1/claim-nudge',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-trigger',
        coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_trigger_secret' limit 1),
          ''
        )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);

------------------------------------------------------------
-- 5. Ops view: peek at recent runs
------------------------------------------------------------
create or replace view public.claim_nudge_log as
  select jrd.runid, jrd.start_time, jrd.end_time, jrd.status, jrd.return_message
  from cron.job_run_details jrd
  join cron.job j on j.jobid = jrd.jobid
  where j.jobname = 'claim-nudge-daily'
  order by jrd.start_time desc;

comment on view public.claim_nudge_log is
  'Recent runs of the claim-nudge pg_cron job. service_role only.';

revoke all on public.claim_nudge_log from anon, authenticated;
