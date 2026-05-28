-- Lob integration schema additions
--
-- After running this migration:
--   1. Create Storage bucket `postcard-renders` in the Supabase dashboard
--      (NOT public; we use signed/public URLs via Storage policies below).
--      Max file size: 10 MB. MIME types: image/png, image/jpeg.
--   2. Set the Lob secret key:
--        supabase secrets set LOB_API_KEY=test_xxxxxxxxxxxxxxxxx
--   3. Deploy the Edge Function:
--        supabase functions deploy lob-send-postcard --no-verify-jwt
--   4. (Optional) Set up a Lob webhook → /lob-webhook function for delivery
--      status updates. Stub for that is in LOB_INTEGRATION.md.

-- ---------------------------------------------------------------------------
-- postcards table: Lob tracking columns
-- ---------------------------------------------------------------------------
alter table public.postcards
  add column if not exists lob_id text,
  add column if not exists lob_status text
    check (lob_status in ('queued','rendered','in_transit','re_routed','returned_to_sender','delivered','failed')),
  add column if not exists lob_expected_delivery date,
  add column if not exists lob_error text;

create index if not exists postcards_lob_status_idx on public.postcards (lob_status);
create index if not exists postcards_lob_id_idx on public.postcards (lob_id);

comment on column public.postcards.lob_id is 'Lob postcard ID. Populated after successful submission.';
comment on column public.postcards.lob_status is 'Lifecycle status from Lob webhooks (queued → in_transit → delivered).';
comment on column public.postcards.lob_expected_delivery is 'Expected USPS delivery date from Lob response.';
comment on column public.postcards.lob_error is 'Most recent error from Lob submission, if any.';

-- ---------------------------------------------------------------------------
-- friends table: mailing address fields (needed for Lob to actually mail)
-- ---------------------------------------------------------------------------
-- The existing friends table tracks city + state; we need a real mailing
-- address for Lob. These are optional so friend QR additions don't break,
-- but `send_postcard` will reject when they're missing.
alter table public.friends
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists address_city text,
  add column if not exists address_state text,
  add column if not exists address_zip text,
  add column if not exists address_country text default 'US';

comment on column public.friends.address_line1 is 'Street address line 1. Required for Lob delivery.';

-- ---------------------------------------------------------------------------
-- profiles table: sender mailing address
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists address_line1 text,
  add column if not exists address_zip text;

-- ---------------------------------------------------------------------------
-- Storage RLS for postcard-renders bucket
-- ---------------------------------------------------------------------------
-- Paste these in SQL editor AFTER creating the bucket in the dashboard:
--
--   create policy "users read their own renders"
--     on storage.objects for select using (
--       bucket_id = 'postcard-renders'
--       and (storage.foldername(name))[1] = auth.uid()::text
--     );
--   create policy "users insert their own renders"
--     on storage.objects for insert with check (
--       bucket_id = 'postcard-renders'
--       and (storage.foldername(name))[1] = auth.uid()::text
--     );
--   create policy "users update their own renders"
--     on storage.objects for update using (
--       bucket_id = 'postcard-renders'
--       and (storage.foldername(name))[1] = auth.uid()::text
--     );
--
-- Lob also needs to READ the URLs we POST it. Two options:
--   A) Make the bucket "public". anyone with the URL can read. Simpler.
--   B) Generate signed URLs at submit time (expire after 24h). More secure.
--
-- For TestFlight beta we recommend A (public bucket) since the URLs include
-- random UUIDs and are scoped to the user folder anyway. Switch to B before
-- public App Store launch if you handle sensitive content.
