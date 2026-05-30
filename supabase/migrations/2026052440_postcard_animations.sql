-- Animated GIFs for the iMessage celebration.
--
-- The Mailed bubble used to show a static front-thumbnail attachment.
-- Then we added front + back as a two-photo gallery. This migration
-- adds proper motion:
--
--   flip_gif_url  — front ↔ back card flip animation. Two-frame GIF
--                   that lets the sender see the actual back (address,
--                   note, QR) without scrolling or tapping.
--
--   route_gif_url — sender city → recipient city travel animation. A
--                   stylized map with the rendered card icon arcing
--                   between the two cities. Reinforces the "real
--                   postcard going somewhere" magic. Optional — only
--                   populated when route generator has lat/lon for
--                   both endpoints.
--
-- Both GIFs are rendered server-side by the postcard-render-gifs
-- Edge Function (synchronous after Lob success) and stored in the
-- postcard-renders Supabase storage bucket. Permanent URLs (signed
-- on read with 90-day TTL — long enough to outlast the delivery
-- cycle and any reasonable share-via-screenshot timeline).

alter table public.postcards
  add column if not exists flip_gif_url text,
  add column if not exists route_gif_url text;

comment on column public.postcards.flip_gif_url is
  'Two-frame animated GIF showing front then back of the rendered card. Generated synchronously after Lob success in lob-send-postcard. Attached as Act 2 gallery in the Mailed celebration. Null for pre-Lob (scheduled) cards or when generation failed (sender falls back to static thumbnails).';

comment on column public.postcards.route_gif_url is
  'Animated GIF of the rendered card icon traveling from sender city to recipient city across a stylized map. Generated when both endpoints have geocoded coordinates. Null when geocoding failed or route generation is disabled.';
