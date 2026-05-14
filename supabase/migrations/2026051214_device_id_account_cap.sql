-- v0.7.0.11 — per-device account cap to limit free-credit abuse
--
-- Threat model: the welcome flow gives every new account a free first
-- card. A bad actor with one phone could currently spin up dozens of
-- Apple IDs / email addresses and burn through unlimited free sends.
--
-- Mitigation: track `iOSVendorId` (from `expo-application.getIosIdForVendorAsync`)
-- on every profile. Cap accounts per device id at 2 — accommodates
-- shared devices (couples on a family iPad, parent + kid) without
-- letting one person grind out free credits.
--
-- The vendor id persists across reinstalls IF ANY other app from the
-- same vendor (us) remains installed. It resets if the user deletes
-- every Mailroom-vendor app from the device. That's an acceptable
-- escape valve — deleting an app to get more free credits is a real
-- cost, much higher than typing in another email.

-- 1. Column + index
alter table public.profiles
  add column if not exists device_id text;

create index if not exists profiles_device_id_idx
  on public.profiles (device_id) where device_id is not null;

-- 2. complete_signup now accepts p_device_id and enforces the cap.
--    Existing signature stays parameter-compatible: device_id is the
--    new trailing arg, defaulted to null so older clients (pre-0.7.0.11)
--    keep working through the launch window. They just don't enforce
--    the cap until they update.
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
  v_user uuid := auth.uid();
  v_existing_count int;
  v_max_per_device int := 2;
  v_initials text;
  v_result public.profiles;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  -- v0.7.0.11: device cap. If the same iOS vendor id has already
  -- spun up max_per_device profiles, reject. Skips check when
  -- p_device_id is null (older client) so we don't lock anyone out
  -- during the rollout.
  if p_device_id is not null and length(trim(p_device_id)) > 0 then
    select count(*) into v_existing_count
      from public.profiles
      where device_id = p_device_id and id <> v_user;
    if v_existing_count >= v_max_per_device then
      raise exception 'DEVICE_LIMIT_REACHED';
    end if;
  end if;

  -- Generate avatar initials from the first + last name. Fall back to
  -- the first two chars of the first word if the user gave us only one
  -- name. Matches the v0.6.x behavior from
  -- 2026051202_fix_complete_signup_initials.sql.
  v_initials := upper(
    coalesce(
      nullif(
        substr(coalesce(split_part(trim(p_name), ' ', 1), ''), 1, 1) ||
        substr(coalesce(split_part(trim(p_name), ' ', 2), ''), 1, 1),
        ''
      ),
      substr(trim(p_name), 1, 2)
    )
  );

  insert into public.profiles (id, name, city, state, avatar_initials, device_id)
  values (v_user, p_name, p_city, p_state, v_initials, p_device_id)
  on conflict (id) do update
    set name = excluded.name,
        city = excluded.city,
        state = excluded.state,
        avatar_initials = coalesce(excluded.avatar_initials, public.profiles.avatar_initials),
        -- Don't reset device_id once set — preserves the first device
        -- recorded, so the cap holds across signups that retry.
        device_id = coalesce(public.profiles.device_id, excluded.device_id)
  returning * into v_result;

  return v_result;
end
$$;

grant execute on function public.complete_signup(text, text, text, text) to authenticated;
grant execute on function public.complete_signup(text, text, text) to authenticated; -- legacy clients
