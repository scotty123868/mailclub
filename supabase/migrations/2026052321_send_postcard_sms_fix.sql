-- v1.1 SMS Phase 2 hotfix — send_postcard_sms used pre-migration-1209
-- column names. Postcards table renamed owner_id→sender_id and
-- photo_uri→photo_path; credit_transactions uses owner_id. Without this
-- fix the RPC throws "column does not exist" on INSERT and sms-submit
-- always falls into the send_failed path.

drop function if exists public.send_postcard_sms(uuid, uuid, text, text, text, text);

create or replace function public.send_postcard_sms(
  p_user_id uuid,
  p_to_friend_id uuid,
  p_message text,
  p_photo_path text,
  p_to_city text default '',
  p_from_city text default ''
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_cost integer := 1; -- photo cards always cost 1 credit
  v_postcard_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  -- Credit check.
  select credits into v_credits from public.profiles where id = p_user_id;
  if v_credits is null or v_credits < v_cost then
    raise exception 'insufficient_credits' using
      detail = format('user has %s, needs %s', coalesce(v_credits, 0), v_cost);
  end if;

  -- Insert the postcard first so we have an id for credit_transactions.
  -- Column names match the post-migration-1209 schema:
  --   sender_id (was owner_id), photo_path (was photo_uri).
  -- sms_origin=true is the brand-mark hook the Lob template uses.
  insert into public.postcards (
    sender_id, to_kind, to_friend_id, from_city, to_city, category,
    credit_cost, status, message, photo_path, sms_origin
  ) values (
    p_user_id, 'friend', p_to_friend_id, p_from_city, p_to_city, 'photo',
    v_cost, 'sent', p_message, p_photo_path, true
  )
  returning id into v_postcard_id;

  -- Deduct credit.
  update public.profiles
    set credits = credits - v_cost
    where id = p_user_id;

  -- Audit row. Column is `owner_id` on credit_transactions per the
  -- post-1209 rename.
  insert into public.credit_transactions (owner_id, delta, reason, postcard_id)
    values (p_user_id, -v_cost, 'send_postcard_sms', v_postcard_id);

  -- Bump the friend's cards_sent counter so the iOS-app rolodex stays
  -- in sync if/when the user installs the app and signs in via phone.
  if p_to_friend_id is not null then
    update public.friends
      set cards_sent = cards_sent + 1,
          last_interaction_at = now()
      where id = p_to_friend_id and owner_id = p_user_id;
  end if;

  return v_postcard_id;
end
$$;

grant execute on function public.send_postcard_sms(uuid, uuid, text, text, text, text)
  to service_role;
