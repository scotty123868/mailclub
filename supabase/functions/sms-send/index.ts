// sms-send — internal helper for sending outbound SMS via Twilio.
//
// This function is NOT exposed to anonymous clients. It requires the
// caller to pass the SUPABASE_SERVICE_ROLE_KEY as the bearer JWT (or
// to be invoked from another Edge Function which has the env var).
// In the future, other Edge Functions (sms-submit, lob-webhook) will
// fan out their SMS sends through here so all Twilio logic lives in
// one place.
//
// Deploy: `supabase functions deploy sms-send`
// (Default JWT verification is fine; only service_role can invoke.)
//
// Env vars required:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER — e.g. +18774MAILROOM in E.164
//
// Request body:
//   { to: "+14155551234", body: "Mailed! Arrives by Jun 2." }
// Response:
//   { ok: true, sid: "SM..." } | { ok: false, error: "..." }

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

export async function sendSms(to: string, body: string): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { ok: false, error: "Twilio env vars not configured" };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const form = new URLSearchParams({
    From: TWILIO_FROM_NUMBER,
    To: to,
    Body: body,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = `Twilio ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      msg = parsed?.message ?? msg;
    } catch {
      msg = text.slice(0, 200) || msg;
    }
    return { ok: false, error: msg };
  }
  const data = await res.json();
  return { ok: true, sid: data?.sid ?? "" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  // Auth: require service-role JWT. This function is internal-only.
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt || jwt !== SERVICE_KEY) {
    return json({ ok: false, error: "service_role required" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad JSON" }, 400);
  }
  const to = String(body?.to ?? "").trim();
  const text = String(body?.body ?? "").trim();
  if (!to || !text) {
    return json({ ok: false, error: "to + body required" }, 400);
  }
  // Basic E.164 sanity check. Twilio will reject non-E.164 anyway but
  // this gives a faster failure.
  if (!/^\+[1-9]\d{6,14}$/.test(to)) {
    return json({ ok: false, error: "to must be E.164 (e.g. +14155551234)" }, 400);
  }

  const result = await sendSms(to, text);
  if (!result.ok) {
    console.error("[sms-send] Twilio rejected", result.error);
    return json(result, 502);
  }
  return json(result);
});
