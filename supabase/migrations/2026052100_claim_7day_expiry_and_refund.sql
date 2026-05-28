-- ===========================================================================
-- 2026-05-21 v0.7.0.58. claim links expire in 7 days + auto-refund credit
-- ===========================================================================
--
-- WHAT CHANGES:
--   1. Default claim expiry: 30 days → 7 days. Recipient has 1 week to
--      drop their address; otherwise the sender's credit comes back.
--   2. expire_unclaimed_postcards() RPC walks all expired-but-unclaimed
--      claims and refunds the credit_cost back to the sender's profile.
--      Idempotent via postcard_claims.refunded_at marker, so re-running
--      the function never double-refunds.
--   3. Postcards row gets status='expired' so the sender's app can show
--      "your card came back unsent. credit refunded" instead of leaving
--      it stuck in awaiting_address forever.
--   4. Existing unclaimed claims keep their original expires_at. we
--      don't retroactively shorten anyone's window. The new 7-day default
--      only applies to claims created from this migration forward.
--
-- HOW TO RUN THE EXPIRY SWEEP:
--   - Recommended: pg_cron daily job (added at the bottom of this file).
--     Requires the pg_cron extension enabled on the project. Supabase
--     enables it by default for paid projects.
--   - Fallback: the iOS app can call this RPC on cold-start / foreground.
--     We don't wire that in this migration (purely server-side concern),
--     but the RPC is grantable to authenticated users so it's available
--     for client-side fallback if pg_cron isn't usable.
-- ===========================================================================

-- 1. Shorten default expiry on the column
alter table public.postcard_claims
  alter column expires_at set default (now() + interval '7 days');

-- 2. Add 'expired' to postcard_status enum if not already there.
do $$ begin
  if not exists (
    select 1 from pg_type t join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'postcard_status' and e.enumlabel = 'expired'
  ) then
    alter type public.postcard_status add value 'expired';
  end if;
exception when undefined_object then
  -- postcard_status isn't an enum (text column). nothing to do
  null;
end $$;

-- 3. Idempotency marker for the refund step. Refund only runs once per
--    claim; the second call sees refunded_at IS NOT NULL and skips.
alter table public.postcard_claims
  add column if not exists refunded_at timestamptz;

create index if not exists postcard_claims_refund_sweep_idx
  on public.postcard_claims (expires_at)
  where claimed_at is null and refunded_at is null;

-- 4. The sweep itself. Runs through every unclaimed expired claim,
--    refunds the credit, marks the postcard expired, and stamps
--    refunded_at so the same row never refunds twice. Returns a count.
create or replace function public.expire_unclaimed_postcards()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_count int := 0;
begin
  for v_rec in
    select pc.id as claim_id,
           p.id as postcard_id,
           p.sender_id,
           p.credit_cost
    from public.postcard_claims pc
    join public.postcards p on p.claim_id = pc.id
    where pc.claimed_at is null
      and pc.refunded_at is null
      and pc.expires_at < now()
    for update of pc, p
  loop
    -- Mark claim as refunded FIRST so a crash between updates doesn't
    -- double-refund on retry. The next two updates can both succeed
    -- or both fail; refunded_at is the durable idempotency token.
    update public.postcard_claims
      set refunded_at = now()
      where id = v_rec.claim_id;

    -- Refund the credit cost to the sender's wallet.
    update public.profiles
      set credits = credits + v_rec.credit_cost
      where id = v_rec.sender_id;

    -- Flip the postcard's status. App-side, awaiting_address → expired
    -- triggers a different UI ("claim expired, credit returned") so the
    -- sender knows what happened.
    update public.postcards
      set status = 'expired'
      where id = v_rec.postcard_id;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'refunded', v_count);
end;
$$;

comment on function public.expire_unclaimed_postcards is
  'Sweeps unclaimed claim links that passed their expires_at, refunds the '
  'sender''s credit, and marks the postcard expired. Idempotent via '
  'postcard_claims.refunded_at marker. Runs daily via pg_cron; safe to '
  'call ad-hoc from the client too.';

revoke execute on function public.expire_unclaimed_postcards() from public, anon;
grant execute on function public.expire_unclaimed_postcards() to service_role, authenticated;

-- 5. Schedule the daily sweep via pg_cron. Picks 03:17 UTC. quiet time,
--    avoids on-the-hour cron pile-ups. Bracket in a DO block so the
--    migration succeeds even if pg_cron isn't installed in this project
--    (Supabase free tier doesn't enable it). In that case the sweep
--    must be triggered manually or from the client.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('expire-unclaimed-postcards-daily')
      where exists (
        select 1 from cron.job where jobname = 'expire-unclaimed-postcards-daily'
      );
    perform cron.schedule(
      'expire-unclaimed-postcards-daily',
      '17 3 * * *',
      $cron$ select public.expire_unclaimed_postcards(); $cron$
    );
  end if;
end $$;
