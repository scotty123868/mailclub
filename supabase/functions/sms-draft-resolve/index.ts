// sms-draft-resolve. GET handler called by the compose web page.
//
// The compose page loads at /compose/<token>. The page client calls
// this Edge Function with the token to fetch what it needs to render:
// the photo URL (signed, short-lived), the original caption (if any),
// and whether the draft is still valid.
//
// Deploy: `supabase functions deploy sms-draft-resolve --no-verify-jwt`
// (Anonymous public access. token is the only credential. The token
// is unguessable; treat it like a magic link.)
//
// Request: GET /functions/v1/sms-draft-resolve?token=<token>
// OR POST { token: "..." } if a client prefers
//
// Response (200):
// {
// ok: true,
// from_phone: "+14155551234", // shown masked on the UI
// caption: "",
// photo_url: "https://...signed URL, expires in 24h...",
// created_at: "...",
// expires_at: "..."
// }
//
// Response (200 with ok:false):
// { ok: false, reason: "not_found" | "expired" | "already_consumed" }

// @ts-nocheck. Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
 "Access-Control-Allow-Origin": "*",
 "Access-Control-Allow-Headers": "authorization, content-type, apikey",
 "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
 return new Response(JSON.stringify(body), {
 status,
 headers: { ...CORS, "Content-Type": "application/json" },
 });
}

// Mask a phone like "+14155551234" → "+1 (415) ***-1234" so the
// compose page can show "we'll text you back at ***-1234" without
// echoing the full number back to anyone with the link.
function maskPhone(e164: string): string {
 if (!e164.startsWith("+")) return e164;
 const digits = e164.slice(1);
 if (digits.length < 4) return e164;
 const last4 = digits.slice(-4);
 // US-style mask for +1 numbers. Fall back to generic for others.
 if (digits.startsWith("1") && digits.length === 11) {
 const area = digits.slice(1, 4);
 return `+1 (${area}) •••-${last4}`;
 }
 return `•••-${last4}`;
}

serve(async (req) => {
 if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

 let token = "";
 if (req.method === "GET") {
 token = new URL(req.url).searchParams.get("token") ?? "";
 } else if (req.method === "POST") {
 try {
 const body = await req.json();
 token = String(body?.token ?? "");
 } catch {
 return json({ ok: false, reason: "bad_json" }, 400);
 }
 } else {
 return json({ ok: false, reason: "method_not_allowed" }, 405);
 }

 if (!token || token.length < 16) {
 return json({ ok: false, reason: "bad_token" }, 400);
 }

 // Service-role RPC checks expiry + consumed status.
 const { data, error } = await admin.rpc("resolve_sms_draft", { p_token: token });
 if (error) {
 console.error("[sms-draft-resolve] RPC error", error);
 return json({ ok: false, reason: "internal" }, 500);
 }
 const result = data as {
 ok: boolean;
 reason?: string;
 from_phone?: string;
 caption?: string;
 photo_path?: string;
 created_at?: string;
 expires_at?: string;
 postcard_id?: string;
 };
 if (!result?.ok) {
 return json({
 ok: false,
 reason: result?.reason ?? "unknown",
 postcard_id: result?.postcard_id,
 });
 }

 // Mint a short-lived signed URL for the photo so the browser can
 // fetch it directly from Storage without us streaming bytes through
 // the Edge Function. 1-hour TTL is plenty for the compose session.
 const { data: signed, error: signErr } = await admin.storage
 .from("sms-photos")
 .createSignedUrl(result.photo_path!, 60 * 60);
 if (signErr || !signed?.signedUrl) {
 console.error("[sms-draft-resolve] sign URL failed", signErr);
 return json({ ok: false, reason: "photo_unavailable" }, 500);
 }

 return json({
 ok: true,
 from_phone_masked: maskPhone(result.from_phone ?? ""),
 caption: result.caption ?? "",
 photo_url: signed.signedUrl,
 created_at: result.created_at,
 expires_at: result.expires_at,
 });
});
