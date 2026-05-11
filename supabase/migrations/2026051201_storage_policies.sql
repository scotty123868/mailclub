-- Storage RLS policies for the postcard-photos bucket
-- Folder convention: <user_id>/<filename>
-- Each user can write/read/delete only under their own user_id folder.

drop policy if exists "postcard_photos_authenticated_select" on storage.objects;
create policy "postcard_photos_authenticated_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'postcard-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "postcard_photos_authenticated_insert" on storage.objects;
create policy "postcard_photos_authenticated_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'postcard-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "postcard_photos_authenticated_update" on storage.objects;
create policy "postcard_photos_authenticated_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'postcard-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "postcard_photos_authenticated_delete" on storage.objects;
create policy "postcard_photos_authenticated_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'postcard-photos' and (storage.foldername(name))[1] = auth.uid()::text);
