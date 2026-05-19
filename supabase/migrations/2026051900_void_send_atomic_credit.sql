-- =========================================================================
-- 2026-05-19 — send_into_void_with_matching atomic credit deduction
-- =========================================================================
--
-- The pen-pal send path had the same race shape as send_postcard_via_claim:
-- SELECT FOR UPDATE, check, INSERT, UPDATE. Under pgbouncer pooling the
-- check + update sequence can interleave. Fixed by deducting credits
-- atomically up front via UPDATE ... WHERE credits >= cost, raising if
-- the predicate doesn't match.
--
-- Function body otherwise byte-equal to 2026051502_penpal_postcrossing.sql
-- with the credit-deduction block moved to the top (atomic) and the
-- trailing UPDATE removed (already done).
-- =========================================================================

create or replace function public.send_into_void_with_matching(
  p_message text,
  p_photo_path text default null,
  p_category text default 'handwritten'
) returns public.postcards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid := auth.uid();
  v_credits_after integer;
  v_cost integer := 1;
  v_from_city text;
  v_matched_user_id uuid;
  v_matched_queue_id uuid;
  v_result public.postcards;
begin
  if v_sender_id is null then
    raise exception 'Not authenticated';
  end if;

  -- v0.7.0.49: atomic credit deduction. Replaces the prior FOR UPDATE +
  -- check + UPDATE pattern which could race under pgbouncer.
  update public.profiles
    set credits = credits - v_cost
    where id = v_sender_id
      and credits >= v_cost
    returning credits into v_credits_after;
  if v_credits_after is null then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- Snapshot sender's city (no lock — read-only).
  select city into v_from_city
    from public.profiles
    where id = v_sender_id;

  -- ----- Matching: pop oldest unfulfilled queue entry from someone else -----
  select id, user_id
    into v_matched_queue_id, v_matched_user_id
    from public.penpal_queue
    where fulfilled_at is null
      and user_id <> v_sender_id
    order by queued_at asc
    limit 1
    for update skip locked;

  insert into public.postcards (
    sender_id, to_kind, to_friend_id, to_profile_id,
    from_city, to_city, category, credit_cost,
    message, photo_path, status
  ) values (
    v_sender_id, 'void', null, v_matched_user_id,
    coalesce(v_from_city, ''), '', p_category, v_cost,
    p_message, p_photo_path, 'sent'
  )
  returning * into v_result;

  if v_matched_queue_id is not null then
    update public.penpal_queue
      set fulfilled_at = now(),
          fulfilled_postcard_id = v_result.id
      where id = v_matched_queue_id;
  end if;

  -- Retro-fulfill matched sender's oldest orphan (closes loops in 2 sends).
  if v_matched_user_id is not null then
    update public.postcards
      set to_profile_id = v_sender_id
      where id = (
        select id from public.postcards
        where sender_id = v_matched_user_id
          and to_kind = 'void'
          and to_profile_id is null
        order by sent_at asc
        limit 1
      );
  end if;

  insert into public.penpal_queue (user_id)
    values (v_sender_id);

  insert into public.credit_transactions (owner_id, delta, reason, postcard_id)
    values (v_sender_id, -v_cost, 'send_postcard', v_result.id);

  return v_result;
end;
$$;

grant execute on function public.send_into_void_with_matching(
  text, text, text
) to authenticated;

comment on function public.send_into_void_with_matching is
  'v0.7.0.49: credit deduction now atomic. Was FOR UPDATE + check + UPDATE '
  '(race-prone under pgbouncer); now UPDATE ... WHERE credits >= cost RETURNING. '
  'See 2026051803_audit_p0_hardening.sql for the matching send_postcard_via_claim fix.';
