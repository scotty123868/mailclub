-- v0.7.0.9 emergency fix — two critical send-flow bugs blocking ALL postcards
--
-- BUG 1: ambiguous send_postcard()
--   The Phase 6 hardening migration (2026051211) tried to drop the
--   original send_postcard before recreating it, but the DROP statement
--   listed parameters in the order (uuid, text, ...) — the NEW order,
--   not the OLD order. The original signature was (text, uuid, ...).
--   Postgres's DROP silently no-op'd because no function with the listed
--   signature existed. Then CREATE OR REPLACE created a NEW function
--   with the new (uuid, text, ...) order. Result: TWO send_postcard
--   functions live side by side in the catalog. The PostgREST client
--   uses NAMED parameters, so the resolver can't pick which overload
--   to call:
--
--     ERROR: Could not choose the best candidate function between:
--       public.send_postcard(p_to_friend_id => uuid, p_to_kind => text, ...)
--       public.send_postcard(p_to_kind => text, p_to_friend_id => uuid, ...)
--
--   Every friend / self / penpal send path was hitting this. Below, we
--   DROP the old (text, uuid, ...) signature explicitly. The new
--   Phase 6 (uuid, text, ...) function stays.
--
-- BUG 2: function gen_random_bytes(integer) does not exist
--   Supabase moved the pgcrypto extension to the `extensions` schema
--   in a recent platform update. Our SECURITY DEFINER functions set
--   `search_path = public`, which excludes `extensions`. Unqualified
--   `gen_random_bytes(...)` calls inside send_postcard_via_claim and
--   create_reciprocation_token fail to resolve. Send-link cards and
--   reciprocation QR generation both throw at runtime.
--
--   Fix: append `extensions` to the search_path of every function that
--   touches pgcrypto. ALTER FUNCTION ... SET search_path is the
--   minimally-invasive change (no body rewrite).

-- ---------------------------------------------------------------------------
-- 1. Remove the duplicate send_postcard (the original v0.6 signature).
-- ---------------------------------------------------------------------------
-- Old signature, positional types: (text, uuid, text, text, text, text, text, text, text[])
-- This is the function from 2026051200_initial_schema.sql. After this drop,
-- only the Phase 6 (uuid, text, ...) function remains, so client RPC calls
-- resolve unambiguously.
drop function if exists public.send_postcard(
  text, uuid, text, text, text, text, text, text, text[]
);

-- ---------------------------------------------------------------------------
-- 2. Allow `extensions` in the search_path of functions that use pgcrypto.
-- ---------------------------------------------------------------------------
alter function public.send_postcard_via_claim(text, text, text, text)
  set search_path = public, extensions;

alter function public.create_reciprocation_token(uuid)
  set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 3. Sanity check: confirm only ONE send_postcard remains.
--    Raises if duplicate detected so the migration fails loudly rather
--    than landing silently broken.
-- ---------------------------------------------------------------------------
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
