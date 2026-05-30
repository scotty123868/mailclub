-- Public storage bucket for server-rendered postcard animations.
--
-- Why public:
-- The GIFs are referenced in iMessage attachment URLs via LoopMessage.
-- iMessage's attachment cache may re-request the URL weeks later when
-- the user scrolls back through the thread. Signed URLs with expiration
-- would 403 on re-fetch and break the visual record.
--
-- Privacy posture:
-- The URLs themselves are random (object key = postcard_id UUID + path).
-- An attacker would need the postcard UUID to construct one. That's
-- the same posture as the c-bridge sharing model and the photo_path
-- signed URLs we already use. No PII in the GIF content beyond what's
-- on the postcard itself (which is being mailed publicly via USPS).

insert into storage.buckets (id, name, public)
values ('postcard-renders', 'postcard-renders', true)
on conflict (id) do update set public = true;

-- Public read policy. Authenticated upload only (service role).
do $$
begin
  -- Service role can do everything via the API. We just need public
  -- read for the iMessage attachment URLs to work.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'postcard_renders_public_read'
  ) then
    create policy postcard_renders_public_read
      on storage.objects for select
      using (bucket_id = 'postcard-renders');
  end if;
end $$;
