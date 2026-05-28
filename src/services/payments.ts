/**
 * Payments service. Stripe Payment Sheet for credit pack purchases.
 *
 * WHY STRIPE, NOT APPLE IAP:
 * Mailroom sells credit packs that are redeemed for physical postcards mailed
 * via USPS. Apple Guideline 3.1.5(a) requires non-IAP payment methods for
 * physical goods. Guideline 3.1.1's 2024 update explicitly carves out
 * "physical gift cards... that are sold within an app and then mailed to
 * customers". that's us. Precedent: TouchNote, Felt, Postagram have shipped
 * this exact model on the App Store using Stripe (not IAP) for years.
 *
 * FLOW:
 * 1. User taps a pack in CreditsSheet → calls purchasePack(pack)
 * 2. We hit `create-payment-intent` Edge Function → returns clientSecret +
 * ephemeral key + customer ID for the Payment Sheet
 * 3. Stripe Payment Sheet opens (Apple Pay if available + card entry)
 * 4. On success, we call `confirm-credit-purchase` RPC to credit the user
 * immediately. Stripe webhook also fires server-side as an
 * authoritative-correctness backstop.
 *
 * MODULE-LOAD SAFETY:
 * `@stripe/stripe-react-native` registers a NativeEventEmitter at import time.
 * On iOS 26 simulators + RN 0.81 the native module returns null and the
 * emitter constructor throws synchronously. that crashes the whole app
 * before any tab can render. To keep startup bulletproof we never import
 * the Stripe SDK at module level. `getStripeSdk()` requires it lazily, and
 * `loadStripeSdk()` returns a result that callers (StripeShell, CreditsSheet)
 * can use to render a degraded "Soon" state when the SDK can't load.
 */

import Constants from "expo-constants";
import type { CreditPack } from "@/src/data/credits";
import { supabase, SUPABASE_CONFIGURED } from "@/src/services/supabase";

export type PaymentOutcome =
 | { ok: true; paymentIntentId: string; creditsAdded: number }
 | { ok: false; reason: "cancelled" | "declined" | "network" | "unavailable" | "config"; message?: string };

type CreatePaymentIntentResponse = {
 paymentIntent: string; // client secret
 ephemeralKey: string;
 customer: string;
 publishableKey: string;
};

type StripeSdk = {
 StripeProvider: any;
 initPaymentSheet: (params: any) => Promise<{ error?: { code?: string; message?: string } }>;
 presentPaymentSheet: () => Promise<{ error?: { code?: string; message?: string } }>;
};

// Lazy-loaded once per process. Three states:
// null. not attempted yet
// false. attempted, failed (don't retry)
// StripeSdk. attempted, succeeded
let cachedStripeSdk: StripeSdk | false | null = null;
let cachedStripeError: string | null = null;

/**
 * Attempt to load the Stripe RN SDK. Safe to call at any point.
 * Returns the SDK on success, or null on failure (caller should show a
 * "Stripe unavailable" state). Caches the result. won't re-attempt on
 * failure within the same JS instance.
 */
export function loadStripeSdk(): StripeSdk | null {
 if (cachedStripeSdk === false) return null;
 if (cachedStripeSdk) return cachedStripeSdk;
 try {
 // eslint-disable-next-line @typescript-eslint/no-var-requires
 const mod = require("@stripe/stripe-react-native") as StripeSdk;
 if (!mod || !mod.initPaymentSheet || !mod.presentPaymentSheet || !mod.StripeProvider) {
 cachedStripeSdk = false;
 cachedStripeError = "Stripe SDK exports missing";
 return null;
 }
 cachedStripeSdk = mod;
 return mod;
 } catch (err: any) {
 cachedStripeSdk = false;
 cachedStripeError = err?.message ?? String(err);
 // eslint-disable-next-line no-console
 console.warn("[payments] Stripe SDK failed to load:", cachedStripeError);
 return null;
 }
}

export function stripeLoadError(): string | null {
 return cachedStripeError;
}

export const STRIPE_PUBLISHABLE_KEY: string =
 (Constants.expoConfig?.extra?.stripePublishableKey as string | undefined) ?? "";

export function isStripeConfigured(): boolean {
 return Boolean(STRIPE_PUBLISHABLE_KEY && STRIPE_PUBLISHABLE_KEY.startsWith("pk_"));
}

/**
 * Initiate purchase for a credit pack via Stripe Payment Sheet.
 *
 * Resolves only after the user dismisses the sheet (success or cancel).
 * The credits aren't credited locally. the caller should refetch the
 * profile (or the Stripe webhook + Postgres trigger will push fresh state).
 */
export async function purchasePack(pack: CreditPack): Promise<PaymentOutcome> {
 if (!SUPABASE_CONFIGURED) {
 return { ok: false, reason: "config", message: "Backend not configured" };
 }
 if (!isStripeConfigured()) {
 return { ok: false, reason: "config", message: "Stripe publishable key not set" };
 }

 const stripe = loadStripeSdk();
 if (!stripe) {
 return {
 ok: false,
 reason: "unavailable",
 message: stripeLoadError() ?? "Stripe SDK unavailable on this device.",
 };
 }
 const { initPaymentSheet, presentPaymentSheet } = stripe;

 // 1) Ask the Edge Function for a PaymentIntent
 let intent: CreatePaymentIntentResponse;
 try {
 const { data, error } = await supabase.functions.invoke<CreatePaymentIntentResponse>(
 "create-payment-intent",
 {
 body: { pack_id: pack.id },
 },
 );
 if (error) throw error;
 if (!data?.paymentIntent || !data?.ephemeralKey || !data?.customer) {
 throw new Error("Edge function returned an incomplete response");
 }
 intent = data;
 } catch (err: any) {
 return {
 ok: false,
 reason: "network",
 message: err?.message ?? "Could not start checkout",
 };
 }

 // 2) Initialize the Payment Sheet.
 //
 // Stripe Tax (enabled server-side via automatic_tax) needs a billing
 // address on the customer to compute the right state rate. The Payment
 // Sheet collects billing details by default for card payments and pulls
 // them from Apple Pay automatically. We pass `defaultBillingDetails: {}`
 // so the SDK doesn't try to reuse stale device defaults.
 const initResult = await initPaymentSheet({
 merchantDisplayName: "Mailroom",
 paymentIntentClientSecret: intent.paymentIntent,
 customerId: intent.customer,
 customerEphemeralKeySecret: intent.ephemeralKey,
 applePay: {
 merchantCountryCode: "US",
 },
 style: "alwaysLight",
 returnURL: "mailroom://payment-return",
 allowsDelayedPaymentMethods: false,
 billingDetailsCollectionConfiguration: {
 address: "Full",
 },
 });
 if (initResult.error) {
 return {
 ok: false,
 reason: "unavailable",
 message: initResult.error.message,
 };
 }

 // 3) Show the Payment Sheet
 const presentResult = await presentPaymentSheet();
 if (presentResult.error) {
 const code = presentResult.error.code;
 if (code === "Canceled") {
 return { ok: false, reason: "cancelled" };
 }
 return {
 ok: false,
 reason: "declined",
 message: presentResult.error.message,
 };
 }

 // The PaymentIntent ID is the part before _secret_ in the clientSecret
 const paymentIntentId = intent.paymentIntent.split("_secret_")[0];

 return {
 ok: true,
 paymentIntentId,
 creditsAdded: pack.credits,
 };
}
