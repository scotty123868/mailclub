-- Great-circle distance (statute miles) between sender and recipient
-- cities, computed during route-map generation in postcard-render-gifs.
-- Surfaced in the celebration caption ("· To Naples, FL · ~2,400 miles
-- by post") so the sender feels the scale of the journey.

alter table public.postcards
  add column if not exists route_miles integer;

comment on column public.postcards.route_miles is
  'Great-circle distance in miles between sender and recipient cities. Computed alongside the route map snapshot. Null when geocoding failed.';
