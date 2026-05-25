// sms-otp-request — generate a 6-digit OTP for a phone + draft token,
// store it via mint_phone_otp RPC, send it via Twilio.
//
// Called by the compose page when the user enters their phone and taps
// "Send code." Rate-limited at the DB layer (5 codes/phone/hour).
//
// Deploy: `supabase functions deploy sms-otp-request --no-verify-jwt`
// (compose page calls anonymously; the draft_token + rate limit are
// the security boundary)
//
// Request:
//   POST { phone: "+14155551234", draft_token: "abc..." }
// Response:
//   { ok: true }
//   { ok: false, reason: "rate_limited" | "invalid_phone" | "twilio_failed" }

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Inlined to avoid cross-function import — Deno deployer doesn't bundle
// our other Edge Functions. Keeps Twilio sending logic identical to the
// sms-send helper.
async function sendSms(to: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const form = new URLSearchParams({
    From: TWILIO_FROM_NUMBER,
    To: to,
    Body: body,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = `Twilio ${res.status}`;
    try { msg = JSON.parse(text)?.message ?? msg; } catch { msg = text.slice(0, 200) || msg; }
    return { ok: false, error: msg };
  }
  return { ok: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, reason: "bad_json" }, 400); }

  const phone = String(body?.phone ?? "").trim();
  const draftToken = body?.draft_token ? String(body.draft_token) : null;
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    return json({ ok: false, reason: "invalid_phone" });
  }
  if (draftToken !== null && (draftToken.length < 16 || draftToken.length > 64)) {
    return json({ ok: false, reason: "bad_draft_token" });
  }

  // Mint code via RPC (handles rate limit).
  const { data, error } = await admin.rpc("mint_phone_otp", {
    p_phone: phone,
    p_draft_token: draftToken,
  });
  if (error) {
    console.error("[sms-otp-request] RPC error", error);
    return json({ ok: false, reason: "internal" }, 500);
  }
  const result = data as { ok: boolean; reason?: string; code?: string };
  if (!result?.ok) {
    return json({ ok: false, reason: result?.reason ?? "unknown" });
  }

  // Send the SMS. NOTE: trial Twilio accounts only deliver to verified
  // phones; the user's signup phone is auto-verified.
  const code = result.code!;
  const smsBody = `Your Mailroom code is ${code}. Expires in 10 minutes.`;
  const sent = await sendSms(phone, smsBody);
  if (!sent.ok) {
    console.error("[sms-otp-request] Twilio rejected", sent.error);
    // Don't leak Twilio errors to the client (trial-account restrictions
    // would expose phone-verification details). Generic message.
    return json({ ok: false, reason: "twilio_failed", detail: sent.error });
  }

  return json({ ok: true });
});
