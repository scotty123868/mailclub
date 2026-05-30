-- Native Apple Maps route snapshot URL.
--
-- Round 22 added route_gif_url (a stylized cream-canvas arc GIF).
-- Round 24 replaces that with a full-color NATIVE Apple Maps snapshot
-- (mutedStandard, POI off, burgundy route line + endpoint pins),
-- generated via the Apple Maps Web Snapshot API in postcard-render-gifs.
--
-- New column instead of repurposing route_gif_url so the content type
-- is honest (this holds a .png, the old column implied a .gif) and so
-- a rollback can fall back to the gif cleanly.

alter table public.postcards
  add column if not exists route_map_url text;

comment on column public.postcards.route_map_url is
  'Native Apple Maps Web Snapshot (PNG) of the sender-city → recipient-city route, with burgundy route line and endpoint pins. Third tile in the iMessage celebration gallery (photo, card flip, route map). Null when geocoding or the snapshot request failed — gallery falls back to [photo, flip].';
