-- v1.2 follow-up — re-point fire-scheduled-postcards cron job at the
-- dedicated cron_trigger_secret vault entry (was mailroom_internal_secret)
-- and switch the header name to x-cron-trigger.
--
-- Rationale: the cron→Edge-Function path now uses a single-purpose secret
-- so it can be rotated independently of MAILROOM_INTERNAL_SECRET (which is
-- shared across sms-inbound ↔ lob-send-postcard).

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
