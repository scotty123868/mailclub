-- Stripe Payments — replaces Apple IAP for credit pack purchases.
--
-- Why: Mailroom sells physical mail. Apple Guideline 3.1.5(a) requires
-- non-IAP for physical goods, and the 2024 update to 3.1.1 carves out
-- physical gift cards explicitly. We use Stripe for both Apple Pay and card.
--
-- Tables touched:
--   profiles.stripe_customer_id (TEXT, unique-ish per user) — set on first
--     PaymentIntent so subsequent buys reuse the customer
--   credit_purchases (NEW) — append-only ledger of successful purchases.
--     Indexed by stripe_payment_intent_id for idempotent webhook handling.
--
-- Functions:
--   apply_stripe_credit_purchase — webhook calls this on
--     payment_intent.succeeded. Idempotent on stripe_payment_intent_id.
--   rollback_stripe_credit_purchase — webhook calls this on charge.refunded.
--     Subtracts credits if the user has them; otherwise just records a
--     negative balance event (we don't go negative locally).

-- ---------------------------------------------------------------------------
-- 1. profiles.stripe_customer_id
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists stripe_customer_id text;

create unique index if not exists profiles_stripe_customer_id_unique
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- ---------------------------------------------------------------------------
-- 2. credit_purchases ledger
-- ---------------------------------------------------------------------------
create table if not exists public.credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id text not null,                        -- p5, p10, p25, p50
  credits_added integer not null,
  amount_cents integer not null,                -- gross paid (Stripe units)
  stripe_payment_intent_id text not null unique,
  refunded boolean not null default false,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists credit_purchases_user_id_idx
  on public.credit_purchases (user_id, created_at desc);

-- RLS: users can read their own purchases. Writes go through the
-- security-definer RPC only (webhook uses service-role + RPC).
alter table public.credit_purchases enable row level security;

drop policy if exists credit_purchases_owner_select on public.credit_purchases;
create policy credit_purchases_owner_select
  on public.credit_purchases for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. apply_stripe_credit_purchase RPC
--    Called by the stripe-webhook Edge Function. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.apply_stripe_credit_purchase(
  p_user_id uuid,
  p_pack_id text,
  p_credits integer,
  p_stripe_payment_intent_id text,
  p_amount_cents integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
begin
  -- Idempotency check — if we already recorded this PI, no-op.
  select exists (
    select 1 from public.credit_purchases
    where stripe_payment_intent_id = p_stripe_payment_intent_id
  ) into v_already;

  if v_already then return; end if;

  -- Insert the ledger row
  insert into public.credit_purchases
    (user_id, pack_id, credits_added, amount_cents, stripe_payment_intent_id)
  values
    (p_user_id, p_pack_id, p_credits, p_amount_cents, p_stripe_payment_intent_id);

  -- Bump the user's credit balance
  update public.profiles
    set credits = coalesce(credits, 0) + p_credits
    where id = p_user_id;
end;
$$;

comment on function public.apply_stripe_credit_purchase is
  'Webhook-called function that records a successful Stripe purchase and '
  'credits the user. Idempotent on stripe_payment_intent_id.';

-- ---------------------------------------------------------------------------
-- 4. rollback_stripe_credit_purchase RPC
--    Called on charge.refunded webhook. Marks the purchase refunded and
--    subtracts credits (floored at 0).
-- ---------------------------------------------------------------------------
create or replace function public.rollback_stripe_credit_purchase(
  p_stripe_payment_intent_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_credits integer;
  v_already_refunded boolean;
begin
  select user_id, credits_added, refunded
    into v_user_id, v_credits, v_already_refunded
    from public.credit_purchases
    where stripe_payment_intent_id = p_stripe_payment_intent_id;

  if v_user_id is null then return; end if;
  if v_already_refunded then return; end if;

  update public.credit_purchases
    set refunded = true, refunded_at = now()
    where stripe_payment_intent_id = p_stripe_payment_intent_id;

  update public.profiles
    set credits = greatest(0, coalesce(credits, 0) - v_credits)
    where id = v_user_id;
end;
$$;

comment on function public.rollback_stripe_credit_purchase is
  'Webhook-called rollback for refunded charges. Subtracts credits (floored at '
  '0) and marks the credit_purchases row refunded. Idempotent.';

-- ---------------------------------------------------------------------------
-- 5. Drop the old purchase_credits RPC (was Apple-IAP-shaped, no longer used)
--    Keep it for one release in case clients haven't upgraded, then drop.
-- ---------------------------------------------------------------------------
-- (Intentionally NOT dropping yet — the existing client still references it
--  via api.purchaseCredits. We'll remove in 2026051210 once the Stripe flow
--  is verified end-to-end.)
