-- Adds a profile photo URL to profiles.
-- The actual photo file lives in the `profile-photos` Storage bucket; this
-- column just holds the public URL (or null for "use my monogram").
--
-- After running this migration, create the storage bucket in the Supabase
-- dashboard:
--   1. Storage → New bucket
--   2. Name: profile-photos
--   3. Public bucket: NO (we'll generate signed URLs or use anon-readable RLS)
--   4. File size limit: 5 MB
--   5. Allowed MIME types: image/jpeg, image/png, image/webp, image/heic
--
-- Storage RLS for the bucket (paste into SQL editor after creating it):
--   create policy "users read all profile photos"
--     on storage.objects for select
--     using (bucket_id = 'profile-photos');
--   create policy "users upload to their own folder"
--     on storage.objects for insert with check (
--       bucket_id = 'profile-photos'
--       and (storage.foldername(name))[1] = auth.uid()::text
--     );
--   create policy "users update their own photo"
--     on storage.objects for update using (
--       bucket_id = 'profile-photos'
--       and (storage.foldername(name))[1] = auth.uid()::text
--     );
--   create policy "users delete their own photo"
--     on storage.objects for delete using (
--       bucket_id = 'profile-photos'
--       and (storage.foldername(name))[1] = auth.uid()::text
--     );

alter table public.profiles
  add column if not exists photo_url text;

comment on column public.profiles.photo_url is
  'Public URL of a profile photo in the profile-photos Storage bucket. Null = use monogram.';
