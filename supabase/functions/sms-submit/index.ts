// sms-submit. finalizes a postcard from the SMS-driven web compose
// flow. Called by the compose page after the user has:
// 1. Loaded a draft via sms-draft-resolve (draft_token in URL)
// 2. Entered a message
// 3. Entered a recipient (name + full address)
// 4. Verified ownership of the phone via sms-otp-verify
//
// What this function does (in order):
// 1. Resolves the draft. Requires it to be: not consumed, not expired,
// AND verified_phone == draft.from_phone (OTP succeeded for the
// same number that texted us originally).
// 2. Looks up or creates an auth.users row keyed by phone. If new,
// grants 1 free credit on the profile (matches FREE_CREDITS for
// iOS-app signup).
// 3. Looks up or creates a friend (by name+address) under that user.
// 4. Resolves a signed URL for the draft's photo in the sms-photos
// Storage bucket.
// 5. Calls send_postcard_sms RPC (service-role) to insert the postcard
// row + deduct the credit atomically. Returns postcard_id.
// 6. Calls lob-send-postcard via internal HTTP with the shared
// MAILROOM_INTERNAL_SECRET, using render_mode="html" (same path
// the claim flow uses for server-side postcard rendering).
// 7. Marks the draft consumed (consume_sms_draft RPC), linking it
// to postcard_id.
// 8. Fires a confirmation SMS via Twilio: "Mailed! Arrives by [date]"
//
// On failure between steps 5 and 6, we refund the credit + delete the
// orphan postcard so the user can retry without losing money.
//
// Deploy: `supabase functions deploy sms-submit --no-verify-jwt`
//
// Request:
// POST {
// draft_token: "abc...",
// phone: "+14155551234", // must equal draft.verified_phone
// message: "Wish you were here",
// recipient: {
// name: "Lori Lefkowitz",
// line1: "123 Main St",
// line2: "Apt 4", // optional
// city: "Naples",
// state: "FL",
// zip: "34101"
// }
// }
//
// Response (200, success):
// { ok: true, postcard_id: "...", expected_delivery: "2026-06-02", credits_remaining: 0 }
//
// Response (200, structured failure):
// { ok: false, reason: "...", message: "..." }

// @ts-nocheck. Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";

// New accounts start at 0 — launch pricing has no free first card.
const FREE_CREDITS_NEW_USER = 0;

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

// ---------- Twilio send (inlined) -------------------------------------
async function sendSmsConfirm(to: string, body: string): Promise<void> {
 if (!TWILIO_ACCOUNT_SID || !TWILIO_FROM_NUMBER) return;
 try {
 const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
 const auth = "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
 const form = new URLSearchParams({ From: TWILIO_FROM_NUMBER, To: to, Body: body });
 await fetch(url, {
 method: "POST",
 headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
 body: form.toString(),
 });
 } catch (e) {
 // Best-effort: confirmation SMS failing doesn't fail the send.
 console.warn("[sms-submit] confirmation SMS failed", e?.message ?? e);
 }
}

// ---------- Auth user lookup/create by phone -------------------------
async function findOrCreateUserByPhone(phone: string): Promise<{ userId: string; isNew: boolean }> {
 // listUsers paginated by phone filter. The admin API doesn't have a
 // direct "get by phone" so we list (filtered) and take the first hit.
 // For low-volume SMS signups this is fine; if it grows we add a
 // dedicated profiles.phone unique index lookup before this call.
 const { data: existing } = await admin
 .from("profiles")
 .select("id")
 .eq("phone", phone)
 .maybeSingle();
 if (existing?.id) {
 return { userId: existing.id, isNew: false };
 }

 // Create the auth user. phone_confirm=true marks it verified since
 // we already OTP'd them via Supabase's own SMS flow (well, our own
 // OTP. but functionally same trust level).
 const { data: created, error: createErr } = await admin.auth.admin.createUser({
 phone,
 phone_confirm: true,
 user_metadata: {
 signup_surface: "sms",
 },
 });
 if (createErr || !created?.user?.id) {
 throw new Error(`createUser failed: ${createErr?.message ?? "unknown"}`);
 }
 const userId = created.user.id;

 // Create the matching profile row with free credit + phone link.
 // ON CONFLICT for safety: if a profiles row was already created by
 // the auth-trigger we may have set up elsewhere, just bail (the
 // existing row already has the user; we'll attach phone separately).
 const { error: profileErr } = await admin
 .from("profiles")
 .upsert({
 id: userId,
 phone,
 credits: FREE_CREDITS_NEW_USER,
 // The `name` column is non-null with default ''. Leave it empty;
 // the user can set it later in the iOS app. Phone is the source
 // of identity in this flow.
 name: "",
 }, { onConflict: "id" });
 if (profileErr) {
 throw new Error(`profile upsert failed: ${profileErr.message}`);
 }
 return { userId, isNew: true };
}

// ---------- Friend lookup/create --------------------------------------
async function findOrCreateFriend(
 userId: string,
 recipient: {
 name: string;
 line1: string;
 line2?: string;
 city: string;
 state: string;
 zip: string;
 },
): Promise<{ friendId: string }> {
 // Match on owner + name + zip + line1. same recipient + address
 // shouldn't create dupes if the user texts in multiple times to send
 // to the same person. (Cheap heuristic; not bulletproof for typos.)
 const { data: existing } = await admin
 .from("friends")
 .select("id")
 .eq("owner_id", userId)
 .ilike("name", recipient.name.trim())
 .eq("address_zip", recipient.zip.trim())
 .maybeSingle();
 if (existing?.id) return { friendId: existing.id };

 const { data: created, error: createErr } = await admin
 .from("friends")
 .insert({
 owner_id: userId,
 name: recipient.name.trim(),
 city: recipient.city.trim(),
 state: recipient.state.trim().toUpperCase(),
 address_line1: recipient.line1.trim(),
 address_line2: recipient.line2?.trim() ?? null,
 address_city: recipient.city.trim(),
 address_state: recipient.state.trim().toUpperCase(),
 address_zip: recipient.zip.trim(),
 address_country: "US",
 })
 .select("id")
 .single();
 if (createErr || !created?.id) {
 throw new Error(`friend insert failed: ${createErr?.message ?? "unknown"}`);
 }
 return { friendId: created.id };
}

// ---------- Lob handoff via lob-send-postcard internal call -----------
async function handoffToLob(
 postcardId: string,
 photoUrl: string,
): Promise<{ ok: boolean; expectedDelivery?: string; error?: string }> {
 // v1.1: read env vars at call-time, not module-load-time. Supabase
 // Edge keeps containers warm across deploys when only code changes;
 // module-level Deno.env.get() captures whatever was set at the
 // container's cold start. Secrets rotated AFTER cold start were
 // invisible via the cached const. Re-reading inside the function
 // guarantees we always have the current value.
 const internalSecret = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";
 const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
 // Supabase reserves the SUPABASE_ prefix and doesn't expose
 // SUPABASE_ANON_KEY to deployed Edge Functions (since 2026-02 platform
 // update). We hardcode the public anon JWT here. it's already in
 // app.json under expoConfig.extra.supabaseAnonKey, so this is no new
 // secret exposure. Used only to satisfy the gateway's "valid JWT
 // present" check; lob-send-postcard's INTERNAL path then bypasses the
 // user-JWT validation entirely via the x-mailroom-internal header.
 const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sd25tZ3d5bG1tbmFlbWRuemxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDI1NjksImV4cCI6MjA5NDA3ODU2OX0.rZlWORqFLfFCBQQ4RPUOBtrqAX_Tc0Gf_sI5hPPENxM";
 if (!internalSecret) {
 return { ok: false, error: "MAILROOM_INTERNAL_SECRET not configured" };
 }
 const url = `${SUPABASE_URL}/functions/v1/lob-send-postcard`;
 try {
 const res = await fetch(url, {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 // Two layers of auth here:
 // 1. Supabase's Edge gateway requires a valid JWT to route
 // to a deploy made with --verify-jwt (lob-send-postcard's
 // default). Service-role JWT bypasses cleanly.
 // 2. lob-send-postcard's own auth has two branches: bearer
 // user JWT OR x-mailroom-internal matching the shared
 // secret. With both present, the internal-call branch
 // wins (it's checked first), so we skip user-id validation
 //. which is right: the sender's identity was already
 // established server-side via OTP + admin createUser
 // earlier in this function.
 // Use ANON key for the Bearer/apikey. same as a website client
 // would send. The gateway routes the request through. Then
 // lob-send-postcard's INTERNAL path (checked first in its auth
 // block) bypasses the user-JWT validation that would otherwise
 // reject an anon caller. Using service-role here caused Supabase's
 // edge gateway to reject the request before our function ran.
 Authorization: `Bearer ${anonKey}`,
 apikey: anonKey,
 "x-mailroom-internal": internalSecret,
 },
 body: JSON.stringify({
 postcard_id: postcardId,
 render_mode: "html",
 }),
 });
 const rawText = await res.text();
 let data: any = {};
 try { data = JSON.parse(rawText); } catch { data = { _raw: rawText.slice(0, 200) }; }
 if (!data?.ok) {
 // Log everything we know for debugging. Don't leak secrets.
 console.error("[sms-submit] lob handoff non-ok", {
 http_status: res.status,
 body_preview: rawText.slice(0, 300),
 sent_internal_secret_length: internalSecret.length,
 sent_anon_key_length: anonKey.length,
 });
 return { ok: false, error: data?.error ?? `HTTP ${res.status} ${rawText.slice(0, 100)}` };
 }
 if (!data?.lob_id) {
 // Defense-in-depth: same protection we added in client lob.ts.
 return { ok: false, error: "Lob handoff returned no lob_id" };
 }
 return { ok: true, expectedDelivery: data.expected_delivery_date };
 } catch (e) {
 return { ok: false, error: e?.message ?? "network error" };
 }
}

// ---------- Main handler ---------------------------------------------
serve(async (req) => {
 if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
 if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

 let body: any;
 try { body = await req.json(); } catch { return json({ ok: false, reason: "bad_json" }, 400); }

 const draftToken = String(body?.draft_token ?? "").trim();
 const phone = String(body?.phone ?? "").trim();
 const message = String(body?.message ?? "").trim();
 const recipient = body?.recipient ?? {};

 if (draftToken.length < 16) return json({ ok: false, reason: "bad_draft_token" });
 if (!/^\+[1-9]\d{6,14}$/.test(phone)) return json({ ok: false, reason: "invalid_phone" });
 if (message.length === 0 || message.length > 240) return json({ ok: false, reason: "invalid_message" });
 if (!recipient?.name || !recipient?.line1 || !recipient?.city || !recipient?.state || !recipient?.zip) {
 return json({ ok: false, reason: "invalid_recipient" });
 }

 // ---- Step 1: resolve draft + verify it's been OTP-confirmed ----
 const { data: draftRow } = await admin
 .from("sms_postcard_drafts")
 .select("*")
 .eq("token", draftToken)
 .maybeSingle();
 if (!draftRow) return json({ ok: false, reason: "draft_not_found" });
 if (draftRow.consumed_at) {
 return json({
 ok: false,
 reason: "already_consumed",
 postcard_id: draftRow.postcard_id,
 });
 }
 if (new Date(draftRow.expires_at).getTime() < Date.now()) {
 return json({ ok: false, reason: "expired" });
 }
 if (draftRow.verified_phone !== phone || draftRow.from_phone !== phone) {
 // OTP must be for the SAME phone that originally texted in.
 return json({ ok: false, reason: "phone_mismatch" });
 }

 // ---- Step 2: find or create the auth user + profile ----
 let userId: string;
 let isNew = false;
 try {
 const u = await findOrCreateUserByPhone(phone);
 userId = u.userId;
 isNew = u.isNew;
 } catch (e) {
 console.error("[sms-submit] user create failed", e);
 return json({ ok: false, reason: "user_create_failed", message: e?.message }, 500);
 }

 // ---- Step 3: find or create the friend ----
 let friendId: string;
 try {
 const f = await findOrCreateFriend(userId, recipient);
 friendId = f.friendId;
 } catch (e) {
 console.error("[sms-submit] friend create failed", e);
 return json({ ok: false, reason: "friend_create_failed", message: e?.message }, 500);
 }

 // ---- Step 4: resolve a fetchable photo URL ----
 // The draft's photo_path is normally a bucket-relative path (set by
 // sms-inbound when it uploaded the MMS media), in which case we mint
 // a 24h signed URL. For smoke-test / test-data fixtures the path can
 // also already be an absolute URL. pass those through unchanged
 // (matches lob-send-postcard's same handling). Either way Lob ends
 // up with a public-fetchable URL it can <img> into the rendered card.
 let photoFetchUrl = "";
 if (draftRow.photo_path.startsWith("http")) {
 photoFetchUrl = draftRow.photo_path;
 } else {
 const { data: signed, error: signErr } = await admin.storage
 .from("sms-photos")
 .createSignedUrl(draftRow.photo_path, 60 * 60 * 24);
 if (signErr || !signed?.signedUrl) {
 return json({ ok: false, reason: "photo_sign_failed", message: signErr?.message }, 500);
 }
 photoFetchUrl = signed.signedUrl;
 }

 // ---- Step 5: create postcard + deduct credit (atomic in RPC) ----
 // Pass the signed URL as photo_path. lob-send-postcard's render_mode=
 // "html" branch handles URLs that start with "http" by using them
 // directly (no second sign needed), so the same signed URL serves
 // both the DB persistence and the Lob template fetch.
 const { data: postcardId, error: postcardErr } = await admin.rpc("send_postcard_sms", {
 p_user_id: userId,
 p_to_friend_id: friendId,
 p_message: message,
 p_photo_path: photoFetchUrl,
 p_to_city: recipient.city.trim(),
 p_from_city: "", // SMS users don't have a self-city captured yet
 });
 if (postcardErr) {
 console.error("[sms-submit] send_postcard_sms RPC failed", postcardErr);
 const reason = postcardErr.message?.includes("insufficient_credits")
 ? "out_of_credits"
 : "send_failed";
 return json({ ok: false, reason, message: postcardErr.message }, 500);
 }

 // ---- Step 6: hand off to Lob ----
 const lobResult = await handoffToLob(postcardId as string, photoFetchUrl);
 if (!lobResult.ok) {
 // v1.1: refund_postcard_credit RPC checks auth.uid() which is null
 // in service-role context, so it always raises "Not authenticated"
 // when sms-submit calls it. Do the refund + orphan delete inline
 // with the admin client.
 const { data: cur } = await admin
 .from("profiles").select("credits").eq("id", userId).maybeSingle();
 await admin
 .from("profiles")
 .update({ credits: (cur?.credits ?? 0) + 1 })
 .eq("id", userId);
 await admin.from("postcards").delete().eq("id", postcardId);
 console.error(
 "[sms-submit] Lob handoff failed, refunded credit + deleted orphan",
 lobResult.error,
 );
 return json({ ok: false, reason: "lob_failed", message: lobResult.error }, 502);
 }

 // ---- Step 7: mark draft consumed ----
 await admin.rpc("consume_sms_draft", {
 p_token: draftToken,
 p_postcard_id: postcardId,
 });

 // ---- Step 8: confirmation SMS to sender (best-effort) ----
 const eta = lobResult.expectedDelivery
 ? new Date(lobResult.expectedDelivery).toLocaleDateString("en-US", {
 month: "short", day: "numeric",
 })
 : "in 3-5 days";
 await sendSmsConfirm(
 phone,
 `Your postcard to ${recipient.name.trim()} is in the mail. Arrives ${eta}. ` +
 `Want to see it land? Download Mailroom: https://apps.apple.com/app/id6768460855`,
 );

 // Refetch credits remaining for the response.
 const { data: profileAfter } = await admin
 .from("profiles")
 .select("credits")
 .eq("id", userId)
 .maybeSingle();

 return json({
 ok: true,
 postcard_id: postcardId,
 expected_delivery: lobResult.expectedDelivery,
 credits_remaining: profileAfter?.credits ?? 0,
 is_new_user: isNew,
 });
});
