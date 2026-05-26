// sms-buy-checkout — Stripe Checkout Session for SMS-originated purchases.
//
// When a repeat sender texts BUY (with optional pack size), sms-inbound calls
// this internally. We:
//   1. Find or create the user's profile + Stripe customer from the phone
//   2. Create a Checkout Session for the requested pack with metadata
//      that stripe-webhook reads on payment_intent.succeeded
//   3. Return the hosted Stripe URL
//
// sms-inbound then texts the URL back to the user. They tap it, pay in
// Stripe's hosted Checkout page, and the existing webhook adds credits.
//
// Deploy: `supabase functions deploy sms-buy-checkout --no-verify-jwt`
//
// Auth: requires x-mailroom-internal header matching MAILROOM_INTERNAL_SECRET
// (same shared secret sms-inbound uses to call lob-send-postcard). Public
// keys MUST NOT be able to mint Checkout URLs for arbitrary phones — that
// would let an attacker spam SMS users with checkout links.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
//   STRIPE_SECRET_KEY
//   MAILROOM_INTERNAL_SECRET

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const stripe = new Stripe(STRIPE_KEY, {
  apiVersion: "2024-12-18.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

// Mirror SERVER_PACKS in create-payment-intent. Keep in sync.
// p5/p25/p50 are the three current packs. amountCents is what Stripe charges.
const PACKS: Record<string, { credits: number; amountCents: number; description: string; label: string }> = {
  p5: { credits: 5, amountCents: 500, description: "Mailroom — 5 stamps", label: "5 cards ($5)" },
  p25: { credits: 25, amountCents: 2000, description: "Mailroom — 25 stamps", label: "25 cards ($20)" },
  p50: { credits: 50, amountCents: 3500, description: "Mailroom — 50 stamps", label: "50 cards ($35)" },
};

const SUCCESS_URL = "https://app.themailroom.club/?topup=ok";
const CANCEL_URL = "https://app.themailroom.club/?topup=cancel";

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // Auth gate
  const headerSecret = req.headers.get("x-mailroom-internal");
  if (!INTERNAL_SECRET || headerSecret !== INTERNAL_SECRET) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const phone = String(body?.phone ?? "").trim();
  const packId = String(body?.pack_id ?? "p5").trim();
  if (!phone) return json({ ok: false, error: "missing_phone" }, 400);

  const pack = PACKS[packId];
  if (!pack) return json({ ok: false, error: `unknown_pack:${packId}` }, 400);

  // 1. Find or create the profile (mirrors sms-inbound's findOrCreateUserByPhone).
  //    We need a Supabase user.id to feed into Checkout metadata so the
  //    webhook can credit the right account.
  // NOTE: public.profiles has no `email` column — email lives only on
  // auth.users. We pull email from there when creating the Stripe customer.
  let userId: string;
  let email: string | null = null;
  let stripeCustomerId: string | null = null;
  try {
    const { data: existing } = await admin
      .from("profiles")
      .select("id, stripe_customer_id")
      .eq("phone", phone)
      .maybeSingle();
    if (existing?.id) {
      userId = existing.id;
      stripeCustomerId = existing.stripe_customer_id ?? null;
      const { data: authUser } = await admin.auth.admin.getUserById(userId);
      email = authUser?.user?.email ?? null;
    } else {
      const { data: created, error } = await admin.auth.admin.createUser({
        phone, phone_confirm: true, user_metadata: { signup_surface: "sms" },
      });
      if (error || !created?.user?.id) throw new Error(`createUser: ${error?.message}`);
      userId = created.user.id;
      email = created.user.email ?? null;
      await admin.from("profiles").upsert(
        { id: userId, phone, credits: 0, name: "" },
        { onConflict: "id" },
      );
    }
  } catch (e: any) {
    console.error("[sms-buy-checkout] profile lookup failed", e);
    return json({ ok: false, error: "profile_lookup_failed" }, 500);
  }

  // 2. Find or create Stripe customer
  try {
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: email ?? undefined,
        phone,
        metadata: { supabase_user_id: userId },
      });
      stripeCustomerId = customer.id;
      await admin
        .from("profiles")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", userId);
    }
  } catch (e: any) {
    console.error("[sms-buy-checkout] stripe customer create failed", e);
    return json({ ok: false, error: "stripe_customer_failed" }, 500);
  }

  // 3. Create Checkout Session. payment_intent_data.metadata propagates to
  //    the underlying PI, which is what stripe-webhook reads. We mirror the
  //    exact metadata shape used by create-payment-intent so the same RPC
  //    (apply_stripe_credit_purchase) credits the user.
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: pack.amountCents,
          product_data: {
            name: pack.description,
            description: `${pack.credits} postcards. Use anytime via SMS or the Mailroom app.`,
          },
        },
        quantity: 1,
      }],
      payment_intent_data: {
        description: pack.description,
        metadata: {
          supabase_user_id: userId,
          pack_id: packId,
          credits: String(pack.credits),
          surface: "sms_buy",
        },
      },
      metadata: {
        supabase_user_id: userId,
        pack_id: packId,
        credits: String(pack.credits),
        surface: "sms_buy",
      },
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      // Expire the link after 1 hour. They can always text BUY again to get
      // a fresh URL — keeps abandoned URLs from being shared around.
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    });

    return json({
      ok: true,
      url: session.url,
      pack_label: pack.label,
      expires_at: session.expires_at,
    });
  } catch (e: any) {
    console.error("[sms-buy-checkout] session create failed", e);
    return json({ ok: false, error: `stripe: ${e?.message ?? "unknown"}` }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
