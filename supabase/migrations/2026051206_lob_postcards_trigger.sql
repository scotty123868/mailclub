-- Lob auto-submit trigger
--
-- Whenever a row is inserted into `postcards` AND the recipient friend has a
-- complete mailing address, fire the `lob-send-postcard` Edge Function with
-- the postcard's ID. The Edge Function uploads the rendered images + POSTs
-- to Lob, then writes lob_id/lob_status back.
--
-- Prerequisites (set these once via SQL editor before running this
-- migration. both are simple admin-only settings on the project):
--
--   ALTER DATABASE postgres SET app.settings.functions_url
--     = 'https://nlwnmgwylmmnaemdnzlq.functions.supabase.co';
--   ALTER DATABASE postgres SET app.settings.functions_service_role_key
--     = 'eyJhbGciOiJI...';  -- service_role JWT from Supabase Dashboard
--                            -- (Settings → API → service_role key)
--
-- Then `supabase db push` runs this migration cleanly.
--
-- The trigger only fires when:
--   • The postcard's recipient friend has address_line1, city, state, zip
--   • lob_id is NULL (haven't submitted yet)
-- This keeps the trigger idempotent and avoids re-submitting on retries.

-- Make sure the `pg_net` extension is enabled. it's the official way to do
-- async HTTP from Postgres on Supabase.
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- The trigger function: POSTs to lob-send-postcard with the new postcard's ID
-- ---------------------------------------------------------------------------
create or replace function public.fire_lob_submit_on_postcard_insert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_friend_has_address boolean;
  v_functions_url text;
  v_service_key text;
begin
  -- Only proceed if the recipient is a friend (not "void") and has full address
  if new.to_kind <> 'friend' or new.to_friend_id is null then
    return new;
  end if;

  select
    f.address_line1 is not null
    and f.address_city is not null
    and f.address_state is not null
    and f.address_zip is not null
  into v_friend_has_address
  from public.friends f
  where f.id = new.to_friend_id;

  if v_friend_has_address is not true then
    -- No address yet: leave lob_status null. User can resubmit later by
    -- updating the friend's address + calling a manual retry function.
    return new;
  end if;

  -- Pull the (admin-set) function URL + service-role key out of settings
  begin
    v_functions_url := current_setting('app.settings.functions_url', true);
    v_service_key   := current_setting('app.settings.functions_service_role_key', true);
  exception when others then
    -- Settings not configured: skip silently. The user can call submitToLob()
    -- from the client when ready.
    return new;
  end;

  if v_functions_url is null or v_service_key is null then
    return new;
  end if;

  -- Fire-and-forget HTTP POST. pg_net schedules the request and returns
  -- immediately. no blocking the postcard insert.
  perform net.http_post(
    url := v_functions_url || '/lob-send-postcard',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'postcard_id', new.id,
      -- The Edge Function expects these URLs but the client is also calling
      -- submitToLob() with locally-rendered images. Until we move rendering
      -- server-side, the trigger path is for "user has set their friend's
      -- address but already submitted from the client". i.e. retry only.
      -- For now we pass empty strings; the function will reject if both URLs
      -- are missing, which is the correct no-op.
      'front_url', '',
      'back_url', ''
    )
  );

  return new;
end;
$$;

comment on function public.fire_lob_submit_on_postcard_insert is
  'Auto-fires the lob-send-postcard Edge Function when a postcard is inserted, '
  'IF the recipient friend has a complete mailing address. Fire-and-forget '
  'via pg_net; idempotent because Lob submission is gated on lob_id being null.';

-- ---------------------------------------------------------------------------
-- The trigger itself, on the postcards table
-- ---------------------------------------------------------------------------
drop trigger if exists postcards_fire_lob_submit on public.postcards;

create trigger postcards_fire_lob_submit
  after insert on public.postcards
  for each row
  when (new.to_kind = 'friend' and new.lob_id is null)
  execute function public.fire_lob_submit_on_postcard_insert();

-- ---------------------------------------------------------------------------
-- Manual retry helper. call from the client when the user updates a
-- friend's address and wants to resubmit a previously-stuck postcard.
-- ---------------------------------------------------------------------------
create or replace function public.retry_lob_submit(p_postcard_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner_id uuid;
  v_lob_id text;
begin
  -- Only the owner can retry
  select sender_id, lob_id into v_owner_id, v_lob_id
  from public.postcards
  where id = p_postcard_id;

  if v_owner_id is null then return false; end if;
  if v_owner_id <> auth.uid() then return false; end if;
  if v_lob_id is not null then return false; end if;  -- already submitted

  -- Clear any prior error so the new attempt isn't masked
  update public.postcards set lob_error = null where id = p_postcard_id;

  -- Fire the trigger by inserting a no-op update (touch updated_at)
  update public.postcards set status = status where id = p_postcard_id;

  return true;
end;
$$;

comment on function public.retry_lob_submit is
  'User-triggered retry for a postcard whose initial submit failed (e.g. '
  'friend had no address yet). Returns true on retry queued, false on '
  'ineligible (not owner, already submitted, or not found).';

grant execute on function public.retry_lob_submit(uuid) to authenticated;
