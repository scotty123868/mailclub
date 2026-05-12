// create-payment-intent
//
// Called by the mobile app when the user taps "Buy" on a credit pack. We:
//   1) Authenticate the caller via the Supabase Auth JWT in the request header
//   2) Find/create a Stripe customer for this user
//   3) Create an ephemeral key for the customer (lets the SDK populate the
//      Payment Sheet with saved cards)
//   4) Create a PaymentIntent for the pack amount
//   5) Return clientSecret + ephemeralKey + customerId + publishableKey
//
// The CLIENT never sees the Stripe SECRET key. It only ever holds the
// PUBLISHABLE key (pk_test_/pk_live_) plus the per-purchase clientSecret.
//
// Pack pricing comes from a server-side allowlist so the client can't tamper
// with the amount. If you change `CREDIT_PACKS` in src/data/credits.ts, update
// `SERVER_PACKS` below too.
//
// Required Supabase secrets:
//   STRIPE_SECRET_KEY=sk_test_... (or sk_live_... when going live)
//
// Deploy:
//   supabase functions deploy create-payment-intent

// @ts-nocheck — Deno runtime, not the RN tsconfig
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-12-18.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Server-side source of truth for stamp pack pricing. Must stay in sync with
// src/data/credits.ts. Amounts are in CENTS (Stripe's unit).
//
// Two-pack matrix as of 2026-05-12:
//   p5  · 5 stamps   · $5  · $1.00/stamp · entry
//   p25 · 25 stamps  · $20 · $0.80/stamp · FEATURED (less than the 82¢ USPS stamp)
//
// Old packs (p10, p25 at $25, p50) are retired. If a client somehow still
// references them, they'll get a clean 400 "Unknown pack_id" response.
const SERVER_PACKS: Record<string, { credits: number; amountCents: number; description: string }> = {
  p5: { credits: 5, amountCents: 500, description: "Mailroom — 5 stamps" },
  p25: { credits: 25, amountCents: 2000, description: "Mailroom — 25 stamps" },
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    // 1. Verify the caller is authenticated
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Not authenticated" }, 401);
    }

    // 2. Parse + validate the pack
    const body = await req.json();
    const packId = String(body?.pack_id ?? "");
    const pack = SERVER_PACKS[packId];
    if (!pack) {
      return json({ error: `Unknown pack_id: ${packId}` }, 400);
    }

    // 3. Find or create a Stripe customer for this user, using the
    //    service-role client (the RLS-bypassing one) since the column is
    //    user-private.
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await adminClient
      .from("profiles")
      .select("stripe_customer_id, email")
      .eq("id", user.id)
      .maybeSingle();

    let stripeCustomerId = profile?.stripe_customer_id as string | null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? profile?.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      stripeCustomerId = customer.id;
      await adminClient
        .from("profiles")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", user.id);
    }

    // 4. Ephemeral key — lets the Payment Sheet load the customer's saved
    //    payment methods. Required when you pass `customer` to the sheet.
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: "2024-12-18.acacia" },
    );

    // 5. PaymentIntent with Stripe Tax enabled.
    //
    // `automatic_tax: { enabled: true }` makes Stripe compute the correct
    // state sales tax based on the customer's billing address (collected by
    // the Payment Sheet) and the tax registrations you've set up in the
    // Stripe Dashboard. The user sees a Subtotal / Tax / Total breakdown
    // inside the sheet — no UI work on our side.
    //
    // PREREQUISITES (Stripe Dashboard, one-time):
    //   1. Stripe Tax → Activate
    //   2. Stripe Tax → Registrations → add each US state where you have
    //      economic nexus (start with your home state; add others as
    //      thresholds trigger).
    //   3. Products → set the tax category for stamps to "Services -
    //      Postage/shipping" (or similar physical-postal category).
    //
    // Until those are set, `automatic_tax` may surface a tax_failed error.
    // Catch it server-side if you ship before registrations are done.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: pack.amountCents,
      currency: "usd",
      customer: stripeCustomerId,
      automatic_payment_methods: { enabled: true },
      automatic_tax: { enabled: true },
      description: pack.description,
      metadata: {
        supabase_user_id: user.id,
        pack_id: packId,
        credits: String(pack.credits),
      },
    });

    return json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: stripeCustomerId,
      publishableKey: Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? "",
    });
  } catch (err) {
    return json({ error: err?.message ?? "Internal error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
