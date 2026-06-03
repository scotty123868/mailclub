-- Race-safe credit deduction for the SMS send RPCs (codex P1).
--
-- Both send_postcard_sms and send_postcard_sms_direct did: SELECT credits,
-- check < cost, then later UPDATE credits = credits - cost with no guard.
-- Two concurrent sends with 1 credit could both pass the check and both
-- deduct, driving the balance negative and mailing two cards for one credit.
--
-- Fix: a single conditional UPDATE that both gates and deducts. Concurrent
-- updates to the same profile row serialize (row lock), and `credits >= cost`
-- means only one of two concurrent 1-credit sends wins. The deduction runs
-- BEFORE the insert; the function is one transaction, so if the insert fails
-- the deduction rolls back with it.
--
-- send_postcard_via_claim_direct already locks the row FOR UPDATE, so it's
-- safe and untouched here.

create or replace function public.send_postcard_sms(
  p_user_id uuid,
  p_to_friend_id uuid,
  p_message text,
  p_photo_path text,
  p_to_city text default '',
  p_from_city text default '',
  p_scheduled_send_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_cost integer := 1;
  v_postcard_id uuid;
  v_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  -- Atomic gate + deduct (race-safe).
  update public.profiles
    set credits = credits - v_cost
    where id = p_user_id and credits >= v_cost
    returning credits into v_credits;
  if not found then
    raise exception 'insufficient_credits' using detail = 'insufficient credits';
  end if;

  v_status := case
    when p_scheduled_send_at is not null and p_scheduled_send_at > now()
      then 'scheduled'
    else 'sent'
  end;

  insert into public.postcards (
    sender_id, to_kind, to_friend_id, from_city, to_city, category,
    credit_cost, status, message, photo_path, sms_origin, scheduled_send_at
  ) values (
    p_user_id, 'friend', p_to_friend_id, p_from_city, p_to_city, 'photo',
    v_cost, v_status, p_message, p_photo_path, true, p_scheduled_send_at
  )
  returning id into v_postcard_id;

  insert into public.credit_transactions (owner_id, delta, reason, postcard_id)
    values (p_user_id, -v_cost, 'send_postcard_sms', v_postcard_id);

  if p_to_friend_id is not null then
    update public.friends
      set cards_sent = cards_sent + 1,
          last_interaction_at = now()
      where id = p_to_friend_id and owner_id = p_user_id;
  end if;

  return v_postcard_id;
end
$$;

grant execute on function public.send_postcard_sms(
  uuid, uuid, text, text, text, text, timestamptz
) to service_role;

create or replace function public.send_postcard_sms_direct(
  p_user_id uuid,
  p_message text,
  p_photo_path text,
  p_to_line1 text,
  p_to_line2 text,
  p_to_city text,
  p_to_state text,
  p_to_zip text,
  p_from_city text default '',
  p_scheduled_send_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_cost integer := 1;
  v_postcard_id uuid;
  v_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  -- Atomic gate + deduct (race-safe).
  update public.profiles
    set credits = credits - v_cost
    where id = p_user_id and credits >= v_cost
    returning credits into v_credits;
  if not found then
    raise exception 'insufficient_credits' using detail = 'insufficient credits';
  end if;

  v_status := case
    when p_scheduled_send_at is not null and p_scheduled_send_at > now()
      then 'scheduled'
    else 'sent'
  end;

  insert into public.postcards (
    sender_id, to_kind, to_friend_id,
    from_city, to_city, category,
    credit_cost, status, message, photo_path,
    sms_origin, scheduled_send_at,
    to_address_line1, to_address_line2, to_address_state, to_address_zip
  ) values (
    p_user_id, 'stranger', null,
    p_from_city, p_to_city, 'photo',
    v_cost, v_status, p_message, p_photo_path,
    true, p_scheduled_send_at,
    p_to_line1, p_to_line2, p_to_state, p_to_zip
  )
  returning id into v_postcard_id;

  insert into public.credit_transactions (owner_id, delta, reason, postcard_id)
    values (p_user_id, -v_cost, 'send_postcard_sms_direct', v_postcard_id);

  return v_postcard_id;
end
$$;

grant execute on function public.send_postcard_sms_direct(
  uuid, text, text, text, text, text, text, text, text, timestamptz
) to service_role;
