-- Mailroom v1 schema
-- Run via Supabase Management API on project nlwnmgwylmmnaemdnzlq.
-- Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

------------------------------------------------------------
-- 1. profiles. one row per auth.user
------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  city text not null default '',
  state text not null default '',
  since text not null default to_char(now(), 'YYYY'),
  avatar_initials text not null default '',
  tagline text not null default '',
  interests text not null default '',
  send_me text not null default '',
  birthday text not null default '',
  currently_into text not null default '',
  credits int not null default 5 check (credits >= 0),
  free_credits_remaining int not null default 5 check (free_credits_remaining >= 0),
  has_seen_free_credits_intro boolean not null default false,
  has_completed_signup boolean not null default false,
  notifications jsonb not null default '{"cardDelivered": true, "replyReceived": true, "birthdays": true}'::jsonb,
  privacy jsonb not null default '{"whoCanSendToMe": "anyone"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

------------------------------------------------------------
-- 2. friends. user's rolodex
------------------------------------------------------------

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  city text not null default '',
  state text not null default '',
  avatar_initials text not null default '',
  cards_sent int not null default 0 check (cards_sent >= 0),
  cards_received int not null default 0 check (cards_received >= 0),
  connection_type text not null default 'postcard-invite' check (connection_type in ('in-person', 'postcard-invite')),
  last_interaction_at timestamptz not null default now(),
  relationship_signal text,
  signal_tone text check (signal_tone in ('red', 'green', 'blue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists friends_owner_id_idx on public.friends(owner_id);

------------------------------------------------------------
-- 3. postcards. every send
------------------------------------------------------------

create table if not exists public.postcards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  to_kind text not null default 'friend' check (to_kind in ('friend', 'void')),
  to_friend_id uuid references public.friends(id) on delete set null,
  from_city text not null default '',
  to_city text not null default '',
  category text not null check (category in ('handwritten', 'photo', 'place', 'custom')),
  credit_cost int not null check (credit_cost >= 1),
  status text not null default 'sent' check (status in ('draft', 'sent', 'delivered')),
  message text not null default '',
  place_name text,
  photo_uri text,
  custom_description text,
  custom_tone text check (custom_tone in ('playful', 'romantic', 'formal', 'weird')),
  reference_photo_uris text[] not null default '{}',
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists postcards_owner_id_idx on public.postcards(owner_id);
create index if not exists postcards_owner_sent_at_idx on public.postcards(owner_id, sent_at desc);

------------------------------------------------------------
-- 4. void_replies. incoming from strangers (server-populated)
------------------------------------------------------------

create table if not exists public.void_replies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  from_label text not null,
  message text not null,
  received_at timestamptz not null default now()
);

create index if not exists void_replies_owner_id_idx on public.void_replies(owner_id);

------------------------------------------------------------
-- 5. credit_transactions. audit log
------------------------------------------------------------

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  delta int not null,
  reason text not null,
  postcard_id uuid references public.postcards(id) on delete set null,
  ts timestamptz not null default now()
);

create index if not exists credit_transactions_owner_ts_idx on public.credit_transactions(owner_id, ts desc);

------------------------------------------------------------
-- updated_at triggers
------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists friends_updated_at on public.friends;
create trigger friends_updated_at before update on public.friends
  for each row execute function public.touch_updated_at();

------------------------------------------------------------
-- Auto-create a profile row on signup
------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------
-- RPC: complete_signup
------------------------------------------------------------

create or replace function public.complete_signup(
  p_name text,
  p_city text,
  p_state text
) returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
  v_initials text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Derive initials from name (first letter of each whitespace-separated word, max 2 chars)
  v_initials := upper(coalesce(
    nullif(regexp_replace(trim(p_name), '(\m\S)\S*\s*', '\1', 'g'), ''),
    substr(coalesce(p_name, ''), 1, 2)
  ));
  if length(v_initials) > 2 then
    v_initials := substr(v_initials, 1, 2);
  end if;

  update public.profiles set
    name = coalesce(nullif(trim(p_name), ''), 'Mailroom member'),
    city = coalesce(nullif(trim(p_city), ''), 'Somewhere'),
    state = coalesce(nullif(trim(p_state), ''), ''),
    since = to_char(now(), 'YYYY'),
    avatar_initials = coalesce(nullif(v_initials, ''), '?'),
    has_completed_signup = true,
    has_seen_free_credits_intro = true
  where id = auth.uid()
  returning * into result;

  return result;
end;
$$;

------------------------------------------------------------
-- RPC: send_postcard (transactional credit + insert)
------------------------------------------------------------

create or replace function public.send_postcard(
  p_to_kind text,
  p_to_friend_id uuid,
  p_category text,
  p_message text,
  p_photo_uri text default null,
  p_place_name text default null,
  p_custom_description text default null,
  p_custom_tone text default null,
  p_reference_photo_uris text[] default '{}'
) returns public.postcards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost int;
  v_user uuid := auth.uid();
  v_to_city text := '';
  v_from_city text := '';
  v_status text := 'sent';
  result public.postcards;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- Cost map (server-authoritative. clients can't lie)
  v_cost := case p_category
    when 'handwritten' then 1
    when 'photo' then 2
    when 'place' then 2
    when 'custom' then 5
    else null
  end;

  if v_cost is null then
    raise exception 'invalid category %', p_category;
  end if;

  if p_to_kind not in ('friend', 'void') then
    raise exception 'invalid to_kind %', p_to_kind;
  end if;

  if p_to_kind = 'friend' and p_to_friend_id is null then
    raise exception 'friend send requires to_friend_id';
  end if;

  if p_category = 'custom' then
    v_status := 'draft';
  end if;

  -- Pull from_city + to_city
  select city into v_from_city from public.profiles where id = v_user;
  if p_to_kind = 'friend' then
    select city into v_to_city from public.friends where id = p_to_friend_id and owner_id = v_user;
    if v_to_city is null then
      raise exception 'friend not found or not owned by you';
    end if;
  else
    v_to_city := 'Anywhere';
  end if;

  -- Atomically check + deduct
  update public.profiles
    set credits = credits - v_cost,
        free_credits_remaining = greatest(0, free_credits_remaining - v_cost)
  where id = v_user and credits >= v_cost;

  if not found then
    raise exception 'insufficient credits';
  end if;

  -- Insert postcard
  insert into public.postcards (
    owner_id, to_kind, to_friend_id, from_city, to_city,
    category, credit_cost, status, message,
    place_name, photo_uri, custom_description, custom_tone, reference_photo_uris
  ) values (
    v_user, p_to_kind, p_to_friend_id, coalesce(v_from_city, ''), v_to_city,
    p_category, v_cost, v_status, coalesce(p_message, ''),
    p_place_name, p_photo_uri, p_custom_description, p_custom_tone, coalesce(p_reference_photo_uris, '{}')
  ) returning * into result;

  -- Bump friend's cards_sent
  if p_to_kind = 'friend' then
    update public.friends
      set cards_sent = cards_sent + 1,
          last_interaction_at = now()
    where id = p_to_friend_id and owner_id = v_user;
  end if;

  -- Log transaction
  insert into public.credit_transactions (owner_id, delta, reason, postcard_id)
  values (v_user, -v_cost, 'send_' || p_category, result.id);

  return result;
end;
$$;

------------------------------------------------------------
-- RPC: purchase_credits (placeholder until Apple IAP receipt validation)
------------------------------------------------------------

create or replace function public.purchase_credits(p_pack_id text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits int;
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_credits := case p_pack_id
    when 'p5' then 5
    when 'p10' then 10
    when 'p25' then 25
    when 'p50' then 50
    else null
  end;

  if v_credits is null then
    raise exception 'invalid pack %', p_pack_id;
  end if;

  -- TODO: validate Apple/Stripe receipt before crediting. Until then this is
  -- gated by the client UI (CreditsSheet shows "Coming soon". Buy is disabled).
  -- This RPC stays here so the client wire-up is ready when IAP lands.

  update public.profiles
    set credits = credits + v_credits
  where id = auth.uid()
  returning * into result;

  insert into public.credit_transactions (owner_id, delta, reason)
  values (auth.uid(), v_credits, 'purchase_' || p_pack_id);

  return result;
end;
$$;

------------------------------------------------------------
-- Row-Level Security
------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.friends enable row level security;
alter table public.postcards enable row level security;
alter table public.void_replies enable row level security;
alter table public.credit_transactions enable row level security;

-- profiles: read/update own row
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- friends: full CRUD on own rows
drop policy if exists "friends_select_own" on public.friends;
create policy "friends_select_own" on public.friends
  for select using (owner_id = auth.uid());
drop policy if exists "friends_insert_own" on public.friends;
create policy "friends_insert_own" on public.friends
  for insert with check (owner_id = auth.uid());
drop policy if exists "friends_update_own" on public.friends;
create policy "friends_update_own" on public.friends
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "friends_delete_own" on public.friends;
create policy "friends_delete_own" on public.friends
  for delete using (owner_id = auth.uid());

-- postcards: read own, insert via RPC only (client can't bypass cost logic)
drop policy if exists "postcards_select_own" on public.postcards;
create policy "postcards_select_own" on public.postcards
  for select using (owner_id = auth.uid());
-- No INSERT/UPDATE/DELETE policies → only SECURITY DEFINER RPCs can write.

-- void_replies: read own only; server writes via service_role
drop policy if exists "void_replies_select_own" on public.void_replies;
create policy "void_replies_select_own" on public.void_replies
  for select using (owner_id = auth.uid());

-- credit_transactions: read own only; server writes via RPC
drop policy if exists "credit_transactions_select_own" on public.credit_transactions;
create policy "credit_transactions_select_own" on public.credit_transactions
  for select using (owner_id = auth.uid());

------------------------------------------------------------
-- Grants. allow authenticated users to call our RPCs
------------------------------------------------------------

grant execute on function public.complete_signup(text, text, text) to authenticated;
grant execute on function public.send_postcard(text, uuid, text, text, text, text, text, text, text[]) to authenticated;
grant execute on function public.purchase_credits(text) to authenticated;
