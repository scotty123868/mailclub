// stripe-webhook
//
// Stripe pings this endpoint for every event on your account. We care about:
// - payment_intent.succeeded → grant credits to the user (idempotent)
// - payment_intent.payment_failed → log only, no balance change
// - charge.refunded → roll back credits (idempotent)
//
// HMAC signature verification is non-negotiable. Without it, anyone could
// POST a fake "succeeded" event to this URL and steal credits. We use Stripe's
// constructEventAsync with the webhook signing secret you copy from
// dashboard.stripe.com/webhooks after registering the endpoint.
//
// Required Supabase secrets:
// STRIPE_SECRET_KEY=sk_test_... or sk_live_...
// STRIPE_WEBHOOK_SECRET=whsec_...
//
// Deploy with --no-verify-jwt because Stripe doesn't send a JWT:
// supabase functions deploy stripe-webhook --no-verify-jwt

// @ts-nocheck. Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
 apiVersion: "2024-12-18.acacia",
 httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

serve(async (req) => {
 const signature = req.headers.get("stripe-signature");
 if (!signature) return new Response("Missing signature", { status: 400 });

 const rawBody = await req.text();
 let event: Stripe.Event;
 try {
 event = await stripe.webhooks.constructEventAsync(rawBody, signature, WEBHOOK_SECRET);
 } catch (err: any) {
 return new Response(`Signature verification failed: ${err.message}`, { status: 400 });
 }

 const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

 try {
 switch (event.type) {
 case "payment_intent.succeeded": {
 const pi = event.data.object as Stripe.PaymentIntent;
 const userId = pi.metadata?.supabase_user_id;
 const packId = pi.metadata?.pack_id;
 const credits = parseInt(pi.metadata?.credits ?? "0", 10);
 if (!userId || !packId || !credits) {
 // eslint-disable-next-line no-console
 console.warn("Missing metadata on PaymentIntent", pi.id);
 return new Response("OK (skipped, missing metadata)", { status: 200 });
 }

 // Idempotency: have we already credited this PI?
 const { data: existing } = await admin
 .from("credit_purchases")
 .select("id")
 .eq("stripe_payment_intent_id", pi.id)
 .maybeSingle();
 if (existing) {
 return new Response("OK (already processed)", { status: 200 });
 }

 // Record the purchase + bump credits atomically via an RPC
 const { error } = await admin.rpc("apply_stripe_credit_purchase", {
 p_user_id: userId,
 p_pack_id: packId,
 p_credits: credits,
 p_stripe_payment_intent_id: pi.id,
 p_amount_cents: pi.amount,
 });
 if (error) {
 // eslint-disable-next-line no-console
 console.error("apply_stripe_credit_purchase failed", error);
 return new Response(`DB error: ${error.message}`, { status: 500 });
 }
 return new Response("OK", { status: 200 });
 }

 case "payment_intent.payment_failed": {
 // No-op on credits. Could log to a `credit_purchase_failures` table.
 return new Response("OK (logged failure)", { status: 200 });
 }

 case "charge.refunded": {
 const charge = event.data.object as Stripe.Charge;
 const piId = typeof charge.payment_intent === "string"
 ? charge.payment_intent
 : charge.payment_intent?.id;
 if (!piId) return new Response("OK (no PI)", { status: 200 });

 const { error } = await admin.rpc("rollback_stripe_credit_purchase", {
 p_stripe_payment_intent_id: piId,
 });
 if (error) {
 // eslint-disable-next-line no-console
 console.error("rollback_stripe_credit_purchase failed", error);
 }
 return new Response("OK", { status: 200 });
 }

 default:
 return new Response(`Unhandled event type ${event.type}`, { status: 200 });
 }
 } catch (err: any) {
 // eslint-disable-next-line no-console
 console.error("webhook handler exception", err);
 return new Response(`Internal: ${err?.message ?? "unknown"}`, { status: 500 });
 }
});
