-- =========================================================================
-- 2026-05-19. Void send retro-fulfill race fix (Codex audit P2)
-- =========================================================================
--
-- Background: 2026051900_void_send_atomic_credit closed the credit-
-- deduction race in send_into_void_with_matching but left a separate
-- race in the retro-fulfill step. When the just-matched sender had a
-- previous orphan postcard (sent earlier with no available recipient
-- in the queue), we point that orphan at THIS sender as the recipient
-- to close the loop in two sends instead of three. The query:
--
--   update public.postcards
--     set to_profile_id = v_sender_id
--     where id = (
--       select id from public.postcards
--       where sender_id = v_matched_user_id
--         and to_kind = 'void'
--         and to_profile_id is null
--       order by sent_at asc
--       limit 1
--     );
--
-- Two concurrent sends, both matching with v_matched_user_id, both pick
-- THE SAME oldest orphan, both UPDATE its to_profile_id. last write wins
-- and one sender silently doesn't get credited with the orphan match.
--
-- Fix: add `to_profile_id IS NULL` to the outer UPDATE so only the first
-- write succeeds. Also wrap the subquery in `FOR UPDATE SKIP LOCKED` so
-- the second caller picks a different orphan (or none) instead of
-- contending for the same row.
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
  v_orphan_id uuid;
begin
  if v_sender_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles
    set credits = credits - v_cost
    where id = v_sender_id
      and credits >= v_cost
    returning credits into v_credits_after;
  if v_credits_after is null then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  select city into v_from_city
    from public.profiles
    where id = v_sender_id;

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

  -- v0.7.0.49 (Codex audit P2): retro-fulfill race closed.
  --
  -- Step A: lock the candidate orphan with FOR UPDATE SKIP LOCKED so
  -- two concurrent callers can't pick the same row.
  if v_matched_user_id is not null then
    select id into v_orphan_id
      from public.postcards
      where sender_id = v_matched_user_id
        and to_kind = 'void'
        and to_profile_id is null
      order by sent_at asc
      limit 1
      for update skip locked;

    -- Step B: update only if the orphan is still unassigned. Belt +
    -- suspenders. SKIP LOCKED already serializes, but the WHERE
    -- predicate prevents an unexpected stale handle from clobbering
    -- another caller's already-set to_profile_id.
    if v_orphan_id is not null then
      update public.postcards
        set to_profile_id = v_sender_id
        where id = v_orphan_id
          and to_profile_id is null;
    end if;
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
  'v0.7.0.49: retro-fulfill race closed via FOR UPDATE SKIP LOCKED + '
  'to_profile_id IS NULL predicate on the orphan UPDATE.';
