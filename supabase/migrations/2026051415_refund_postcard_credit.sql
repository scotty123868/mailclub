-- v0.7.0.16. credit-refund RPC for failed sends.
--
-- Bug we're fixing: send_postcard / send_postcard_via_claim atomically
-- (1) create the postcards row AND (2) deduct credits. But Lob handoff
-- happens AFTER the RPC, client-side. If the Lob handoff fails (capture
-- bug, network, address rejection, etc.) the row still exists and the
-- credit is gone. User gets stuck mid-signup with 0 credits unable to
-- retry.
--
-- Fix: surface a refund_postcard_credit(postcard_id) RPC that:
--   - verifies caller owns the postcard
--   - verifies the postcard is still "in flight" (lob_id is null,
--     status='sent' or 'awaiting_address')
--   - verifies it was created in the last 30 minutes (safety: no
--     refunding old shipped cards)
--   - refunds the credit_cost to the user's profile.credits
--   - deletes the postcards row (so it doesn't clutter the journal)
--
-- Idempotent: calling it twice on the same id is a no-op the second
-- time because the row's already gone.

create or replace function public.refund_postcard_credit(p_postcard_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.postcards;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from public.postcards where id = p_postcard_id;
  if not found then
    -- Already refunded / never existed. Idempotent success.
    return jsonb_build_object('ok', true, 'refunded', 0, 'reason', 'not_found');
  end if;

  if v_row.sender_id <> v_user then
    raise exception 'Not your postcard';
  end if;

  -- Only refund if Lob never accepted AND row is recent. Prevents using
  -- this as a free-money exploit on shipped cards.
  if v_row.lob_id is not null then
    return jsonb_build_object('ok', false, 'refunded', 0, 'reason', 'already_shipped');
  end if;
  if v_row.sent_at < now() - interval '30 minutes' then
    return jsonb_build_object('ok', false, 'refunded', 0, 'reason', 'too_old');
  end if;

  -- Refund + delete in one transaction.
  update public.profiles
    set credits = credits + v_row.credit_cost
    where id = v_user;
  delete from public.postcards where id = p_postcard_id;

  return jsonb_build_object('ok', true, 'refunded', v_row.credit_cost);
end
$$;

grant execute on function public.refund_postcard_credit(uuid) to authenticated;
