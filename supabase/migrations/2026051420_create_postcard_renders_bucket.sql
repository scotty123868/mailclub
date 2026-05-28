-- v0.7.0.20. create the postcard-renders Storage bucket.
--
-- THIS IS THE BUG that's been silently failing every welcome-flow Mail-it
-- tap since build 22. src/services/lob.ts:73 uploads the rendered front
-- + back PNG to bucket `postcard-renders`. The bucket was never created
-- in any migration. it was assumed to be set up by hand in the Supabase
-- dashboard and got missed.
--
-- Symptom on TestFlight: user taps Mail it → submitToLob() → uploadSide()
-- → supabase.storage.from("postcard-renders").upload(...) → "Bucket not
-- found" → submitToLob returns ok:false with that error string →
-- humanizeLobError surfaces "Bucket not found" to the user via the
-- "Couldn't print your card" alert (build 24+).
--
-- All the work we did chasing Lob strictness, refund mechanisms, view-shot
-- URI schemes. those were real bugs but downstream of this one. The
-- upload never reached Lob; Lob never saw an address to reject.
--
-- Configure:
--   - public = true: Lob fetches the PNGs by URL during postcard rendering.
--     They need to be reachable without auth.
--   - file_size_limit = 10MB: generous for a 1875×1275 PNG (~500KB-2MB).
--   - allowed_mime_types: image/png only.
--   - RLS: authenticated users can upload to paths matching their own
--     user_id (mirrors the layout used by lob.ts uploadSide). Service role
--     (Edge Functions) can do anything.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'postcard-renders',
  'postcard-renders',
  true,
  10485760, -- 10 MB
  array['image/png']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS policies for postcard-renders.
-- Path layout from src/services/lob.ts:
--   {user_id}/{postcard_id}/front.png
--   {user_id}/{postcard_id}/back.png
-- So row's name field starts with the user's auth.uid().

-- Drop any prior policies so this migration is idempotent.
drop policy if exists "postcard_renders_insert_own" on storage.objects;
drop policy if exists "postcard_renders_update_own" on storage.objects;
drop policy if exists "postcard_renders_select_public" on storage.objects;

-- Anyone can read (bucket is public). Lob's image fetcher hits the
-- public URL with no auth header.
create policy "postcard_renders_select_public" on storage.objects
  for select
  using (bucket_id = 'postcard-renders');

-- Authenticated users can write to {their_user_id}/...
create policy "postcard_renders_insert_own" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'postcard-renders'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "postcard_renders_update_own" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'postcard-renders'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'postcard-renders'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
