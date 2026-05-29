-- Collect the SENDER's full mailing address (line1 + line2 + zip)
-- and keep it private. Only the city appears on the postcard front.
-- This sets up the pen pal reciprocation mechanic: a stranger or
-- friend can mail a card back to this exact address, but they never
-- see the full street/zip themselves (the routing happens through
-- our bot).
--
-- profiles.city and profiles.state already exist and now formally
-- represent the user's home city + state. line1/line2/zip are new.
--
-- Backwards-compatible: existing users have city/state set but
-- line1/line2/zip null. We re-prompt them for full address on their
-- next send.

alter table public.profiles
  add column if not exists home_line1 text;

alter table public.profiles
  add column if not exists home_line2 text;

alter table public.profiles
  add column if not exists home_zip text;

comment on column public.profiles.home_line1 is
  'Street address line 1 of the user''s home address. Used for pen pal '
  'reciprocation (cards mailed back to the user). Never appears on '
  'the postcard front. The postcard front shows only profiles.city + '
  'profiles.state as the return location.';

comment on column public.profiles.home_line2 is
  'Optional apt/unit/suite for the user''s home address. Private.';

comment on column public.profiles.home_zip is
  'ZIP code of the user''s home address. Used for Lob mail-back routing '
  'and pen pal matching. Never appears on the postcard front.';

-- Helpful partial index for the pen pal pool: users who have provided
-- a full home address are eligible to receive cards from strangers.
create index if not exists profiles_home_complete_idx
  on public.profiles(id)
  where home_line1 is not null and home_zip is not null
    and city is not null and state is not null;
