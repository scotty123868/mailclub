-- v1.1: create the sms-photos Storage bucket for inbound MMS photos.
--
-- This bucket holds raw photos texted to our Twilio number. Photos are:
--   - written by sms-inbound Edge Function (service_role)
--   - read via signed URLs minted by sms-draft-resolve Edge Function
--   - never accessible to anon or authenticated clients directly
--
-- Private bucket; 10 MB file size limit (MMS photos are typically 1-3 MB).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sms-photos',
  'sms-photos',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/gif', 'image/heic', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No RLS policies for anon or authenticated. Default deny is correct.
-- Service-role bypasses RLS and is what the Edge Functions use.
