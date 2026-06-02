-- Service-role variant of send_postcard_via_claim for the iMessage bot.
--
-- The web/app RPC (send_postcard_via_claim) resolves the sender via
-- auth.uid(). The bot runs as service-role and resolves the sender by
-- phone, so it can't use auth.uid(). This is a byte-for-byte copy of that
-- RPC's body with the user id passed in as a parameter instead, used by
-- the "I don't know their address" branch: the sender composes the card
-- (photo + note), we mint a claim, and they forward the claim link to the
-- recipient, who fills in their own address. The recipient's submission
-- (existing /claim flow) then triggers the actual Lob mailing.
--
-- One credit is spent at claim creation (same as the web RPC), so a
-- composed-but-unclaimed card still counts — consistent + abuse-resistant.

create or replace function public.send_postcard_via_claim_direct(
  p_user_id uuid,
  p_message text,
  p_photo_path text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_credits integer;
  v_cost integer := 1;
  v_token text;
  v_claim_id uuid;
  v_postcard_id uuid;
  v_sender_name text;
  v_sender_city text;
begin
  if p_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select credits, name, city
    into v_credits, v_sender_name, v_sender_city
    from public.profiles
    where id = p_user_id
    for update;

  if v_credits is null or v_credits < v_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_token := upper(
    translate(substr(encode(gen_random_bytes(8), 'base64'), 1, 8), '+/=', 'XYZ')
  );

  insert into public.postcard_claims
    (claim_token, sender_id, sender_name_snapshot, sender_city_snapshot)
  values
    (v_token, p_user_id, v_sender_name, v_sender_city)
  returning id into v_claim_id;

  insert into public.postcards
    (sender_id, to_kind, to_friend_id, claim_id, category,
     message, photo_path, credit_cost, status, sms_origin)
  values
    (p_user_id, 'claim', null, v_claim_id, 'photo',
     p_message, p_photo_path, v_cost, 'awaiting_address', true)
  returning id into v_postcard_id;

  update public.profiles set credits = credits - v_cost where id = p_user_id;

  return jsonb_build_object(
    'postcard_id', v_postcard_id,
    'claim_id', v_claim_id,
    'claim_token', v_token,
    'credits_remaining', v_credits - v_cost
  );
end;
$$;

grant execute on function public.send_postcard_via_claim_direct(uuid, text, text) to service_role;
