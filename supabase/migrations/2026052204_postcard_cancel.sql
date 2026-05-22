-- ===========================================================================
-- 2026-05-22 v0.7.0.59 — postcard cancellation
-- ===========================================================================
--
-- Lets a sender pull a postcard out of the print queue within Lob's
-- cancellation window (their docs: any time before the card enters the
-- production line). The cancel action runs through cancel-postcard
-- Edge Function which DELETE-calls Lob's API; this migration just adds
-- the data shape:
--
--   1. New 'cancelled' value on postcard_status enum so the row can
--      record the terminal cancelled state.
--   2. cancelled_at column to record when (used to grey out + show the
--      "Cancelled • Refunded" chip in the sheet).
--   3. refund_postcard_on_cancel() helper: same idempotency pattern as
--      expire_unclaimed_postcards — refunded_at-on-claim or a dedicated
--      cancelled_at-on-postcards marker so a retry can't double-refund.
-- ===========================================================================

-- 1. enum value
do $$ begin
  if not exists (
    select 1 from pg_type t join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'postcard_status' and e.enumlabel = 'cancelled'
  ) then
    alter type public.postcard_status add value 'cancelled';
  end if;
exception when undefined_object then null;
end $$;

-- 2. timestamp column
alter table public.postcards
  add column if not exists cancelled_at timestamptz;

-- 3. RPC: idempotent credit refund on cancel.
-- Edge Function calls this AFTER it has confirmed Lob accepted the
-- cancellation. Lob round-trip happens server-side in the Edge Function
-- because plpgsql can't make HTTPS calls without an extension.
create or replace function public.refund_cancelled_postcard(
  p_postcard_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_postcard record;
  v_user uuid := auth.uid();
  v_is_service boolean := nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  ) = 'service_role';
begin
  select id, sender_id, credit_cost, status, cancelled_at
    into v_postcard
    from public.postcards
    where id = p_postcard_id
    for update;

  if v_postcard.id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if not v_is_service and (v_user is null or v_postcard.sender_id <> v_user) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_OWNER');
  end if;
  if v_postcard.cancelled_at is not null then
    -- Already cancelled — idempotent no-op
    return jsonb_build_object('ok', true, 'reason', 'ALREADY_CANCELLED');
  end if;
  if v_postcard.status not in ('queued', 'sent', 'awaiting_address') then
    return jsonb_build_object('ok', false, 'reason', 'WRONG_STATE');
  end if;

  -- Stamp cancellation FIRST so a crash can't double-refund.
  update public.postcards
    set cancelled_at = now(),
        status = 'cancelled'
    where id = p_postcard_id;

  -- Refund the credit to the sender.
  update public.profiles
    set credits = credits + v_postcard.credit_cost
    where id = v_postcard.sender_id;

  return jsonb_build_object('ok', true, 'refunded', v_postcard.credit_cost);
end;
$$;

revoke execute on function public.refund_cancelled_postcard(uuid) from public, anon;
grant execute on function public.refund_cancelled_postcard(uuid) to authenticated, service_role;

comment on function public.refund_cancelled_postcard is
  'v0.7.0.59: idempotent credit refund + status flip when a postcard is '
  'cancelled. Called by the cancel-postcard Edge Function after Lob '
  'confirms the cancellation; the cancelled_at marker prevents '
  'double-refund on retry.';
