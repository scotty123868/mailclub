-- =========================================================================
-- 2026-05-19 — Create profile-photos storage bucket + RLS policies
-- =========================================================================
--
-- The 2026051204_profile_photo migration added the `profiles.photo_url`
-- column but only left dashboard instructions for the bucket itself. The
-- bucket was never created on production — every profile-photo upload was
-- failing with "Bucket not found" (caught in build 62 device testing).
--
-- This migration does the bucket creation in SQL so it actually runs:
--   1. `storage.buckets` INSERT (idempotent via ON CONFLICT)
--   2. RLS policies on `storage.objects` for read/insert/update/delete,
--      scoped to the bucket and to `<user_id>/...` folder ownership.
--
-- File size limit: 5 MB. Allowed MIME types: jpeg, png, webp, heic.
-- Bucket is PRIVATE — uploadProfilePhoto() in src/services/api.ts already
-- uses getPublicUrl on a non-public bucket, which Supabase Storage rewrites
-- to a signed-URL-style path. If we ever flip the bucket public, the
-- existing photo_url values keep working.
-- =========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  true,  -- public read so the existing getPublicUrl() flow returns a usable URL
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Drop any half-applied policies from earlier manual-dashboard attempts.
-- (No-ops on a fresh bucket.)
drop policy if exists "users read all profile photos" on storage.objects;
drop policy if exists "users upload to their own folder" on storage.objects;
drop policy if exists "users update their own photo" on storage.objects;
drop policy if exists "users delete their own photo" on storage.objects;

-- Anyone can read (the bucket is public; this policy is the safety net
-- if we flip public=false later).
create policy "users read all profile photos"
  on storage.objects for select
  using (bucket_id = 'profile-photos');

-- Authenticated users can write to their own folder only.
-- Path convention from src/services/api.ts uploadProfilePhoto:
--   `${userId}/avatar-${ts}.${ext}`
-- The (storage.foldername(name))[1] expression returns the first path
-- segment, which must equal the caller's auth uid.
create policy "users upload to their own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'profile-photos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users update their own photo"
  on storage.objects for update
  using (
    bucket_id = 'profile-photos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users delete their own photo"
  on storage.objects for delete
  using (
    bucket_id = 'profile-photos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
