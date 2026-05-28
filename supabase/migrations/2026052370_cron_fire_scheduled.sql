-- v1.2 magic moment. cron schedule for scheduled-postcard firing.
--
-- Runs fire-scheduled-postcards Edge Function once a day at 14:00 UTC
-- (~9am ET, ~6am PT). The function pulls postcards with
-- status='scheduled' AND scheduled_send_at <= now() and hands them
-- off to Lob.
--
-- One-time setup before this migration is useful: seed the internal
-- secret into Supabase Vault so the cron call can authenticate.
--
--   select vault.create_secret(
--     '<value of MAILROOM_INTERNAL_SECRET env>',
--     'mailroom_internal_secret',
--     'Used by fire-scheduled-postcards pg_cron job'
--   );
--
-- This migration is idempotent. it unschedules any prior job by name
-- before scheduling, so re-running is safe.

------------------------------------------------------------
-- 1. Extensions (no-ops if already enabled. Supabase usually has these)
------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

------------------------------------------------------------
-- 2. Drop existing schedule by name, then re-create
------------------------------------------------------------

do $$
begin
  perform cron.unschedule('fire-scheduled-postcards-daily');
exception when others then null;
end$$;

select cron.schedule(
  'fire-scheduled-postcards-daily',
  '0 14 * * *',  -- 14:00 UTC daily
  $cron$
  select net.http_post(
    url := 'https://nlwnmgwylmmnaemdnzlq.supabase.co/functions/v1/fire-scheduled-postcards',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mailroom-internal',
        coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'mailroom_internal_secret' limit 1),
          ''
        )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);

------------------------------------------------------------
-- 3. Helper view for ops. peek at recent cron runs
------------------------------------------------------------

-- cron.job_run_details is the system table. This view filters it for
-- our schedule so on-call can `select * from public.fire_scheduled_log
-- order by start_time desc limit 20;` without remembering jobid.
create or replace view public.fire_scheduled_log as
  select
    jrd.runid,
    jrd.start_time,
    jrd.end_time,
    jrd.status,
    jrd.return_message
  from cron.job_run_details jrd
  join cron.job j on j.jobid = jrd.jobid
  where j.jobname = 'fire-scheduled-postcards-daily'
  order by jrd.start_time desc;

comment on view public.fire_scheduled_log is
  'Recent runs of the fire-scheduled-postcards pg_cron job. service_role only.';

-- Lock down: only service_role can read.
revoke all on public.fire_scheduled_log from anon, authenticated;
