-- v0.7.0.19 — normalize send_postcard_via_claim cost map.
--
-- Bug user hit on build 26: tapped "Share a link" on the Send tab with
-- 1 credit in their account. UI displayed "1 stamp" required. Server
-- threw INSUFFICIENT_CREDITS and surfaced the raw exception name.
--
-- Root cause: the Phase 6 hardening migration (2026051211) normalized
-- send_postcard to charge 1 credit for every category, but the sister
-- RPC send_postcard_via_claim (used by the "Share a link" path,
-- originally added in 2026051208) was missed. It still charges
-- 2 credits for `photo` and `place`, 5 for `custom`.
--
-- Client-side `costForCategory` returns 1 for everything (matches the
-- "1 stamp" UI copy). When the client thinks the user can afford it
-- and the server rejects, the user sees a confusing error with their
-- 1 credit still on display.
--
-- Fix: rewrite send_postcard_via_claim with the normalized cost map.
-- Signature stays identical (text, text, text, text) so the GRANT and
-- client RPC binding don't change. Function body is otherwise byte-equal
-- to 2026051208's version, with `extensions` added to search_path so
-- gen_random_bytes resolves correctly (this was the 2026051213 fix
-- carried forward).

create or replace function public.send_postcard_via_claim(
  p_category text,
  p_message text,
  p_photo_path text default null,
  p_place_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_credits integer;
  v_cost integer;
  v_token text;
  v_claim_id uuid;
  v_postcard_id uuid;
  v_sender_name text;
  v_sender_city text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- v0.7.0.19: normalized to 1 credit per send, matching send_postcard
  -- + client-side CARD_COSTS. Previously 2/2/5 for photo/place/custom.
  v_cost := case p_category
    when 'handwritten' then 1
    when 'photo' then 1
    when 'place' then 1
    when 'custom' then 1
    else 1
  end;

  select credits, name, city
    into v_credits, v_sender_name, v_sender_city
    from public.profiles
    where id = v_user_id
    for update;

  if v_credits is null or v_credits < v_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_token := upper(
    translate(
      substr(encode(gen_random_bytes(8), 'base64'), 1, 8),
      '+/=', 'XYZ'
    )
  );

  insert into public.postcard_claims
    (claim_token, sender_id, sender_name_snapshot, sender_city_snapshot)
  values
    (v_token, v_user_id, v_sender_name, v_sender_city)
  returning id into v_claim_id;

  insert into public.postcards
    (sender_id, to_kind, to_friend_id, claim_id, category,
     message, photo_path, place_name, credit_cost, status)
  values
    (v_user_id, 'claim', null, v_claim_id, p_category,
     p_message, p_photo_path, p_place_name, v_cost, 'awaiting_address')
  returning id into v_postcard_id;

  update public.profiles
    set credits = credits - v_cost
    where id = v_user_id;

  return jsonb_build_object(
    'postcard_id', v_postcard_id,
    'claim_id', v_claim_id,
    'claim_token', v_token,
    'credits_remaining', v_credits - v_cost
  );
end;
$$;

grant execute on function public.send_postcard_via_claim(text, text, text, text)
  to authenticated;
