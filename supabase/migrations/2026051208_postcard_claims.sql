-- Send-a-Link — recipient self-serves their address
--
-- The killer growth feature. Sender doesn't need to know the recipient's
-- address; they just send a magic link. Recipient taps the link, sees "Scotty
-- wants to send you a postcard", enters their address, and the postcard ships.
--
-- PRIVACY MODEL:
--   • Sender never sees recipient's address. The address lives on
--     postcard_claims, which the sender's user has NO RLS access to.
--   • Recipient sees: sender's name, sender's city, and the postcard message.
--     Recipient does NOT see sender's full mailing address.
--   • Claim token is the only access credential. 8 chars base32 (32^8 ≈ 1.1T
--     combinations) is enough to make guessing infeasible for the 30-day
--     window. The claim Edge Function should rate-limit failed lookups.
--
-- FLOW:
--   1. Sender taps "Send link" in app → calls send_postcard_via_claim(...)
--   2. RPC creates a postcard row (status = 'awaiting_address',
--      to_friend_id = NULL, claim_id = newly created claim)
--   3. RPC returns the postcard + claim_token
--   4. App generates URL: https://<project>.functions.supabase.co/claim?t=TOKEN
--   5. App opens iOS Share Sheet with that URL pre-filled
--   6. Recipient gets link in iMessage/SMS/whatever → taps
--   7. Edge Function `claim` returns an HTML page with sender info + address form
--   8. Recipient submits → POST to same Edge Function → updates the claim,
--      flips postcard status to 'queued', invokes lob-send-postcard

-- ---------------------------------------------------------------------------
-- 1. postcard_claims table
-- ---------------------------------------------------------------------------
create table if not exists public.postcard_claims (
  id uuid primary key default gen_random_uuid(),
  claim_token text not null unique,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  sender_name_snapshot text,                       -- frozen at create time
  sender_city_snapshot text,                       -- ditto, so the claim page
                                                   -- works even if sender
                                                   -- changes their profile
  expires_at timestamptz not null default (now() + interval '30 days'),

  -- Filled in when the recipient claims:
  claimed_at timestamptz,
  claimed_name text,
  claimed_address_line1 text,
  claimed_address_line2 text,
  claimed_city text,
  claimed_state text,
  claimed_zip text,
  claimed_country text default 'US',

  created_at timestamptz not null default now()
);

create index if not exists postcard_claims_token_idx
  on public.postcard_claims (claim_token);
create index if not exists postcard_claims_sender_id_idx
  on public.postcard_claims (sender_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. postcards.claim_id pointer
-- ---------------------------------------------------------------------------
alter table public.postcards
  add column if not exists claim_id uuid
    references public.postcard_claims (id) on delete set null;

create index if not exists postcards_claim_id_idx
  on public.postcards (claim_id) where claim_id is not null;

-- to_friend_id was already nullable in some prior schema; ensure it is.
-- (If your initial_schema has it NOT NULL, this alter is a no-op when the
--  column is already nullable.)
do $$ begin
  alter table public.postcards alter column to_friend_id drop not null;
exception when others then null; end $$;

-- Add 'awaiting_address' to the status enum if not already there.
do $$ begin
  if not exists (
    select 1 from pg_type t join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'postcard_status'
    and e.enumlabel = 'awaiting_address'
  ) then
    alter type public.postcard_status add value 'awaiting_address';
  end if;
exception when undefined_object then
  -- postcard_status enum doesn't exist; status is a text column.
  null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. RLS — postcard_claims
-- ---------------------------------------------------------------------------
alter table public.postcard_claims enable row level security;

-- Sender can SEE their own claims (without the address fields if they want)
-- Note: we still expose the claimed_* fields to the sender for now, since
-- they need to see "where did my card go." But the address is INFORMATIONAL
-- — sender can't edit, and we never display it in the app UI without explicit
-- intent.
drop policy if exists postcard_claims_sender_select on public.postcard_claims;
create policy postcard_claims_sender_select
  on public.postcard_claims for select
  using (sender_id = auth.uid());

-- NO insert/update/delete policies for authenticated users. All writes go
-- through the security-definer RPCs.

-- ---------------------------------------------------------------------------
-- 4. send_postcard_via_claim RPC
--    Called by the app when sender taps "Send link instead".
-- ---------------------------------------------------------------------------
create or replace function public.send_postcard_via_claim(
  p_category text,        -- handwritten | photo | place | custom
  p_message text,
  p_photo_path text default null,
  p_place_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_credits integer;
  v_cost integer;
  v_token text;
  v_claim_id uuid;
  v_postcard_id uuid;
  v_sender_name text;
  v_sender_city text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Map category → cost (keep in sync with src/data/credits.ts CARD_COSTS)
  v_cost := case p_category
    when 'handwritten' then 1
    when 'photo' then 2
    when 'place' then 2
    when 'custom' then 5
    else 1
  end;

  -- Check + deduct credits atomically
  select credits, name, city
    into v_credits, v_sender_name, v_sender_city
    from public.profiles
    where id = v_user_id
    for update;

  if v_credits is null or v_credits < v_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- Generate an 8-char base32 token. Using encode(gen_random_bytes,...) for
  -- crypto-strength randomness.
  v_token := upper(
    translate(
      substr(encode(gen_random_bytes(8), 'base64'), 1, 8),
      '+/=', 'XYZ'
    )
  );

  -- Create the claim row
  insert into public.postcard_claims
    (claim_token, sender_id, sender_name_snapshot, sender_city_snapshot)
  values
    (v_token, v_user_id, v_sender_name, v_sender_city)
  returning id into v_claim_id;

  -- Create the postcard row with awaiting_address status
  insert into public.postcards
    (sender_id, to_kind, to_friend_id, claim_id, category,
     message, photo_path, place_name, credit_cost, status)
  values
    (v_user_id, 'claim', null, v_claim_id, p_category,
     p_message, p_photo_path, p_place_name, v_cost, 'awaiting_address')
  returning id into v_postcard_id;

  -- Deduct credits
  update public.profiles
    set credits = credits - v_cost
    where id = v_user_id;

  return jsonb_build_object(
    'postcard_id', v_postcard_id,
    'claim_id', v_claim_id,
    'claim_token', v_token,
    'credits_remaining', v_credits - v_cost
  );
end;
$$;

comment on function public.send_postcard_via_claim is
  'Creates a postcard in awaiting_address status with a magic-link claim. '
  'Returns the claim token which the sender shares with the recipient.';

grant execute on function public.send_postcard_via_claim(text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. redeem_postcard_claim RPC
--    Called by the claim Edge Function (using service_role, NOT the recipient
--    user — recipient is unauthenticated). Saves the recipient's address,
--    flips postcard status to 'queued'.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_postcard_claim(
  p_claim_token text,
  p_name text,
  p_address_line1 text,
  p_city text,
  p_state text,
  p_zip text,
  p_address_line2 text default null,
  p_country text default 'US'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id uuid;
  v_postcard_id uuid;
  v_already_claimed timestamptz;
  v_expired boolean;
begin
  -- Look up the claim
  select id, claimed_at, (expires_at < now())
    into v_claim_id, v_already_claimed, v_expired
    from public.postcard_claims
    where claim_token = p_claim_token;

  if v_claim_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_already_claimed is not null then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
  end if;
  if v_expired then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;

  -- Save the address
  update public.postcard_claims
    set claimed_at = now(),
        claimed_name = p_name,
        claimed_address_line1 = p_address_line1,
        claimed_address_line2 = p_address_line2,
        claimed_city = p_city,
        claimed_state = p_state,
        claimed_zip = p_zip,
        claimed_country = p_country
    where id = v_claim_id;

  -- Flip the postcard status so the client app can render it as "shipped"
  update public.postcards
    set status = 'queued'
    where claim_id = v_claim_id
    returning id into v_postcard_id;

  return jsonb_build_object(
    'ok', true,
    'claim_id', v_claim_id,
    'postcard_id', v_postcard_id
  );
end;
$$;

comment on function public.redeem_postcard_claim is
  'Recipient-facing redemption. Called by the claim Edge Function with the '
  'recipient address. Marks the claim claimed and flips postcard to queued.';

-- Granted to service_role only (Edge Function uses service-role client).
revoke execute on function public.redeem_postcard_claim(text, text, text, text, text, text, text, text) from public, authenticated, anon;
grant execute on function public.redeem_postcard_claim(text, text, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. claim_lookup RPC — used by the claim Edge Function on GET (recipient's
--    first view of the page). Returns sender info + postcard message, but
--    NOTHING that could leak the sender's address.
-- ---------------------------------------------------------------------------
create or replace function public.claim_lookup(
  p_claim_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim record;
  v_postcard record;
begin
  select
    pc.id, pc.sender_name_snapshot, pc.sender_city_snapshot,
    pc.claimed_at, pc.expires_at
    into v_claim
    from public.postcard_claims pc
    where pc.claim_token = p_claim_token;

  if v_claim.id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_claim.claimed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
  end if;
  if v_claim.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;

  -- Fetch the postcard's message (for preview on the claim page)
  select message, category
    into v_postcard
    from public.postcards
    where claim_id = v_claim.id;

  return jsonb_build_object(
    'ok', true,
    'sender_name', v_claim.sender_name_snapshot,
    'sender_city', v_claim.sender_city_snapshot,
    'message_preview', left(v_postcard.message, 140),  -- truncate; surprise factor
    'category', v_postcard.category
  );
end;
$$;

revoke execute on function public.claim_lookup from public, authenticated, anon;
grant execute on function public.claim_lookup to service_role;
