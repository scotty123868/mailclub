// sms-otp-verify. checks a 6-digit OTP for a phone (+ optional draft
// token), marks it consumed on success, flips the draft's
// verified_phone column so sms-submit knows the phone is real.
//
// Called by the compose page after the user enters the code.
//
// Deploy: `supabase functions deploy sms-otp-verify --no-verify-jwt`
//
// Request:
// POST { phone: "+14155551234", code: "123456", draft_token: "abc..." }
// Response:
// { ok: true }
// { ok: false, reason: "no_code" | "expired" | "wrong_code" | "too_many_attempts", attempts_left?: number }

// @ts-nocheck. Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

serve(async (req) => {
 if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
 if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

 let body: any;
 try { body = await req.json(); } catch { return json({ ok: false, reason: "bad_json" }, 400); }

 const phone = String(body?.phone ?? "").trim();
 const code = String(body?.code ?? "").trim();
 const draftToken = body?.draft_token ? String(body.draft_token) : null;

 if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
 return json({ ok: false, reason: "invalid_phone" });
 }
 if (!/^\d{6}$/.test(code)) {
 return json({ ok: false, reason: "invalid_code_format" });
 }

 const { data, error } = await admin.rpc("verify_phone_otp", {
 p_phone: phone,
 p_code: code,
 p_draft_token: draftToken,
 });
 if (error) {
 console.error("[sms-otp-verify] RPC error", error);
 return json({ ok: false, reason: "internal" }, 500);
 }
 return json(data);
});
