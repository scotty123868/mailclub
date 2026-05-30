-- Store Lob's rendered postcard thumbnails on the postcards row.
--
-- Lob's API returns thumbnails[].small/medium/large for the front and
-- back of the composed card (photo + frame + greeting + stamp + QR +
-- address). Previously we let those URLs go unused. Now we persist
-- them so:
--
-- 1. c-bridge's og:image is the actual rendered card (not just the
--    raw camera-roll photo). iMessage preview now unfurls the
--    composition the recipient will hold in their hands.
--
-- 2. /c/<token> tracking page can show the back of the card too
--    (currently it only shows the front via photo_path).
--
-- 3. Lob status webhooks can re-attach thumbnails into the iMessage
--    thread on in_transit / delivered without needing a fresh Lob
--    API roundtrip.
--
-- Lob hosts these URLs for ~90 days after creation. Postcard delivery
-- cycle is ~5-7 days, so the URL is valid for every preview we
-- ever need. If a card is shared past 90 days, c-bridge falls back
-- to the raw photo_path the way it did before this migration.

alter table public.postcards
  add column if not exists lob_front_thumbnail_url text,
  add column if not exists lob_back_thumbnail_url text;

comment on column public.postcards.lob_front_thumbnail_url is
  'Lob-hosted PNG of the rendered front of the card (photo + cream frame + greeting + stamp). Used as og:image in c-bridge and as the inline attachment in the Mailed celebration. Null until lob-send-postcard runs.';

comment on column public.postcards.lob_back_thumbnail_url is
  'Lob-hosted PNG of the rendered back of the card (handwritten note + QR + address block). Reserved for future tracking-page UI (flip-to-see-back).';
