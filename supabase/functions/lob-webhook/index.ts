// Supabase Edge Function: lob-webhook
//
// Receives Lob's postcard-status webhooks (created, in_transit,
// processed_for_delivery, delivered, returned_to_sender) and updates
// the corresponding postcards row with the new status + tracking
// metadata. The Map screen polls postcards on tab focus, so freshly
// updated rows light up as new pins / route updates.
//
// SECURITY MODEL:
// - Lob signs each webhook body with HMAC-SHA256 using the secret
// shown when you create the endpoint in Lob's dashboard. We verify
// the signature before doing anything.
// - The secret is stored as LOB_WEBHOOK_SECRET in Supabase secrets.
// - Deploy with --no-verify-jwt since Lob isn't a Supabase auth client:
// supabase secrets set LOB_WEBHOOK_SECRET=whsec_lob_xxx
// supabase functions deploy lob-webhook --no-verify-jwt
//
// LOB DASHBOARD SETUP:
// 1. Dashboard → Webhooks → Add Endpoint
// 2. URL: https://nlwnmgwylmmnaemdnzlq.supabase.co/functions/v1/lob-webhook
// 3. Events: postcard.created, postcard.in_transit,
// postcard.processed_for_delivery, postcard.delivered,
// postcard.returned_to_sender
// 4. Copy the signing secret → LOB_WEBHOOK_SECRET
//
// EVENT → POSTCARD STATUS MAPPING:
// postcard.created → no change (we set 'sent' at insert)
// postcard.in_transit → status='in_transit'
// postcard.processed_for_delivery → status='in_transit' (last leg)
// postcard.delivered → status='delivered'
// postcard.returned_to_sender → status='returned'

// @ts-nocheck. Deno runtime, not the RN tsconfig
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// v0.7.0.6: accept both live + test webhook secrets. Lob auto-generates
// a fresh secret per webhook endpoint and won't let you reuse the same
// one across LIVE and TEST tabs. We try each configured secret in turn
// and accept the signature if ANY of them match. Set both:
// supabase secrets set LOB_WEBHOOK_SECRET=<live-tab-signing-secret>
// supabase secrets set LOB_WEBHOOK_SECRET_TEST=<test-tab-signing-secret>
const LOB_WEBHOOK_SECRETS: string[] = [
 Deno.env.get("LOB_WEBHOOK_SECRET") ?? "",
 Deno.env.get("LOB_WEBHOOK_SECRET_TEST") ?? "",
].filter(Boolean);

const STATUS_BY_EVENT: Record<string, string | null> = {
 // Map created → 'sent' (idempotent for immediate cards, which are
 // already 'sent'; the real transition for scheduled cards moving from
 // 'scheduled' → mailed). Mapping it to a non-null status lets the
 // handler reach maybeFireThreadedStatusUpdate, whose scheduled-card
 // branch fires the "just hit the mail" beat. Immediate cards don't
 // fire there (that branch requires scheduled_send_at).
 "postcard.created": "sent",
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
 * Lob-Signature: t=1492774577,v1=<hex_hmac_sha256>
 * Returns the timestamp string and an array of v1 signatures (Lob can
 * send multiple during secret rotation). Tolerates extra whitespace. */
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
 * every configured secret. Returns true if ANY secret matches.
 *
 * Lob signs `${timestamp}.${body}` and sends it in a Stripe-style
 * header `t=<ts>,v1=<hex>`. We support both that format and a fallback
 * where the header is a bare hex signature over just the body (older
 * Lob webhooks or some Debugger configs). */
async function verifySignature(rawBody: string, headerSig: string): Promise<boolean> {
 // v0.7.0.60: SKIP_VERIFY now checked FIRST, regardless of secret state.
 // The previous gate (`length === 0`) never fired because the array is
 // always initialized with two entries (`?? ""` fallbacks), so setting
 // LOB_WEBHOOK_SKIP_VERIFY=true did nothing in any environment that
 // had EVER set a secret. Use this temporarily to confirm Lob webhook
 // wiring while diagnosing signature failures; remove before friends.
 // Positive allowlist: the bypass only works when ENVIRONMENT is EXPLICITLY a
 // non-prod value. An unset, misspelled, or production ENVIRONMENT never skips
 // verification (codex: "!== production" let unset/typo'd envs through).
 if (Deno.env.get("LOB_WEBHOOK_SKIP_VERIFY") === "true" &&
     ["local", "development", "staging"].includes(Deno.env.get("ENVIRONMENT") ?? "")) {
 console.warn("[lob-webhook] LOB_WEBHOOK_SKIP_VERIFY=true (non-prod env). signature check bypassed");
 return true;
 }
 // Filter empty strings so the empty-secret check actually fires.
 const validSecrets = LOB_WEBHOOK_SECRETS.filter((s) => s && s.length > 0);
 if (validSecrets.length === 0) {
 console.error("[lob-webhook] no LOB_WEBHOOK_SECRET* env vars set in prod. rejecting request");
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

 // Diagnostics. log the header shape (NOT the value, to avoid leaking
 // valid sigs) so we can see why it failed in Supabase logs.
 // v0.7.0.60: when LOB_WEBHOOK_DEBUG=true we also stash diagnostic info
 // on globalThis so the caller can return it in the response body. This
 // is for live troubleshooting of signature mismatches. once we know
 // why Lob's secret doesn't match what we're configured with, the
 // env var gets removed.
 const diag = {
 headerLen: headerSig.length,
 headerPrefix: headerSig.slice(0, 12),
 parsed: { hasT: !!t, v1Count: v1.length },
 secretCount: validSecrets.length,
 secretLengths: validSecrets.map((s) => s.length),
 bodyLen: rawBody.length,
 computedSamples: t
 ? await Promise.all(
 validSecrets.map(async (s, i) => ({
 secretIdx: i,
 computed: (await hmacSha256Hex(s, `${t}.${rawBody}`)).slice(0, 16) + "…",
 })),
 )
 : [],
 receivedV1Prefix: v1.length > 0 ? v1[0].slice(0, 16) + "…" : null,
 };
 console.warn("[lob-webhook] signature mismatch", diag);
 if (Deno.env.get("LOB_WEBHOOK_DEBUG") === "true") {
 (globalThis as any).__lobDiag = diag;
 }
 return false;
}

serve(async (req) => {
 if (req.method !== "POST") {
 return new Response("Method not allowed", { status: 405 });
 }

 // Read the raw body once. we need it both for signature verification
 // and JSON parsing.
 const rawBody = await req.text();

 // Lob signature header (try every variant we've seen. Deno's Headers
 // normalizes to lowercase, but worth being defensive).
 const sig =
 req.headers.get("lob-signature") ??
 req.headers.get("lob-signature-256") ??
 req.headers.get("x-lob-signature") ??
 req.headers.get("lob_signature") ??
 "";

 const ok = await verifySignature(rawBody, sig);
 if (!ok) {
 // Diagnostics. surface header shape in the response body so we can
 // see what's happening from the Lob Debugger UI without scraping
 // function logs. SAFE to include: we print header NAMES + sig
 // length/prefix, never the secret or a valid signature.
 //
 // v0.7.0.49: in prod, send a minimal 401 response and log the full
 // debug payload server-side. Previously the full debug was returned
 // in the response BODY, giving attackers a free fingerprinting
 // oracle (which secret count is loaded, what their request looked
 // like after parsing, etc.). To keep debugging useful during
 // integration, the verbose body still ships when LOB_WEBHOOK_DEBUG=true.
 const allHeaders: Record<string, string> = {};
 req.headers.forEach((v, k) => {
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
 const verbose = Deno.env.get("LOB_WEBHOOK_DEBUG") === "true";
 return new Response(
 JSON.stringify(
 verbose ? debug : { ok: false, reason: "signature_mismatch" },
 null,
 2,
 ),
 { status: 401, headers: { "Content-Type": "application/json" } },
 );
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
 // body.expected_delivery_date. propagate when present.
 ...(event?.body?.expected_delivery_date
 ? { lob_expected_delivery: event.body.expected_delivery_date }
 : {}),
 })
 .eq("lob_id", lobId)
 // 2026052410 added mailed_imessage_id + from_phone for in-thread
 // reply-on-status. Pull them so we can fire a threaded iMessage.
 .select("id, status, sender_id, to_friend_id, mailed_imessage_id, from_phone, to_city, to_address_state, to_kind, lob_front_thumbnail_url, lob_back_thumbnail_url, flip_gif_url, route_map_url, scheduled_send_at, lob_expected_delivery")
 .maybeSingle();

 if (error) {
 console.error("[lob-webhook] update failed", { lobId, error });
 return new Response(JSON.stringify({ ok: false, error: error.message }), {
 status: 500,
 headers: { "Content-Type": "application/json" },
 });
 }

 if (!data) {
 // Postcard not found. possibly a test postcard from Lob's dashboard
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

 // REPLY-THREADED iMessage: if this postcard was mailed via the
 // iMessage flow (mailed_imessage_id + from_phone set by loop-inbound)
 // AND the status change is one worth narrating, fire an iMessage
 // back to the sender using reply_to_id so it lands in-thread.
 //
 // We narrate only the high-signal moments. Avoid blasting the user
 // on every Lob micro-state.
 await maybeFireThreadedStatusUpdate(admin, data, newStatus, eventType);

 return new Response(
 JSON.stringify({ ok: true, postcard_id: data.id, status: newStatus }),
 { status: 200, headers: { "Content-Type": "application/json" } },
 );
});

// =============================================================================
// In-thread iMessage status updates on the original "Mailed" bubble
// =============================================================================

const LOOP_API_KEY = Deno.env.get("LOOPMESSAGE_API_KEY") ?? "";
const LOOP_SENDER_ID = Deno.env.get("LOOPMESSAGE_SENDER_ID") ?? "";

/**
 * Fire a single in-thread iMessage reply on big-moment Lob status changes:
 *   - in_transit       → "🚚 In transit." (with effect: gentle)
 *   - delivered        → "📬 Delivered." (with effect: love)
 * Other status changes (created, returned_to_sender, etc.) get logged
 * but not iMessaged to avoid notification fatigue.
 *
 * Requires both `mailed_imessage_id` (so we can reply IN the thread) and
 * `from_phone` (so we know who to text). When either is missing, we
 * silently skip — typical for older postcards or SMS-origin cards before
 * the migration.
 */
async function maybeFireThreadedStatusUpdate(
  admin: any,
  postcard: any,
  newStatus: string,
  rawEvent: string,
): Promise<void> {
  if (!LOOP_API_KEY) return;
  if (!postcard?.mailed_imessage_id || !postcard?.from_phone) return;

  // Recipient first name for the delivered beat. Friend sends have a
  // named recipient; pen pal (stranger) sends are anonymous, so we fall
  // back to the destination city ("a mailbox in Marfa") to keep the
  // mystery while still making it concrete.
  let recipientFirst = "";
  if (postcard.to_kind !== "stranger" && postcard.to_friend_id) {
    try {
      const { data: f } = await admin
        .from("friends").select("name").eq("id", postcard.to_friend_id).maybeSingle();
      recipientFirst = (f?.name ?? "").split(/\s+/)[0] || "";
    } catch (_) { /* non-fatal — fall back to city */ }
  }
  const landedWhere = recipientFirst
    ? `${recipientFirst}'s mailbox`
    : (postcard.to_city ? `a mailbox in ${postcard.to_city}` : "their mailbox");

  // Three high-signal moments:
  //   - "created" → narrate ONLY for scheduled cards (Sunday Drop or
  //     user-picked date). Immediate-send already had its "Mailed!"
  //     celebration synchronously at SEND time, so the Lob create event
  //     is redundant noise. Scheduled cards had a "Scheduled" bubble
  //     days/weeks ago and need a "just hit the mail" close.
  //   - "in_transit" → always narrate, text only (no need to re-show
  //     the card on a transitional state — would feel spammy).
  //   - "delivered" → always narrate with the rendered card pair
  //     (front + back) re-attached so the sender's notification is the
  //     literal card that just landed. Visual closure inside iMessage.
  //
  // Drops "processed_for_delivery" (no signal), "in_local_area"
  // (duplicates in_transit), "returned_to_sender" (rare, deferred).
  //
  // Attachments: the card (animated flip, or static front+back) plus
  // the native Apple Maps route snapshot. iMessage shows them as a
  // tidy gallery threaded under the original Mailed bubble.
  const wasScheduled = !!postcard.scheduled_send_at;
  const cardPair: string[] = [];
  if (postcard.flip_gif_url) {
    cardPair.push(postcard.flip_gif_url);
  } else {
    if (postcard.lob_front_thumbnail_url) cardPair.push(postcard.lob_front_thumbnail_url);
    if (postcard.lob_back_thumbnail_url) cardPair.push(postcard.lob_back_thumbnail_url);
  }
  if (postcard.route_map_url) cardPair.push(postcard.route_map_url);

  let bubble: { text: string; effect?: string; subject?: string; attachments?: string[] } | null = null;
  if (rawEvent === "postcard.created" && wasScheduled) {
    const etaLabel = postcard.lob_expected_delivery
      ? new Date(postcard.lob_expected_delivery).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "in 3-5 days";
    bubble = {
      subject: "📮 Just mailed",
      text: `Your scheduled card just hit the mail. Arrives ${etaLabel}.`,
      effect: "confetti",
      attachments: cardPair.length ? cardPair : undefined,
    };
  } else if (rawEvent === "postcard.in_transit") {
    bubble = {
      subject: "🚚 In transit",
      text: "Your card is moving. Should land in a few days.",
      effect: "gentle",
    };
  } else if (rawEvent === "postcard.delivered") {
    // The payoff beat. Name where it landed + re-show the card and the
    // route it travelled, so the notification IS the arrival.
    bubble = {
      subject: "📬 It landed",
      text: `It just landed in ${landedWhere}. 🎉`,
      effect: "love",
      attachments: cardPair.length ? cardPair : undefined,
    };
  }
  if (!bubble) return;

  try {
    const body: any = {
      contact: postcard.from_phone,
      text: bubble.text,
      reply_to_id: postcard.mailed_imessage_id,
    };
    if (LOOP_SENDER_ID) body.sender = LOOP_SENDER_ID;
    if (bubble.subject) body.subject = bubble.subject;
    if (bubble.effect) body.effect = bubble.effect;
    if (bubble.attachments && bubble.attachments.length) body.attachments = bubble.attachments;
    body.passthrough = `lob_status:${postcard.id}:${newStatus}`;

    const res = await fetch("https://a.loopmessage.com/api/v1/message/send/", {
      method: "POST",
      headers: { Authorization: LOOP_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      console.warn("[lob-webhook] threaded iMessage failed", {
        status: res.status,
        message: data?.message,
        postcardId: postcard.id,
      });
      return;
    }
    console.log("[lob-webhook] threaded status fired", {
      postcardId: postcard.id,
      newStatus,
      messageId: data?.message_id,
    });
  } catch (e: any) {
    console.warn("[lob-webhook] threaded iMessage threw", e?.message ?? e);
  }
}
