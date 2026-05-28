-- v0.7.0.29. reduce starter free credits from 3 → 1.
--
-- Founder direction: one free card is enough to validate the product
-- (send your first, see it arrive) without giving away so much value
-- that users never convert to paid. Second send becomes a stamp
-- purchase. that's the real revenue loop.
--
-- Affects:
--   - profiles.credits default: 3 → 1
--   - profiles.free_credits_remaining default: 5 → 1
--     (this was already a separate "remaining" counter that started
--      higher than actual credits in the original schema; aligning
--      both to 1 so the counters tell a consistent story)
--   - complete_signup RPC: hardcodes free credits, needs update.
--
-- ONE-WAY change (existing profiles keep whatever they have). Only
-- new profiles created after this migration get the 1-credit default.

-- Default for the column (new rows)
alter table public.profiles
  alter column credits set default 1;
alter table public.profiles
  alter column free_credits_remaining set default 1;

-- complete_signup RPC. find it + patch the hardcoded credit values.
-- The RPC was created in 2026051200_initial_schema.sql:170-200 and
-- modified in 2026051202_fix_complete_signup_initials.sql. The current
-- form sets credits=3 and free_credits_remaining=5 inside the INSERT/
-- UPDATE. Rather than rewrite the whole RPC (risky), this migration
-- patches the magic numbers in the function body via a CREATE OR
-- REPLACE that mirrors the latest known body with credits=1.

create or replace function public.complete_signup(
  p_name text,
  p_city text,
  p_state text,
  p_device_id text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_initials text;
  v_existing public.profiles;
  v_result public.profiles;
  v_device_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- v0.7.0.11 device-id cap: at most 2 accounts per iOS vendor id.
  -- Skip when p_device_id is null (older clients without expo-application).
  if p_device_id is not null and length(trim(p_device_id)) > 0 then
    select count(*) into v_device_count
      from public.profiles
      where device_id = p_device_id
        and id <> v_user_id;
    if v_device_count >= 2 then
      raise exception 'DEVICE_CAP_REACHED';
    end if;
  end if;

  -- Compute initials (first letter of each whitespace-separated token).
  v_initials := upper(coalesce(
    regexp_replace(
      array_to_string(
        array(select substring(t from 1 for 1)
              from regexp_split_to_table(trim(p_name), '\s+') as t
              where length(t) > 0),
        ''
      ),
      '[^A-Z0-9]', '', 'g'
    ),
    ''
  ));
  if length(v_initials) > 3 then
    v_initials := substring(v_initials from 1 for 3);
  end if;

  -- v0.7.0.29: free credit baseline dropped from 3 → 1.
  insert into public.profiles (
    id, name, city, state, avatar_initials,
    credits, free_credits_remaining, has_seen_free_credits_intro,
    has_completed_signup, device_id
  ) values (
    v_user_id, p_name, p_city, p_state, v_initials,
    1, 1, false,
    true, p_device_id
  )
  on conflict (id) do update
    set name = excluded.name,
        city = excluded.city,
        state = excluded.state,
        avatar_initials = excluded.avatar_initials,
        has_completed_signup = true,
        device_id = coalesce(public.profiles.device_id, excluded.device_id)
  returning * into v_result;

  return v_result;
end;
$$;

grant execute on function public.complete_signup(text, text, text, text) to authenticated;
