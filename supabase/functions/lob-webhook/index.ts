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
const LOB_WEBHOOK_SECRET = Deno.env.get("LOB_WEBHOOK_SECRET") ?? "";

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

/** Verify Lob's HMAC-SHA256 signature on the raw request body.
 *  Header name varies by Lob version: lob-signature OR lob_signature.
 *  Computed signature is hex-encoded. */
async function verifySignature(rawBody: string, headerSig: string): Promise<boolean> {
  if (!LOB_WEBHOOK_SECRET) {
    // Fail open ONLY if no secret is configured — for local dev. Logs
    // a warning so this never happens silently in prod.
    console.warn("[lob-webhook] LOB_WEBHOOK_SECRET not set; skipping signature check");
    return true;
  }
  if (!headerSig) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(LOB_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time compare.
  if (computed.length !== headerSig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ headerSig.charCodeAt(i);
  }
  return mismatch === 0;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Read the raw body once — we need it both for signature verification
  // and JSON parsing.
  const rawBody = await req.text();

  // Lob signature header (try both casings — Deno's Headers normalizes
  // to lowercase, but worth being defensive).
  const sig =
    req.headers.get("lob-signature") ??
    req.headers.get("lob_signature") ??
    "";

  const ok = await verifySignature(rawBody, sig);
  if (!ok) {
    console.warn("[lob-webhook] signature mismatch; rejecting");
    return new Response("Bad signature", { status: 401 });
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
      ...(event?.body?.expected_delivery_date
        ? { expected_delivery_date: event.body.expected_delivery_date }
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
