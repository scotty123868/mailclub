// Supabase Edge Function: lob-webhook
//
// Receives Lob's postcard-status webhooks (created, in_transit,
// processed_for_delivery, delivered, returned_to_sender) and updates
// the corresponding postcards row with the new status + tracking
// metadata. The Map screen polls postcards on tab focus, so freshly
// updated rows light up as new pins / route updates.
//
// SECURITY MODEL:
//   - Lob signs each webhook body with HMAC-SHA256 using the secret
//     shown when you create the endpoint in Lob's dashboard. We verify
//     the signature before doing anything.
//   - The secret is stored as LOB_WEBHOOK_SECRET in Supabase secrets.
//   - Deploy with --no-verify-jwt since Lob isn't a Supabase auth client:
//       supabase secrets set LOB_WEBHOOK_SECRET=whsec_lob_xxx
//       supabase functions deploy lob-webhook --no-verify-jwt
//
// LOB DASHBOARD SETUP:
//   1. Dashboard → Webhooks → Add Endpoint
//   2. URL: https://nlwnmgwylmmnaemdnzlq.supabase.co/functions/v1/lob-webhook
//   3. Events: postcard.created, postcard.in_transit,
//              postcard.processed_for_delivery, postcard.delivered,
//              postcard.returned_to_sender
//   4. Copy the signing secret → LOB_WEBHOOK_SECRET
//
// EVENT → POSTCARD STATUS MAPPING:
//   postcard.created                   → no change (we set 'sent' at insert)
//   postcard.in_transit                → status='in_transit'
//   postcard.processed_for_delivery    → status='in_transit' (last leg)
//   postcard.delivered                 → status='delivered'
//   postcard.returned_to_sender        → status='returned'

// @ts-nocheck — Deno runtime, not the RN tsconfig
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// v0.7.0.6: accept both live + test webhook secrets. Lob auto-generates
// a fresh secret per webhook endpoint and won't let you reuse the same
// one across LIVE and TEST tabs. We try each configured secret in turn
// and accept the signature if ANY of them match. Set both:
//   supabase secrets set LOB_WEBHOOK_SECRET=<live-tab-signing-secret>
//   supabase secrets set LOB_WEBHOOK_SECRET_TEST=<test-tab-signing-secret>
const LOB_WEBHOOK_SECRETS: string[] = [
  Deno.env.get("LOB_WEBHOOK_SECRET") ?? "",
  Deno.env.get("LOB_WEBHOOK_SECRET_TEST") ?? "",
].filter(Boolean);

const STATUS_BY_EVENT: Record<string, string | null> = {
  "postcard.created": null, // already 'sent' at insert; ignore
  "postcard.rendered_pdf": null,
  "postcard.rendered_thumbnails": null,
  "postcard.in_transit": "in_transit",
  "postcard.in_local_area": "in_transit",
  "postcard.processed_for_delivery": "in_transit",
  "postcard.re-routed": "in_transit",
  "postcard.returned_to_sender": "returned",
  "postcard.delivered": "delivered",
};

/** Parse Lob's Stripe-style signature header:
 *    Lob-Signature: t=1492774577,v1=<hex_hmac_sha256>
 *  Returns the timestamp string and an array of v1 signatures (Lob can
 *  send multiple during secret rotation). Tolerates extra whitespace. */
function parseLobSignatureHeader(header: string): { t: string | null; v1: string[] } {
  const parts = header.split(",").map((p) => p.trim());
  let t: string | null = null;
  const v1: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key === "t") t = val;
    else if (key === "v1") v1.push(val);
  }
  return { t, v1 };
}

/** Constant-time string compare. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** HMAC-SHA256 over a payload, returned as lowercase hex. */
async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Verify Lob's HMAC-SHA256 signature on the raw request body against
 *  every configured secret. Returns true if ANY secret matches.
 *
 *  Lob signs `${timestamp}.${body}` and sends it in a Stripe-style
 *  header `t=<ts>,v1=<hex>`. We support both that format and a fallback
 *  where the header is a bare hex signature over just the body (older
 *  Lob webhooks or some Debugger configs). */
async function verifySignature(rawBody: string, headerSig: string): Promise<boolean> {
  if (LOB_WEBHOOK_SECRETS.length === 0) {
    // v0.7.0.49: fail-closed in prod by default. Previously this returned
    // true when no secret was configured — convenient for local dev but a
    // real security hole if a prod deploy ever dropped LOB_WEBHOOK_SECRET
    // (anyone could POST forged status updates and mutate postcard rows).
    // Now you have to set LOB_WEBHOOK_SKIP_VERIFY=true explicitly to skip,
    // which we only do on the local Supabase emulator.
    if (Deno.env.get("LOB_WEBHOOK_SKIP_VERIFY") === "true") {
      console.warn("[lob-webhook] LOB_WEBHOOK_SKIP_VERIFY=true — signature check bypassed (dev only)");
      return true;
    }
    console.error("[lob-webhook] no LOB_WEBHOOK_SECRET* env vars set in prod — rejecting request");
    return false;
  }
  if (!headerSig) return false;

  const { t, v1 } = parseLobSignatureHeader(headerSig);

  // --- Path A: Stripe-style header with t= and v1= ---
  if (t && v1.length > 0) {
    const signedPayload = `${t}.${rawBody}`;
    for (const secret of LOB_WEBHOOK_SECRETS) {
      const computed = await hmacSha256Hex(secret, signedPayload);
      for (const candidate of v1) {
        if (timingSafeEqual(computed, candidate)) return true;
      }
    }
  }

  // --- Path B: bare hex signature over the body ---
  // Older Lob webhooks (or odd Debugger configs) send the signature as
  // a plain hex string with no t=/v1= prefix. Try the body-only HMAC.
  for (const secret of LOB_WEBHOOK_SECRETS) {
    const computed = await hmacSha256Hex(secret, rawBody);
    if (timingSafeEqual(computed, headerSig.trim())) return true;
  }

  // Diagnostics — log the header shape (NOT the value, to avoid leaking
  // valid sigs) so we can see why it failed in Supabase logs.
  console.warn("[lob-webhook] signature mismatch", {
    headerLen: headerSig.length,
    headerPrefix: headerSig.slice(0, 12),
    parsed: { hasT: !!t, v1Count: v1.length },
    secretCount: LOB_WEBHOOK_SECRETS.length,
  });
  return false;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Read the raw body once — we need it both for signature verification
  // and JSON parsing.
  const rawBody = await req.text();

  // Lob signature header (try every variant we've seen — Deno's Headers
  // normalizes to lowercase, but worth being defensive).
  const sig =
    req.headers.get("lob-signature") ??
    req.headers.get("lob-signature-256") ??
    req.headers.get("x-lob-signature") ??
    req.headers.get("lob_signature") ??
    "";

  const ok = await verifySignature(rawBody, sig);
  if (!ok) {
    // Diagnostics — surface header shape in the response body so we can
    // see what's happening from the Lob Debugger UI without scraping
    // function logs. SAFE to include: we print header NAMES + sig
    // length/prefix, never the secret or a valid signature.
    const allHeaders: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      // Don't leak Authorization or anything that looks like a secret.
      if (k.toLowerCase().includes("auth") || k.toLowerCase() === "cookie") return;
      allHeaders[k] = k.toLowerCase().includes("signature") ? `${v.slice(0, 24)}…(len=${v.length})` : v;
    });
    const parsed = parseLobSignatureHeader(sig);
    const debug = {
      ok: false,
      reason: "signature_mismatch",
      sig_header_present: !!sig,
      sig_header_len: sig.length,
      sig_header_prefix: sig.slice(0, 24),
      parsed_t: parsed.t,
      parsed_v1_count: parsed.v1.length,
      parsed_v1_lens: parsed.v1.map((v) => v.length),
      body_len: rawBody.length,
      body_prefix: rawBody.slice(0, 80),
      secrets_loaded: LOB_WEBHOOK_SECRETS.length,
      received_headers: allHeaders,
    };
    console.warn("[lob-webhook] signature mismatch", debug);
    return new Response(JSON.stringify(debug, null, 2), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const eventType = event?.event_type?.id ?? event?.event_type ?? "";
  const lobId = event?.body?.id ?? event?.id ?? null;

  if (!lobId) {
    console.warn("[lob-webhook] no Lob postcard id in event", { eventType });
    // Acknowledge so Lob doesn't retry endlessly.
    return new Response(JSON.stringify({ ok: true, ignored: "no lob id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const newStatus = STATUS_BY_EVENT[eventType];
  if (!newStatus) {
    // Not an event we care about (or we&apos;ve already set the status).
    return new Response(JSON.stringify({ ok: true, ignored: eventType }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Update the postcard row by lob_id. The 1209 migration added a
  // `lob_id` column to postcards; we look up by that, not by id.
  const { data, error } = await admin
    .from("postcards")
    .update({
      status: newStatus,
      lob_status: eventType,
      // expected_delivery_date arrives on some Lob events as
      // body.expected_delivery_date — propagate when present.
      // v0.7.0.49: column name was wrong (expected_delivery_date) and
      // schema has lob_expected_delivery (see 2026051205_lob_integration.sql).
      // Every Lob event with that field was silently failing the row update,
      // so journal-feed delivery dates were never getting populated from
      // webhook callbacks. Fixed.
      ...(event?.body?.expected_delivery_date
        ? { lob_expected_delivery: event.body.expected_delivery_date }
        : {}),
    })
    .eq("lob_id", lobId)
    .select("id, status, sender_id, to_friend_id")
    .maybeSingle();

  if (error) {
    console.error("[lob-webhook] update failed", { lobId, error });
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!data) {
    // Postcard not found — possibly a test postcard from Lob's dashboard
    // that we didn&apos;t create. Acknowledge so Lob doesn&apos;t retry.
    console.warn("[lob-webhook] no matching postcard", { lobId });
    return new Response(JSON.stringify({ ok: true, ignored: "unknown lob id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("[lob-webhook] updated postcard", {
    postcardId: data.id,
    newStatus,
    eventType,
  });

  return new Response(
    JSON.stringify({ ok: true, postcard_id: data.id, status: newStatus }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
