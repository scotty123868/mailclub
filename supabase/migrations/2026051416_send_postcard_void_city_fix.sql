-- v0.7.0.17 — fix null to_city for void / pen-pal sends.
--
-- Bug: the Phase 6 send_postcard RPC (2026051211) declares
--   v_to_city text;
-- with no default. For p_to_friend_id IS NULL (pen pal / void sends), the
-- "Look up the recipient's city" block is skipped, so v_to_city stays NULL.
-- The INSERT then passes NULL explicitly into postcards.to_city, which
-- violates the column's NOT NULL constraint (the column has `default ''`
-- but defaults don't apply when the value is explicitly NULL).
--
-- Result the user sees: "Couldn't send to a pen pal. Try again in a moment."
-- with the underlying alert:
--   null value in column "to_city" of relation "postcards" violates
--   not-null constraint
--
-- Fix: default v_to_city to '' AND v_from_city to '' as well (same class
-- of bug, just hasn't fired yet because profiles.city is required in our
-- welcome flow). Cheaper than a giant conditional rewrite.
--
-- Signature MUST match Phase 6 exactly (uuid first, text second) so
-- CREATE OR REPLACE replaces the existing function rather than creating
-- a new overload — which would re-introduce the resolver-ambiguity bug
-- that 2026051213 fixed.

create or replace function public.send_postcard(
  p_to_friend_id uuid,
  p_to_kind text,
  p_category text,
  p_message text,
  p_place_name text default null,
  p_photo_uri text default null,
  p_custom_description text default null,
  p_custom_tone text default null,
  p_reference_photo_uris text[] default '{}'
) returns public.postcards
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_credits integer;
  v_cost integer;
  v_from_city text := '';
  v_to_city text := '';
  v_result public.postcards;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_cost := case p_category
    when 'handwritten' then 1
    when 'photo' then 1
    when 'place' then 1
    when 'custom' then 1
    else 1
  end;

  select credits into v_credits
    from public.profiles
    where id = v_user_id
    for update;

  if v_credits is null or v_credits < v_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- to_city only resolves for friend sends. Void / pen-pal / claim sends
  -- keep the '' default — Lob doesn't read this column, it's just journal
  -- metadata for the sender's own map view.
  if p_to_friend_id is not null then
    select coalesce(city, '') into v_to_city
      from public.friends
      where id = p_to_friend_id and owner_id = v_user_id;
    v_to_city := coalesce(v_to_city, '');
  end if;

  select coalesce(city, '') into v_from_city
    from public.profiles
    where id = v_user_id;
  v_from_city := coalesce(v_from_city, '');

  insert into public.postcards (
    sender_id, to_kind, to_friend_id, from_city, to_city,
    category, credit_cost, message,
    place_name, photo_path, custom_description, custom_tone,
    reference_photo_uris
  )
  values (
    v_user_id, p_to_kind, p_to_friend_id, v_from_city, v_to_city,
    p_category, v_cost, p_message,
    p_place_name, p_photo_uri, p_custom_description, p_custom_tone,
    coalesce(p_reference_photo_uris, '{}')
  )
  returning * into v_result;

  if p_to_friend_id is not null then
    update public.friends
      set cards_sent = cards_sent + 1,
          last_interaction_at = now()
      where id = p_to_friend_id and owner_id = v_user_id;
  end if;

  insert into public.credit_transactions (owner_id, delta, reason, postcard_id)
    values (v_user_id, -v_cost, 'send_postcard', v_result.id);

  update public.profiles
    set credits = credits - v_cost
    where id = v_user_id;

  return v_result;
end;
$$;

grant execute on function public.send_postcard(
  uuid, text, text, text, text, text, text, text, text[]
) to authenticated;

-- Sanity check: only ONE send_postcard remains. Same check as 2026051213.
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_proc
    where proname = 'send_postcard'
      and pronamespace = 'public'::regnamespace;
  if v_count <> 1 then
    raise exception
      'Expected exactly 1 public.send_postcard function after fix, found %', v_count;
  end if;
end
$$;
