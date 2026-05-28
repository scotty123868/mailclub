-- v0.6.1. Phase 6 security + correctness hardening
--
-- Fixes the most critical findings from the deep codex audit run after
-- shipping 0.6.0 build 6 to TestFlight. Server-side issues here; client
-- and edge-function fixes ship in companion commits.
--
-- Findings addressed:
--   P1 Privacy: sender SELECT policy on postcard_claims exposes the
--      recipient's claimed_address_*. Drop the policy and replace with a
--      column-restricted view + RPC that returns ONLY the sender's own
--      delivery-status info (no addresses).
--   P1 Free money: purchase_credits RPC was grantable to authenticated
--      clients with no Stripe validation. Revoke and force credit grants
--      through the Stripe webhook path only.
--   P1 Schema drift: send_postcard RPC still writes owner_id/photo_uri
--      after migration 1209 renamed those to sender_id/photo_path. Direct
--      sends would 23502/42703 after rename. Replace the RPC.
--   P1 Cost mismatch: server charges 2 for photo cards; client says 1.
--      Reconcile to 1 (matching client + the new pricing copy).
--   P1 to_kind constraint: 1208 inserts 'claim', but the initial check
--      only allows friend|void. Loosen to allow claim too.
--   P2 Duplicate friend rows from QR scans: add a partial unique index
--      on (owner_id, source_user_id) so reciprocation_scan can ON CONFLICT.

-- ---------------------------------------------------------------------------
-- 1. Privacy: postcard_claims sender SELECT. redact address columns
-- ---------------------------------------------------------------------------

-- Drop the over-permissive policy from 1208.
drop policy if exists postcard_claims_sender_select on public.postcard_claims;

-- New sender policy: SELECT allowed but column-restricted by view, not
-- table. The raw table is no longer directly readable by the sender.
-- Senders read their claims through public.postcard_claims_for_sender
-- which omits claimed_address_* columns entirely.
revoke select on public.postcard_claims from authenticated;
grant select on public.postcard_claims to service_role;

-- Note: receiver visibility from 1210 was a SELECT policy
-- (postcard_claims_receiver_select with scanned_by_user_id = auth.uid()).
-- That policy STILL FIRES because RLS is row-level, not column-level .
-- the receiver gets to see their own row's columns, including
-- (intentionally) the sender_name_snapshot they scanned. The sender's
-- mailing address is never on a claim row, so no privacy issue there.
-- But the receiver shouldn't read claimed_address_* either (they don't
-- need their own claimed-address back). Wrap in the same view pattern.

-- Sender-facing redacted view: no claimed_address_*, no scanned_by_user_id
-- (which isn't meaningful for sender either).
create or replace view public.postcard_claims_for_sender as
  select
    pc.id,
    pc.claim_token,
    pc.sender_id,
    pc.sender_name_snapshot,
    pc.sender_city_snapshot,
    pc.expires_at,
    pc.claimed_at,
    pc.scanned_at,
    pc.flavor,
    pc.created_at
  from public.postcard_claims pc
  where pc.sender_id = auth.uid();

grant select on public.postcard_claims_for_sender to authenticated;

comment on view public.postcard_claims_for_sender is
  'Sender-safe view over postcard_claims. Strips claimed_address_* columns '
  'so a sender cannot query the recipient mailing address through magic-link '
  'claims. Use this anywhere the sender app needs to list their own claims.';

-- ---------------------------------------------------------------------------
-- 2. Money: revoke purchase_credits from authenticated clients
-- ---------------------------------------------------------------------------

-- The initial schema granted public.purchase_credits to authenticated with
-- no validation gate. A signed-in user could mint themselves credits by
-- calling it directly. The Stripe webhook is the only legitimate caller.
do $$ begin
  revoke execute on function public.purchase_credits(text) from authenticated, public, anon;
exception when undefined_function then null; end $$;

do $$ begin
  grant execute on function public.purchase_credits(text) to service_role;
exception when undefined_function then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Schema drift: rewrite send_postcard RPC to use renamed columns
-- ---------------------------------------------------------------------------
-- The 1209 migration renamed postcards.owner_id → sender_id and
-- photo_uri → photo_path. The original send_postcard RPC from 1200 still
-- writes the OLD names. Rewrite it.
--
-- This RPC is the canonical direct-send (friend → friend) entry point.
-- It must continue to:
--   - Deduct credits atomically
--   - Insert the postcard with from_city/to_city
--   - Return the inserted row to the client
-- We keep the same signature so api.ts callers don't change.

-- Preserve the EXACT signature the client at api.ts:351 calls:
--   send_postcard(
--     p_to_kind text, p_to_friend_id uuid, p_category text, p_message text,
--     p_place_name text, p_photo_uri text, p_custom_description text,
--     p_custom_tone text, p_reference_photo_uris text[]
--   )
-- This drops both the original 1200 definition and any partial replacements
-- that may have landed. The argument list MUST match the original 1200
-- signature byte-for-byte; otherwise the DROP silently no-ops and the old
-- broken RPC keeps resolving for clients.
drop function if exists public.send_postcard(
  uuid, text, text, text, text, text, text, text, text[]
);

create or replace function public.send_postcard(
  p_to_friend_id uuid,
  p_to_kind text,
  p_category text,
  p_message text,
  p_place_name text default null,
  p_photo_uri text default null,
  p_custom_description text default null,
  p_custom_tone text default null,
  p_reference_photo_uris text[] default '{}'
) returns public.postcards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_credits integer;
  v_cost integer;
  v_from_city text;
  v_to_city text;
  v_result public.postcards;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Cost map: keep in sync with src/data/credits.ts CARD_COSTS. Reconciled
  -- to 1 credit per send (photo or otherwise) for v0.6.x. Previously the
  -- server charged 2 for photo cards, which mismatched the client copy
  -- ("1 stamp · You have N"). codex Phase 6 P1.
  v_cost := case p_category
    when 'handwritten' then 1
    when 'photo' then 1
    when 'place' then 1
    when 'custom' then 1
    else 1
  end;

  select credits into v_credits
    from public.profiles
    where id = v_user_id
    for update;

  if v_credits is null or v_credits < v_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- Look up the recipient's city for the postcard's to_city field.
  if p_to_friend_id is not null then
    select city into v_to_city
      from public.friends
      where id = p_to_friend_id and owner_id = v_user_id;
  end if;

  -- Sender's city for the postcard's from_city field.
  select city into v_from_city
    from public.profiles
    where id = v_user_id;

  -- Insert under the post-1209 column names (sender_id, photo_path).
  insert into public.postcards (
    sender_id, to_kind, to_friend_id, from_city, to_city,
    category, credit_cost, message,
    place_name, photo_path, custom_description, custom_tone,
    reference_photo_uris
  )
  values (
    v_user_id, p_to_kind, p_to_friend_id, v_from_city, v_to_city,
    p_category, v_cost, p_message,
    p_place_name, p_photo_uri, p_custom_description, p_custom_tone,
    coalesce(p_reference_photo_uris, '{}')
  )
  returning * into v_result;

  if p_to_friend_id is not null then
    update public.friends
      set cards_sent = cards_sent + 1,
          last_interaction_at = now()
      where id = p_to_friend_id and owner_id = v_user_id;
  end if;

  insert into public.credit_transactions (owner_id, delta, reason, postcard_id)
    values (v_user_id, -v_cost, 'send_postcard', v_result.id);

  update public.profiles
    set credits = credits - v_cost
    where id = v_user_id;

  return v_result;
end;
$$;

grant execute on function public.send_postcard(
  uuid, text, text, text, text, text, text, text, text[]
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. to_kind constraint. allow 'claim' (1208 inserts this value)
-- ---------------------------------------------------------------------------
-- The initial schema's check constraint allowed only 'friend' | 'void'.
-- 2026051208 send_postcard_via_claim writes to_kind='claim'. If anyone
-- ever applies migrations strictly in order on a fresh DB, that insert
-- violates the constraint. Loosen.

do $$ begin
  alter table public.postcards drop constraint if exists postcards_to_kind_check;
  alter table public.postcards
    add constraint postcards_to_kind_check
    check (to_kind in ('friend', 'void', 'claim'));
exception when undefined_table then null; end $$;

-- ---------------------------------------------------------------------------
-- 5. Friends uniqueness. prevent duplicate scan-created rows
-- ---------------------------------------------------------------------------
-- record_reciprocation_scan creates a friend row from (receiver → sender).
-- Without a unique constraint, two scans from the same sender create two
-- friend rows. The function tries to look up existing first, but with
-- concurrent scans we race. Add a partial unique index.
--
-- DEDUPE FIRST: production may already contain duplicate
-- (owner_id, source_user_id) rows from races before this constraint
-- existed. Creating the unique index would fail. Keep the OLDEST row
-- per (owner_id, source_user_id) pair and delete the rest. The oldest
-- row tends to hold the accumulated cards_sent / last_interaction_at
-- the user has been seeing in their UI; preserving it minimizes
-- visible disruption.

with ranked as (
  select
    id,
    row_number() over (
      partition by owner_id, source_user_id
      order by created_at asc, id asc
    ) as rn
  from public.friends
  where source_user_id is not null
)
delete from public.friends f
using ranked r
where f.id = r.id
  and r.rn > 1;

create unique index if not exists friends_owner_source_unique_idx
  on public.friends (owner_id, source_user_id)
  where source_user_id is not null;

-- ---------------------------------------------------------------------------
-- 6. Postcards status check. broadened by 1209 already; verify
-- ---------------------------------------------------------------------------
-- Migration 1209 loosened the check to include 'queued', 'awaiting_address',
-- 'in_transit', 'returned'. This is a no-op idempotent assertion that the
-- expected set is in place.
do $$ begin
  alter table public.postcards drop constraint if exists postcards_status_check;
  alter table public.postcards
    add constraint postcards_status_check
    check (status in (
      'draft', 'sent', 'delivered',
      'queued', 'awaiting_address',
      'in_transit', 'returned'
    ));
exception when undefined_table then null; end $$;
