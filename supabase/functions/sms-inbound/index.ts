// sms-inbound — Twilio MMS webhook for the text-a-photo flow.
//
// Flow:
//   1. User texts a photo (+ optional caption) to our Twilio number.
//   2. Twilio POSTs an application/x-www-form-urlencoded body to this
//      endpoint with From, Body, NumMedia, MediaUrl0..N, MediaContentType0..N.
//   3. We verify the request's X-Twilio-Signature.
//   4. If NumMedia=0, reply "send me a photo to get started."
//   5. Otherwise: download MediaUrl0 (the first photo), upload to our
//      Supabase Storage `sms-photos` bucket, create a draft row via
//      create_sms_draft RPC, and reply with a magic compose URL.
//
// Deploy: `supabase functions deploy sms-inbound --no-verify-jwt`
// (Twilio cannot send a Supabase JWT; we authenticate the request via
// Twilio's signature header instead.)
//
// Twilio webhook URL to configure:
//   https://<project-ref>.supabase.co/functions/v1/sms-inbound
//
// Env vars required (set via `supabase secrets set`):
//   TWILIO_ACCOUNT_SID — starts with AC...
//   TWILIO_AUTH_TOKEN — used for signature verification AND Basic Auth
//     to download MMS media from Twilio's CDN
//   TWILIO_FROM_NUMBER — your toll-free number in E.164, e.g. +18774MAILROOM
//   COMPOSE_BASE_URL — e.g. https://app.themailroom.club/compose
//   SMS_INBOUND_SKIP_VERIFY — set to "true" only for local debugging.
//     Always unset in production.

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";
const COMPOSE_BASE_URL = Deno.env.get("COMPOSE_BASE_URL") ?? "https://app.themailroom.club/compose";
const SKIP_VERIFY = Deno.env.get("SMS_INBOUND_SKIP_VERIFY") === "true";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Twilio expects TwiML (XML) responses for synchronous SMS replies.
// We use the <Message> verb to reply in the same SMS thread.
function twiml(body: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(body)}</Message></Response>`;
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function emptyTwiml(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Twilio's signature scheme:
//   1. Take the full URL (scheme + host + path + query string).
//   2. Append every POST form field as `<key><value>` concatenated,
//      with keys sorted alphabetically.
//   3. HMAC-SHA1 with TWILIO_AUTH_TOKEN as the key.
//   4. Base64 encode → compare to X-Twilio-Signature header.
async function verifyTwilioSignature(
  url: string,
  formData: Record<string, string>,
  signatureHeader: string | null,
): Promise<boolean> {
  if (SKIP_VERIFY) {
    console.warn("[sms-inbound] SMS_INBOUND_SKIP_VERIFY=true — skipping signature check");
    return true;
  }
  if (!signatureHeader) return false;
  if (!TWILIO_AUTH_TOKEN) {
    console.error("[sms-inbound] TWILIO_AUTH_TOKEN not set");
    return false;
  }

  const keys = Object.keys(formData).sort();
  let payload = url;
  for (const k of keys) {
    payload += k + formData[k];
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(TWILIO_AUTH_TOKEN),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === signatureHeader;
}

// 32 chars of URL-safe base64 ≈ 192 bits entropy. Plenty for an
// unguessable magic link.
function mintToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function downloadAndUpload(
  mediaUrl: string,
  mediaContentType: string,
  token: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  // Twilio CDN requires Basic Auth using the account credentials.
  const auth = "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const res = await fetch(mediaUrl, { headers: { Authorization: auth } });
  if (!res.ok) {
    return { ok: false, error: `Twilio media fetch failed: ${res.status}` };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) {
    return { ok: false, error: "Empty media body" };
  }

  // File extension from content type. Twilio usually returns image/jpeg
  // or image/png. Default to .jpg if we don't recognize it.
  const ext = mediaContentType?.includes("png") ? "png"
    : mediaContentType?.includes("gif") ? "gif"
    : mediaContentType?.includes("heic") ? "heic"
    : "jpg";
  const path = `${token}/photo.${ext}`;

  const { error: uploadErr } = await admin.storage
    .from("sms-photos")
    .upload(path, bytes, {
      contentType: mediaContentType || "image/jpeg",
      upsert: false,
    });
  if (uploadErr) {
    return { ok: false, error: `Storage upload failed: ${uploadErr.message}` };
  }
  return { ok: true, path };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }

  // Twilio sends application/x-www-form-urlencoded.
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const formData: Record<string, string> = {};
  for (const [k, v] of params.entries()) formData[k] = v;

  const signatureHeader = req.headers.get("X-Twilio-Signature");
  // Twilio signs the FULL public URL of the webhook. We reconstruct it
  // from the host header + path. (req.url gives the path Supabase saw,
  // which includes the function name.)
  const reqUrl = new URL(req.url);
  // Supabase invokes Edge Functions at https://<ref>.supabase.co/functions/v1/<fn>
  // and the URL in req.url should match. Defensive: prefer the proto+host
  // from forwarded headers if present.
  const proto = req.headers.get("x-forwarded-proto") ?? reqUrl.protocol.replace(":", "");
  const host = req.headers.get("host") ?? reqUrl.host;
  const fullUrl = `${proto}://${host}${reqUrl.pathname}${reqUrl.search}`;

  const verified = await verifyTwilioSignature(fullUrl, formData, signatureHeader);
  if (!verified) {
    console.error("[sms-inbound] signature verification failed", {
      url: fullUrl,
      hasSig: !!signatureHeader,
    });
    return new Response("Signature verification failed", { status: 403 });
  }

  const from = formData["From"];
  const body = formData["Body"] ?? "";
  const numMedia = Number(formData["NumMedia"] ?? "0");

  if (!from) {
    return twiml("Couldn't read your number. Try again?");
  }

  if (numMedia === 0) {
    return twiml(
      "Send me a photo and I'll turn it into a real paper postcard. " +
      "First card's on us."
    );
  }

  const mediaUrl = formData["MediaUrl0"];
  const mediaType = formData["MediaContentType0"];
  if (!mediaUrl) {
    return twiml("Got your message but no photo came through. Try again?");
  }

  // Mint the token first so we can use it as the storage folder.
  const token = mintToken();

  const upload = await downloadAndUpload(mediaUrl, mediaType ?? "image/jpeg", token);
  if (!upload.ok) {
    console.error("[sms-inbound] media upload failed", upload.error);
    return twiml("Hmm, couldn't save your photo. Try sending it again?");
  }

  // Persist the draft. RPC enforces service_role.
  const { error: rpcErr } = await admin.rpc("create_sms_draft", {
    p_token: token,
    p_from_phone: from,
    p_caption: body.slice(0, 280),
    p_photo_path: upload.path,
    p_twilio_media_url: mediaUrl,
  });
  if (rpcErr) {
    console.error("[sms-inbound] create_sms_draft failed", rpcErr);
    return twiml("Something went wrong on our end. Try again in a minute?");
  }

  const composeUrl = `${COMPOSE_BASE_URL}/${token}`;
  return twiml(
    `Got your photo. Tap to finish your postcard: ${composeUrl}\n\n` +
    `(Link is good for 24 hours.)`
  );
});
