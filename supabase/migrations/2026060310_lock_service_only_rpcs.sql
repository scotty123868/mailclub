-- Lock service-only SECURITY DEFINER RPCs to the service-role key (codex P0/P1).
--
-- Postgres grants EXECUTE on functions to PUBLIC by default, and Supabase
-- exposes public-schema functions over PostgREST, so any anon/authenticated
-- client could call these with the embedded anon key. None are called by the
-- app (verified: only edge functions on the service-role key + cron call them).
-- The exposure:
--   apply_stripe_credit_purchase    P0  client could grant itself credits
--   match_pen_pal                   P0  returned opted-in users' full mailing addresses
--   lookup_reciprocation_short_code P1  returned a sender's home address
--   send_postcard_via_claim_direct  P1  spent an arbitrary user's credit
--   expire_unclaimed_postcards      P2  global mutation, was granted to authenticated
--   list_due_scheduled_postcards    P3  cron helper
--   prune_loop_inbound_dedup        P3  cron helper
--
-- Revoke EXECUTE from public/anon/authenticated and grant only to service_role.
-- The catalog loop resolves each function's exact signature (incl. any
-- overloads) so we don't have to hand-type arg lists.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'apply_stripe_credit_purchase',
        'match_pen_pal',
        'lookup_reciprocation_short_code',
        'send_postcard_via_claim_direct',
        'expire_unclaimed_postcards',
        'list_due_scheduled_postcards',
        'prune_loop_inbound_dedup'
      )
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
