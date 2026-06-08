// sms-inbound. conversational state machine for SMS-only postcard flow.
//
// v1.2: rewrote from "MMS → magic link" into "MMS → SMS conversation → mailed".
// The user texts a photo, then we walk them through composing the whole card
// via back-and-forth SMS. No web wizard required.
//
// Conversation states (full table in sms_conversation_state.step):
//
// idle
// ↓ (user texts photo)
// awaiting_recipient_name
// ↓ (user texts a name)
// awaiting_recipient_address
// ↓ (user texts an address, we parse via GPT-4o-mini)
// awaiting_address_confirm
// ↓ (user texts Y/yes/etc, parsed via LLM)
// awaiting_message
// ↓ (user texts the note)
// awaiting_send_confirm
// ↓ (user texts SEND, parsed via LLM)
// → submit to Lob → reply with confirmation → reset to idle
//
// At ANY step:
// - Texting a new photo restarts the conversation with a fresh draft.
// - Texting CANCEL / STOP / RESTART resets to idle.
//
// Deploy: `supabase functions deploy sms-inbound --no-verify-jwt`
//
// Env vars (set via supabase secrets):
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
// OPENAI_API_KEY (for response parsing via gpt-4o-mini)
// MAILROOM_INTERNAL_SECRET (for Lob handoff via lob-send-postcard)
// SMS_INBOUND_SKIP_VERIFY=true (temp until A2P approves. bypasses Twilio
// signature check that's mismatching due to
// host-header rewrite in Supabase Edge runtime)

// @ts-nocheck. Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// First-card-free baseline. matches WelcomeSheet's iOS-app default so SMS
// signups and iOS signups get the same starting balance.
const FREE_CREDITS_NEW_USER = 1;

// =============================================================================
// Twilio helpers
// =============================================================================

// Accepts one or more SMS bubbles. Twilio renders each <Message> as a
// separate SMS in the conversation thread (Twilio doc: "Multiple Message
// nouns are sent in the same TwiML"). We use this to split long prompts
// into two bubbles. more conversational, easier to scan on a phone.
function twiml(...bodies: string[]): Response {
 const messages = bodies
 .filter((b) => b && b.trim().length > 0)
 .map((b) => `<Message>${escapeXml(b)}</Message>`)
 .join("");
 const xml = `<?xml version="1.0" encoding="UTF-8"?><Response>${messages}</Response>`;
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
 .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
 .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function verifyTwilioSignature(
 url: string,
 formData: Record<string, string>,
 signatureHeader: string | null,
): Promise<boolean> {
 if (Deno.env.get("SMS_INBOUND_SKIP_VERIFY") === "true") return true;
 const token = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
 if (!signatureHeader || !token) return false;
 const keys = Object.keys(formData).sort();
 let payload = url;
 for (const k of keys) payload += k + formData[k];
 const enc = new TextEncoder();
 const key = await crypto.subtle.importKey(
 "raw", enc.encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
 );
 const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
 return btoa(String.fromCharCode(...new Uint8Array(sig))) === signatureHeader;
}

// Random URL-safe token for the photo storage path + the draft key.
function mintToken(): string {
 const bytes = new Uint8Array(24);
 crypto.getRandomValues(bytes);
 return btoa(String.fromCharCode(...bytes))
 .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function downloadAndUploadPhoto(
 mediaUrl: string,
 mediaContentType: string,
 token: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
 const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
 const auth = "Basic " + btoa(`${sid}:${Deno.env.get("TWILIO_AUTH_TOKEN") ?? ""}`);
 const res = await fetch(mediaUrl, { headers: { Authorization: auth } });
 if (!res.ok) return { ok: false, error: `Twilio media fetch ${res.status}` };
 const bytes = new Uint8Array(await res.arrayBuffer());
 if (bytes.length === 0) return { ok: false, error: "Empty media body" };
 const ext = mediaContentType?.includes("png") ? "png"
 : mediaContentType?.includes("gif") ? "gif"
 : mediaContentType?.includes("heic") ? "heic"
 : "jpg";
 const path = `${token}/photo.${ext}`;
 const { error: uploadErr } = await admin.storage
 .from("sms-photos")
 .upload(path, bytes, { contentType: mediaContentType || "image/jpeg", upsert: false });
 if (uploadErr) return { ok: false, error: `Storage upload: ${uploadErr.message}` };
 return { ok: true, path };
}

// =============================================================================
// LLM parsing. GPT-4o-mini via OpenAI API
// =============================================================================

interface ParsedAddress {
 line1: string;
 line2: string;
 city: string;
 state: string;
 zip: string;
 confidence: number; // 0-1, model's self-rated certainty
 formatted: string; // human-readable for confirm prompt
}

interface ParsedConfirm {
 intent: "yes" | "no" | "unclear";
}

interface ParsedLocation {
 city: string;
 state: string; // 2-letter
 confidence: number; // 0-1
}

// v1.2 scheduled sending. At the SEND step the user can say "send", "cancel",
// or pick a future date ("send June 15", "mail it for her birthday Aug 14",
// "send in 3 days", "next Tuesday"). parseSendConfirm normalizes all of those
// into a single intent. arrival_iso is the date the postcard should ARRIVE
// (not the date we hand off to Lob). We subtract 7 days for Lob first-class
// transit when computing scheduled_send_at downstream.
interface ParsedSendConfirm {
 intent: "send_now" | "schedule" | "cancel" | "unclear";
 arrival_iso?: string; // YYYY-MM-DD, only when intent === "schedule"
 formatted?: string; // human-readable arrival date, only when scheduled
}

// Generic chat-completion call returning parsed JSON.
async function openaiJson(messages: Array<{ role: string; content: string }>): Promise<any | null> {
 const key = Deno.env.get("OPENAI_API_KEY") ?? "";
 if (!key) {
 console.warn("[sms-inbound] OPENAI_API_KEY not set");
 return null;
 }
 try {
 const res = await fetch("https://api.openai.com/v1/chat/completions", {
 method: "POST",
 headers: {
 Authorization: `Bearer ${key}`,
 "Content-Type": "application/json",
 },
 body: JSON.stringify({
 model: "gpt-4o-mini",
 messages,
 response_format: { type: "json_object" },
 temperature: 0,
 max_tokens: 200,
 }),
 });
 if (!res.ok) {
 console.warn("[sms-inbound] OpenAI", res.status, await res.text().catch(() => ""));
 return null;
 }
 const data = await res.json();
 const raw = data.choices?.[0]?.message?.content ?? "";
 return JSON.parse(raw);
 } catch (e) {
 console.warn("[sms-inbound] OpenAI threw", e?.message ?? e);
 return null;
 }
}

async function parseAddress(input: string): Promise<ParsedAddress | null> {
 const result = await openaiJson([
 {
 role: "system",
 content:
 "You parse US mailing addresses from messy text. Return JSON only. " +
 'Schema: { "line1": string, "line2": string|"", "city": string, "state": string (2-letter), "zip": string (5 or 5-4), "confidence": number 0-1, "formatted": string (single-line human readable) }. ' +
 "If the input is clearly not an address (e.g., just a name, or 'yes', or empty), return confidence: 0 and empty strings. " +
 "Normalize state to 2 letters (e.g., 'Florida' → 'FL'). Strip apartment from line1 into line2. " +
 'Example input: "123 main st apt 4 naples florida 34101" → ' +
 '{"line1": "123 Main St", "line2": "Apt 4", "city": "Naples", "state": "FL", "zip": "34101", "confidence": 0.95, "formatted": "123 Main St, Apt 4, Naples, FL 34101"}',
 },
 { role: "user", content: input },
 ]);
 if (!result) return null;
 return result as ParsedAddress;
}

async function parseLocation(input: string): Promise<ParsedLocation | null> {
 const result = await openaiJson([
 {
 role: "system",
 content:
 "You parse a US city + state from messy text. Return JSON only. " +
 'Schema: { "city": string, "state": string (2-letter), "confidence": number 0-1 }. ' +
 "Normalize state to 2 letters (e.g. 'Florida' → 'FL', 'New York' → 'NY'). " +
 "If the input doesn't clearly contain a city + state, return confidence: 0 and empty strings. " +
 'Examples: "Bethesda, MD" → {"city": "Bethesda", "state": "MD", "confidence": 0.99}. ' +
 '"naples florida" → {"city": "Naples", "state": "FL", "confidence": 0.95}. ' +
 '"SF" → {"city": "San Francisco", "state": "CA", "confidence": 0.85}. ' +
 '"hi" → {"city": "", "state": "", "confidence": 0}.',
 },
 { role: "user", content: input },
 ]);
 return result as ParsedLocation | null;
}

async function parseConfirmation(input: string): Promise<ParsedConfirm> {
 const trimmed = input.trim().toLowerCase();
 // Fast-path obvious cases without calling the LLM (saves money + latency).
 // Multi-word affirmatives ("yeah sure", "sounds good") added per QA finding .
 // common conversational replies were falling through to LLM and getting
 // misclassified as "unclear".
 if (/^(y|yes|yep|yeah|yas|sure|ok|okay|confirm|confirmed|send|ship|do it|go|👍|✅|🚀|yeah sure|yes please|sounds good|looks good|go ahead|sure thing|that's right|thats right)$/i.test(trimmed)) {
 return { intent: "yes" };
 }
 if (/^(n|no|nope|nah|cancel|stop|wait|hold on|not yet|no thanks)$/i.test(trimmed)) {
 return { intent: "no" };
 }
 // Ambiguous → ask the LLM.
 const result = await openaiJson([
 {
 role: "system",
 content:
 "Classify a short SMS reply as one of: yes, no, unclear. " +
 'Schema: { "intent": "yes" | "no" | "unclear" }. ' +
 "'yes' = the user confirms / agrees / says go ahead. 'no' = denies / cancels / says wait. 'unclear' = neither.",
 },
 { role: "user", content: input },
 ]);
 if (!result || !["yes", "no", "unclear"].includes(result.intent)) {
 return { intent: "unclear" };
 }
 return result as ParsedConfirm;
}

// Schedule-aware send confirmation. Used at the awaiting_send_confirm step only.
// Fast-paths obvious send/cancel without an LLM call; otherwise asks the model
// to also extract a future arrival date if the user is scheduling.
async function parseSendConfirm(input: string): Promise<ParsedSendConfirm> {
 const trimmed = input.trim().toLowerCase();
 // Fast paths. bare "send" / "yes" / "go" etc. → send now.
 if (/^(y|yes|yep|yeah|yas|sure|ok|okay|confirm|confirmed|send|ship|do it|go|👍|✅|🚀|yeah sure|yes please|sounds good|looks good|go ahead|sure thing|let's go|lets go)$/i.test(trimmed)) {
 return { intent: "send_now" };
 }
 if (/^(n|no|nope|nah|cancel|stop|wait|hold on|not yet|no thanks)$/i.test(trimmed)) {
 return { intent: "cancel" };
 }

 // Anything else → LLM. We give the model today's date so relative
 // expressions like "in 3 days" or "next Tuesday" resolve correctly.
 const today = new Date().toISOString().slice(0, 10);
 const result = await openaiJson([
 {
 role: "system",
 content:
 `You classify an SMS reply at the SEND step of a postcard flow. Today is ${today}.` +
 ` The user can:\n` +
 ` - Confirm to mail NOW: "send", "yes", "go", "ship it"\n` +
 ` - Schedule for a future date: "schedule June 15", "for her birthday Aug 14",` +
 ` "send in 3 days", "mail it next Tuesday", "send it on the 15th",` +
 ` "send tomorrow", "asap" (asap = send_now)\n` +
 ` - Cancel: "no", "cancel", "nevermind"\n` +
 ` - Unclear: anything else\n\n` +
 `Return JSON: { "intent": "send_now" | "schedule" | "cancel" | "unclear",` +
 ` "arrival_iso": "YYYY-MM-DD" | null, "formatted": string | null }.\n\n` +
 `arrival_iso is the date the postcard should ARRIVE at the recipient.` +
 ` Set this whenever the user named a future date, EVEN IF the date is` +
 ` too close (sub-7-day). the calling code checks lead time and gives` +
 ` a specific reply. Only leave arrival_iso null when intent is not "schedule".\n` +
 ` - "send in 3 days" → arrival_iso = today + 3 days (still set it; lead-time check follows)\n` +
 ` - "for June 15" → arrival_iso = next June 15 strictly in the future\n` +
 ` - "next Tuesday" → arrival_iso = the Tuesday of next week from today\n` +
 ` - "send tomorrow" → arrival_iso = today + 1 day (still set it; too-close handled downstream)\n` +
 ` - "for halloween" → arrival_iso = next October 31\n\n` +
 `formatted is human-readable like "June 15, 2026". Only set when scheduling.\n\n` +
 `Only return intent: "unclear" if you genuinely can't tell what the user means` +
 ` or if the input is garbage. Do NOT use "unclear" just because a date is close.`,
 },
 { role: "user", content: input },
 ]);
 if (!result || !["send_now", "schedule", "cancel", "unclear"].includes(result.intent)) {
 return { intent: "unclear" };
 }
 return result as ParsedSendConfirm;
}

// =============================================================================
// Database helpers
// =============================================================================

async function getConversationState(phone: string) {
 const { data } = await admin
 .from("sms_conversation_state")
 .select("*")
 .eq("phone", phone)
 .maybeSingle();
 if (!data) return { step: "idle", draft_token: null, conversation_data: {} };
 return data;
}

async function advanceState(
 phone: string,
 step: string,
 draftToken: string | null,
 dataPatch: Record<string, unknown>,
) {
 await admin.rpc("advance_sms_conversation", {
 p_phone: phone,
 p_step: step,
 p_draft_token: draftToken,
 p_data_patch: dataPatch,
 });
}

async function resetState(phone: string) {
 await admin.rpc("reset_sms_conversation", { p_phone: phone });
}

// =============================================================================
// Lob handoff (same internal-secret HTTP pattern as sms-submit)
// =============================================================================

async function submitToLob(
 postcardId: string,
): Promise<{ ok: boolean; expectedDelivery?: string; error?: string }> {
 const internalSecret = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";
 if (!internalSecret) return { ok: false, error: "internal secret not set" };
 // Hardcoded anon key. Supabase Edge no longer exposes SUPABASE_ANON_KEY env.
 const anonKey =
 "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sd25tZ3d5bG1tbmFlbWRuemxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDI1NjksImV4cCI6MjA5NDA3ODU2OX0.rZlWORqFLfFCBQQ4RPUOBtrqAX_Tc0Gf_sI5hPPENxM";
 try {
 const res = await fetch(`${SUPABASE_URL}/functions/v1/lob-send-postcard`, {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 Authorization: `Bearer ${anonKey}`,
 apikey: anonKey,
 "x-mailroom-internal": internalSecret,
 },
 body: JSON.stringify({ postcard_id: postcardId, render_mode: "html" }),
 });
 const rawText = await res.text();
 let data: any = {};
 try { data = JSON.parse(rawText); } catch { /* ignore */ }
 if (!data?.ok || !data?.lob_id) {
 return { ok: false, error: data?.error ?? `HTTP ${res.status} ${rawText.slice(0, 100)}` };
 }
 return { ok: true, expectedDelivery: data.expected_delivery_date };
 } catch (e) {
 return { ok: false, error: e?.message ?? "network error" };
 }
}

// =============================================================================
// User + friend creation (same pattern as sms-submit)
// =============================================================================

// Returns the SEND-prompt parenthetical for this user:
// - new user (no profile or zero prior sends) → " (First one's free.)"
// - repeat user with credits → " (Uses 1 of N cards.)"
// - repeat user with 0 credits → "" (insufficient_credits
// will get raised by send_postcard_sms RPC and handled in doMail)
// One DB round-trip. profile + postcard count via a single PostgREST call.
async function balanceParenthetical(phone: string): Promise<string> {
 const { data: prof } = await admin
 .from("profiles").select("id, credits").eq("phone", phone).maybeSingle();
 if (!prof?.id) return " (First one's free.)"; // brand-new phone
 const { count } = await admin
 .from("postcards")
 .select("id", { count: "exact", head: true })
 .eq("sender_id", prof.id)
 .in("status", ["sent", "delivered", "in_transit", "scheduled", "queued"]);
 if ((count ?? 0) === 0) return " (First one's free.)";
 const credits = prof.credits ?? 0;
 if (credits <= 0) return ""; // out. doMail will catch + show BUY
 return ` (Uses 1 of ${credits} card${credits === 1 ? "" : "s"}.)`;
}

async function findOrCreateUserByPhone(phone: string): Promise<string> {
 const { data: existing } = await admin
 .from("profiles").select("id").eq("phone", phone).maybeSingle();
 if (existing?.id) return existing.id;
 const { data: created, error } = await admin.auth.admin.createUser({
 phone, phone_confirm: true, user_metadata: { signup_surface: "sms" },
 });
 if (error || !created?.user?.id) throw new Error(`createUser: ${error?.message}`);
 const userId = created.user.id;
 await admin.from("profiles").upsert(
 { id: userId, phone, credits: FREE_CREDITS_NEW_USER, name: "" },
 { onConflict: "id" },
 );
 return userId;
}

async function findOrCreateFriend(
 userId: string,
 recipient: ParsedAddress & { name: string },
): Promise<string> {
 const { data: existing } = await admin
 .from("friends").select("id")
 .eq("owner_id", userId).ilike("name", recipient.name.trim()).eq("address_zip", recipient.zip)
 .maybeSingle();
 if (existing?.id) return existing.id;
 const { data: created, error } = await admin.from("friends").insert({
 owner_id: userId, name: recipient.name.trim(),
 city: recipient.city, state: recipient.state,
 address_line1: recipient.line1, address_line2: recipient.line2 || null,
 address_city: recipient.city, address_state: recipient.state,
 address_zip: recipient.zip, address_country: "US",
 }).select("id").single();
 if (error || !created?.id) throw new Error(`friend insert: ${error?.message}`);
 return created.id;
}

// =============================================================================
// State machine: handle inbound based on current step
// =============================================================================

interface InboundContext {
 from: string;
 body: string;
 numMedia: number;
 mediaUrl: string | null;
 mediaType: string | null;
}

// Detect "start over" intent. single source of truth for restart commands.
// NOTE: "cancel" here means "abandon the in-progress draft", NOT "cancel a
// scheduled card". A scheduled-card cancel flow doesn't exist yet (would
// need a follow-up step asking which card).
function isRestartCommand(body: string): boolean {
 return /^(cancel|stop|restart|reset|start over|nevermind|never mind)$/i.test(body.trim());
}

// v1.2 BUY keyword. repeat senders text BUY (optionally with a pack size)
// to get a Stripe Checkout URL for more credits. Matches:
// BUY → default pack (p10. "ten for ten" middle option)
// BUY 5 / BUY5 → p5 ($5 / 3 cards)
// BUY 10 / BUY10 → p10 ($10 / 8 cards)
// BUY 25 / BUY25 → p25 ($25 / 25 cards)
// Anything else → falls through (LLM parse handles ambiguous "BUY MORE" etc.
// via the state machine. we can promote this later if needed).
function parseBuyKeyword(body: string): { matched: true; pack_id: string } | { matched: false } {
 const m = body.trim().toUpperCase().match(/^BUY\s*(5|10|25)?$/);
 if (!m) return { matched: false };
 const size = m[1];
 if (size === "5") return { matched: true, pack_id: "p5" };
 if (size === "25") return { matched: true, pack_id: "p25" };
 // Default (BUY alone, or BUY 10) → p10, the clean "ten for ten" middle.
 return { matched: true, pack_id: "p10" };
}

async function createBuyCheckout(
 phone: string,
 packId: string,
): Promise<{ ok: true; url: string; pack_label: string } | { ok: false; error: string }> {
 const internalSecret = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";
 if (!internalSecret) return { ok: false, error: "internal secret not set" };
 const anonKey =
 "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sd25tZ3d5bG1tbmFlbWRuemxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDI1NjksImV4cCI6MjA5NDA3ODU2OX0.rZlWORqFLfFCBQQ4RPUOBtrqAX_Tc0Gf_sI5hPPENxM";
 try {
 const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-buy-checkout`, {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 Authorization: `Bearer ${anonKey}`,
 apikey: anonKey,
 "x-mailroom-internal": internalSecret,
 },
 body: JSON.stringify({ phone, pack_id: packId }),
 });
 const data = await res.json().catch(() => ({}));
 if (!data?.ok || !data?.url) {
 return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
 }
 return { ok: true, url: data.url, pack_label: data.pack_label };
 } catch (e: any) {
 return { ok: false, error: e?.message ?? "network error" };
 }
}

async function handleInbound(ctx: InboundContext): Promise<Response> {
 const { from, body, numMedia, mediaUrl, mediaType } = ctx;

 // Global short-circuit: a new photo always restarts the conversation.
 if (numMedia >= 1 && mediaUrl) {
 return await startNewConversation(from, mediaUrl, mediaType ?? "image/jpeg");
 }

 // Global short-circuit: explicit reset commands.
 if (isRestartCommand(body)) {
 await resetState(from);
 return twiml("Cancelled. Text a new photo when you're ready to start over.");
 }

 // Global short-circuit: BUY (optionally with pack size). repeat senders
 // top up via Stripe Checkout without leaving Messages. This intercepts
 // BEFORE the per-step state machine so the user can buy from any step
 // including idle and awaiting_send_confirm.
 const buy = parseBuyKeyword(body);
 if (buy.matched) {
 const checkout = await createBuyCheckout(from, buy.pack_id);
 if (!checkout.ok) {
 console.error("[sms-inbound] BUY checkout failed", checkout.error);
 return twiml(
 "Couldn't open checkout right now. Try again in a minute, or " +
 "email scottylefkowitz2@gmail.com if it keeps failing."
 );
 }
 return twiml(
 `${checkout.pack_label}: ${checkout.url}\n\n` +
 `Link expires in 1 hour. Other packs: BUY 5 or BUY 25.`
 );
 }

 // BUY-with-unknown-size fallback. catches "BUY 100", "BUY MORE", "BUY10",
 // "BUY 5 PACK" etc. The strict regex above only accepts exactly 5/10/25.
 // Without this branch, "BUY 100" falls through to the idle prompt which
 // tells a high-intent user to "send a photo." Per QA finding.
 if (/^buy\b/i.test(body.trim())) {
 return twiml(
 "Pack sizes: BUY 5 ($5/4), BUY 10 ($10/10), or BUY 25 ($25/30). " +
 "Or just text BUY for the 25-pack (our best per-stamp value)."
 );
 }

 // Pull current state.
 const state = await getConversationState(from);

 switch (state.step) {
 case "idle": {
 // Spam guard: track how many idle-state prompts we've sent this hour.
 // 1st non-photo text → full friendly prompt.
 // 2nd → shorter nudge (acknowledges they texted but redirects to photo).
 // 3rd+ within 1 hour → empty TwiML (silence) so spammers can't burn
 // our SMS budget. The hour resets via idle_reply_first_at. after a
 // quiet hour, a new "idle session" begins.
 const dataState = state.conversation_data ?? {};
 const idleCount = (dataState.idle_reply_count ?? 0) as number;
 const idleFirstAt = dataState.idle_reply_first_at
 ? new Date(dataState.idle_reply_first_at as string).getTime()
 : 0;
 const nowMs = Date.now();
 const sessionExpired = (nowMs - idleFirstAt) > 60 * 60 * 1000;
 const effectiveCount = sessionExpired ? 0 : idleCount;

 // After 2 replies in same hour → silent.
 if (effectiveCount >= 2) {
 console.log(`[sms-inbound] idle silenced: ${from} (count=${effectiveCount})`);
 return emptyTwiml();
 }

 // Branch on credit balance so repeat senders aren't told "first card
 // free" again. We check the profile lazily so brand-new users don't
 // trigger a DB lookup.
 const { data: prof } = await admin
 .from("profiles").select("credits").eq("phone", from).maybeSingle();

 let replyText: string;
 if (!prof) {
 replyText = effectiveCount === 0
 ? "Send a photo to get started. We'll turn it into a real paper postcard. First one's free."
 : "Just send any photo. We'll do the rest.";
 } else {
 const credits = prof.credits ?? 0;
 if (credits <= 0) {
 replyText = effectiveCount === 0
 ? "You're out of cards. Top up: BUY 5 ($5/4), BUY 10 ($10/10), or BUY 25 ($25/30). Then text a photo."
 : "Reply BUY 5 / BUY 10 / BUY 25 to top up. Then text a photo.";
 } else {
 replyText = effectiveCount === 0
 ? `You have ${credits} card${credits === 1 ? "" : "s"} left. Text a photo to start a new one.`
 : "Text a photo to start a new card.";
 }
 }

 // Bump the counter. First reply sets idle_reply_first_at; later
 // replies leave it alone so the session-window clock keeps ticking.
 await advanceState(from, "idle", state.draft_token, {
 idle_reply_count: effectiveCount + 1,
 idle_reply_first_at: effectiveCount === 0
 ? new Date(nowMs).toISOString()
 : (dataState.idle_reply_first_at ?? new Date(nowMs).toISOString()),
 });

 return twiml(replyText);
 }

 case "awaiting_recipient_name":
 return await handleRecipientName(from, body, state);

 case "awaiting_recipient_address":
 return await handleRecipientAddress(from, body, state);

 case "awaiting_address_confirm":
 return await handleAddressConfirm(from, body, state);

 case "awaiting_message":
 return await handleMessage(from, body, state);

 case "awaiting_sender_location":
 return await handleSenderLocation(from, body, state);

 case "awaiting_send_confirm":
 return await handleSendConfirm(from, body, state);

 default:
 // Shouldn't happen. defensive reset.
 await resetState(from);
 return twiml("Something's off on our end. Send a fresh photo to start over.");
 }
}

// ---------- Step transitions ----------

async function startNewConversation(
 phone: string,
 mediaUrl: string,
 mediaType: string,
): Promise<Response> {
 const token = mintToken();
 const upload = await downloadAndUploadPhoto(mediaUrl, mediaType, token);
 if (!upload.ok) {
 return twiml("Hmm, couldn't save your photo. Try sending it again?");
 }
 // Create the draft row (existing sms_postcard_drafts schema). We mark
 // verified_phone immediately since this IS the verified phone. we're
 // OTP-equivalent because they texted us from their own number.
 await admin.from("sms_postcard_drafts").insert({
 token, from_phone: phone, caption: "",
 photo_path: upload.path, twilio_media_url: mediaUrl,
 verified_phone: phone,
 });
 // Reset conversation state + advance to awaiting_recipient_name.
 // Explicitly clear the idle spam counters. a photo is a successful
 // re-engagement, so they get a fresh budget of idle prompts later.
 await advanceState(phone, "awaiting_recipient_name", token, {
 idle_reply_count: 0,
 idle_reply_first_at: null,
 });
 return twiml("Got the photo. Who's it for? Reply with their name.");
}

async function handleRecipientName(
 phone: string, body: string, state: any,
): Promise<Response> {
 const name = body.trim();
 if (name.length < 1 || name.length > 80) {
 return twiml("That doesn't look like a name. Reply with the recipient's name (1-80 chars).");
 }
 await advanceState(phone, "awaiting_recipient_address", state.draft_token, {
 recipient_name: name,
 });
 return twiml(
 `Got it, to ${name}. What's their full address? One line works: ` +
 `"123 Main St, Naples FL 34101". We'll figure it out.`
 );
}

async function handleRecipientAddress(
 phone: string, body: string, state: any,
): Promise<Response> {
 const parsed = await parseAddress(body);
 if (!parsed || parsed.confidence < 0.7 || !parsed.line1 || !parsed.zip) {
 return twiml(
 "I had trouble with that address. Try again with street, city, state, and ZIP. " +
 `e.g., "123 Main St, Naples FL 34101".`
 );
 }
 await advanceState(phone, "awaiting_address_confirm", state.draft_token, {
 recipient: {
 line1: parsed.line1,
 line2: parsed.line2 || "",
 city: parsed.city,
 state: parsed.state,
 zip: parsed.zip,
 },
 });
 const recipientName = (state.conversation_data?.recipient_name ?? "your friend") as string;
 return twiml(
 `Mailing to ${recipientName} at ${parsed.formatted}. ` +
 `Reply Y to confirm, or send the right address.`
 );
}

async function handleAddressConfirm(
 phone: string, body: string, state: any,
): Promise<Response> {
 const confirm = await parseConfirmation(body);
 if (confirm.intent === "yes") {
 await advanceState(phone, "awaiting_message", state.draft_token, {});
 return twiml("What should the card say? Reply with your note. (Up to 240 chars.)");
 }
 if (confirm.intent === "no") {
 await advanceState(phone, "awaiting_recipient_address", state.draft_token, {});
 return twiml("OK, send me the right address.");
 }
 return twiml("Reply Y to confirm, or send the right address.");
}

async function handleMessage(
 phone: string, body: string, state: any,
): Promise<Response> {
 const message = body.trim();
 if (message.length === 0) {
 return twiml("Tell me what you want the postcard to say.");
 }
 const truncated = message.length > 240 ? message.slice(0, 240) : message;

 // v1.2: after the message, check if we already know the sender's city.
 // If yes, skip the location ask and go straight to send confirm. If no,
 // ask for it. we need it for the post-SEND delivery map confirmation
 // page that animates "your city → recipient's mailbox".
 const { data: profile } = await admin
 .from("profiles").select("city, state").eq("phone", phone).maybeSingle();
 const knownCity = (profile?.city ?? "").trim();
 const knownState = (profile?.state ?? "").trim();

 if (knownCity && knownState) {
 // Skip. already on file.
 await advanceState(phone, "awaiting_send_confirm", state.draft_token, {
 message: truncated,
 });
 const recipientName = (state.conversation_data?.recipient_name ?? "your friend") as string;
 const recipient = (state.conversation_data?.recipient ?? {}) as { city?: string; state?: string };
 const recipLoc = [recipient.city, recipient.state].filter(Boolean).join(", ") || "their address";
 const balanceTag = await balanceParenthetical(phone);
 return twiml(
 `From ${knownCity}, ${knownState} to ${recipientName} in ${recipLoc}.`,
 `Note: "${truncated}" Reply SEND, schedule ("June 15" or "in 3 days"), or CANCEL.${balanceTag}`,
 );
 }

 await advanceState(phone, "awaiting_sender_location", state.draft_token, {
 message: truncated,
 });
 return twiml(
 `Last thing: city + state? Like "Bethesda, MD". ` +
 `Goes on the back, and powers your live delivery map.`
 );
}

async function handleSenderLocation(
 phone: string, body: string, state: any,
): Promise<Response> {
 const parsed = await parseLocation(body);
 if (!parsed || parsed.confidence < 0.6 || !parsed.city || !parsed.state) {
 return twiml(
 `I didn't catch a city. Try again. just "City, ST" works ` +
 `(e.g. "Bethesda, MD" or "San Francisco, CA").`
 );
 }

 // Persist to the profile so we never have to ask this user again.
 // Find-or-create-user happens on SEND, but the row might already exist
 // from a previous card. Upsert keyed on phone via the profile.phone
 // unique index.
 const { data: existing } = await admin
 .from("profiles").select("id").eq("phone", phone).maybeSingle();
 if (existing?.id) {
 await admin
 .from("profiles")
 .update({ city: parsed.city, state: parsed.state })
 .eq("id", existing.id);
 }
 // Stash in conversation_data too so doMail can pass to_city + from_city
 // without re-querying the profile.
 await advanceState(phone, "awaiting_send_confirm", state.draft_token, {
 sender_city: parsed.city,
 sender_state: parsed.state,
 });

 const recipientName = (state.conversation_data?.recipient_name ?? "your friend") as string;
 const recipient = (state.conversation_data?.recipient ?? {}) as { city?: string; state?: string };
 const recipLoc = [recipient.city, recipient.state].filter(Boolean).join(", ") || "their address";
 const note = (state.conversation_data?.message ?? "") as string;
 const balanceTag = await balanceParenthetical(phone);
 return twiml(
 `From ${parsed.city}, ${parsed.state} to ${recipientName} in ${recipLoc}.`,
 `Note: "${note}" Reply SEND, schedule ("June 15" or "in 3 days"), or CANCEL.${balanceTag}`,
 );
}

async function handleSendConfirm(
 phone: string, body: string, state: any,
): Promise<Response> {
 const confirm = await parseSendConfirm(body);

 if (confirm.intent === "cancel") {
 await resetState(phone);
 return twiml("Cancelled. Send a new photo when you're ready.");
 }

 if (confirm.intent === "send_now") {
 return await doMail(phone, state);
 }

 if (confirm.intent === "schedule" && confirm.arrival_iso) {
 return await doSchedule(phone, state, confirm);
 }

 // unclear / no date / past date
 return twiml(
 "Your card's ready. Reply SEND to mail now, schedule it " +
 "(\"June 15\", \"in 3 days\", \"for her birthday Aug 14\"), or CANCEL."
 );
}

async function doMail(phone: string, state: any): Promise<Response> {
 const data = state.conversation_data ?? {};
 const recipientName = data.recipient_name as string;
 const recipient = data.recipient as { line1: string; line2: string; city: string; state: string; zip: string };
 const message = data.message as string;
 const draftToken = state.draft_token as string;

 if (!recipientName || !recipient || !message || !draftToken) {
 await resetState(phone);
 return twiml("Something's missing from your draft. Text us a fresh photo to start over.");
 }

 // 1. User + friend
 let userId: string;
 try {
 userId = await findOrCreateUserByPhone(phone);
 } catch (e) {
 console.error("[sms-inbound] user create failed", e);
 return twiml("Couldn't set up your account. Try again in a minute.");
 }

 // 1a. Persist sender city/state to the profile if we collected it
 // in this conversation. handleSenderLocation already tries to
 // update, but for NEW users that update matches 0 rows because
 // the profile doesn't exist until findOrCreateUserByPhone runs
 // here. So re-write it after we know we have a profile row.
 const senderCityFromData = (data.sender_city as string) || "";
 const senderStateFromData = (data.sender_state as string) || "";
 if (senderCityFromData && senderStateFromData) {
 await admin
 .from("profiles")
 .update({ city: senderCityFromData, state: senderStateFromData })
 .eq("id", userId);
 }

 let friendId: string;
 try {
 friendId = await findOrCreateFriend(userId, { ...recipient, name: recipientName, confidence: 1, formatted: "" });
 } catch (e) {
 console.error("[sms-inbound] friend create failed", e);
 return twiml("Couldn't save your recipient. Try again in a minute.");
 }

 // 2. Get signed photo URL from the draft.
 const { data: draftRow } = await admin
 .from("sms_postcard_drafts").select("photo_path").eq("token", draftToken).maybeSingle();
 if (!draftRow?.photo_path) {
 await resetState(phone);
 return twiml("Your photo expired. Text a new one to start over.");
 }
 let photoUrl = draftRow.photo_path;
 if (!photoUrl.startsWith("http")) {
 const { data: signed } = await admin.storage
 .from("sms-photos").createSignedUrl(photoUrl, 60 * 60 * 24 * 7);
 if (!signed?.signedUrl) {
 return twiml("Couldn't access your photo. Text us another to start over.");
 }
 photoUrl = signed.signedUrl;
 }

 // 3. Sender location: prefer the conversation_data we just collected,
 // fall back to the profile we updated in handleSenderLocation, fall
 // back to empty (cards back will just show the recipient address +
 // a Mailroom return).
 const senderCity = (data.sender_city as string) || "";
 const senderState = (data.sender_state as string) || "";

 // 4. send_postcard_sms RPC (postcard row + credit deduction)
 const { data: postcardId, error: rpcErr } = await admin.rpc("send_postcard_sms", {
 p_user_id: userId,
 p_to_friend_id: friendId,
 p_message: message,
 p_photo_path: photoUrl,
 p_to_city: recipient.city,
 p_from_city: senderCity,
 });
 if (rpcErr) {
 console.error("[sms-inbound] send_postcard_sms failed", rpcErr);
 const oom = rpcErr.message?.includes("insufficient_credits");
 return twiml(oom
 ? "You're out of cards. Top up: BUY 5 ($5/4), BUY 10 ($10/10), or BUY 25 ($25/30). " +
 "Then SEND to mail this one."
 : "Couldn't mail your card. Try SEND again, or text a new photo to start over.");
 }

 // 4. Lob handoff
 const lob = await submitToLob(postcardId as string);
 if (!lob.ok) {
 // Refund inline (service-role can't use the RPC which checks auth.uid).
 const { data: cur } = await admin
 .from("profiles").select("credits").eq("id", userId).maybeSingle();
 await admin.from("profiles").update({ credits: (cur?.credits ?? 0) + 1 }).eq("id", userId);
 await admin.from("postcards").delete().eq("id", postcardId);
 console.error("[sms-inbound] Lob failed", lob.error);
 // Don't reset state. let user retry SEND.
 return twiml(
 `Couldn't reach the printer (${lob.error?.slice(0, 80)}). Your credit's refunded. ` +
 `Reply SEND to try again or CANCEL.`
 );
 }

 // 5. Mark draft consumed + reset conversation
 await admin.rpc("consume_sms_draft", { p_token: draftToken, p_postcard_id: postcardId });
 await resetState(phone);

 const eta = lob.expectedDelivery
 ? new Date(lob.expectedDelivery).toLocaleDateString("en-US", {
 month: "short", day: "numeric",
 })
 : "in 3-5 days";

 // v1.2: instead of just a "Mailed!" text, link to a live delivery
 // map + postcard preview. The draft token is the unguessable handle
 //. the /c/<token> page reads the draft → postcard_id → renders.
 const confirmUrl = `https://app.themailroom.club/c/${draftToken}`;

 // v1.2 BUY nudge. peek at remaining balance and add a top-up reminder
 // when the user just spent their last credit. Single source of conversion
 // for repeat senders: "I just sent my free one, what next?"
 const { data: balRow } = await admin
 .from("profiles").select("credits").eq("id", userId).maybeSingle();
 const remaining = balRow?.credits ?? 0;
 const buyHint = remaining <= 0
 ? ` That was your last card. reply BUY 5 ($5/4), BUY 10 ($10/10), or BUY 25 ($25/30) for more.`
 : remaining <= 2
 ? ` ${remaining} card${remaining === 1 ? "" : "s"} left. Reply BUY for more.`
 : "";

 return twiml(
 `Mailed! 📮 Your card to ${recipientName} arrives ${eta}. ` +
 `See it travel: ${confirmUrl}${buyHint}`
 );
}

// v1.2 scheduled sending. Same setup as doMail (user + friend + photo) but
// inserts the postcard with status='scheduled' and scheduled_send_at set,
// then bails before the Lob handoff. The fire-scheduled-postcards Edge
// Function (pg_cron triggered, daily) picks up the row when the timestamp
// arrives and fires Lob.
async function doSchedule(
 phone: string,
 state: any,
 schedule: ParsedSendConfirm,
): Promise<Response> {
 const data = state.conversation_data ?? {};
 const recipientName = data.recipient_name as string;
 const recipient = data.recipient as {
 line1: string; line2: string; city: string; state: string; zip: string;
 };
 const message = data.message as string;
 const draftToken = state.draft_token as string;

 if (!recipientName || !recipient || !message || !draftToken || !schedule.arrival_iso) {
 await resetState(phone);
 return twiml("Something's missing from your draft. Text us a fresh photo to start over.");
 }

 // Lob first-class average transit is ~7 days. Subtract from arrival to get
 // send-at. Use noon UTC to dodge timezone edge cases. being off by a day
 // is fine for postcards.
 const arrival = new Date(schedule.arrival_iso + "T12:00:00Z");
 const sendAt = new Date(arrival.getTime() - 7 * 24 * 60 * 60 * 1000);

 // Past-date guard. If send-at is in the past or within a day, just refuse
 // and tell the user. Per QA finding: be SPECIFIC about lead time so the
 // user knows the issue is "too close" not "couldn't parse."
 if (sendAt.getTime() < Date.now() + 24 * 60 * 60 * 1000) {
 const arrivalLabel = schedule.formatted ??
 arrival.toLocaleDateString("en-US", { month: "short", day: "numeric" });
 return twiml(
 `${arrivalLabel} is too close. We need ~7 days for first-class mail. ` +
 `Reply SEND to mail now, or pick a later date.`
 );
 }

 // 1. User + friend (same as doMail)
 let userId: string;
 try {
 userId = await findOrCreateUserByPhone(phone);
 } catch (e) {
 console.error("[sms-inbound] user create failed (schedule)", e);
 return twiml("Couldn't set up your account. Try again in a minute.");
 }

 const senderCityFromData = (data.sender_city as string) || "";
 const senderStateFromData = (data.sender_state as string) || "";
 if (senderCityFromData && senderStateFromData) {
 await admin
 .from("profiles")
 .update({ city: senderCityFromData, state: senderStateFromData })
 .eq("id", userId);
 }

 let friendId: string;
 try {
 friendId = await findOrCreateFriend(userId, {
 ...recipient, name: recipientName, confidence: 1, formatted: "",
 });
 } catch (e) {
 console.error("[sms-inbound] friend create failed (schedule)", e);
 return twiml("Couldn't save your recipient. Try again in a minute.");
 }

 // 2. Sign the photo for ~30 days so the URL outlives short schedules.
 const { data: draftRow } = await admin
 .from("sms_postcard_drafts").select("photo_path").eq("token", draftToken).maybeSingle();
 if (!draftRow?.photo_path) {
 await resetState(phone);
 return twiml("Your photo expired. Text a new one to start over.");
 }
 let photoUrl = draftRow.photo_path;
 if (!photoUrl.startsWith("http")) {
 const { data: signed } = await admin.storage
 .from("sms-photos")
 .createSignedUrl(photoUrl, 60 * 60 * 24 * 30); // 30-day TTL
 if (!signed?.signedUrl) {
 return twiml("Couldn't access your photo. Text us another to start over.");
 }
 photoUrl = signed.signedUrl;
 }

 const senderCity = (data.sender_city as string) || "";

 // 3. send_postcard_sms with p_scheduled_send_at set. RPC creates the row
 // with status='scheduled' and skips Lob handoff. fire-scheduled-postcards
 // picks it up when sendAt arrives.
 const { data: postcardId, error: rpcErr } = await admin.rpc("send_postcard_sms", {
 p_user_id: userId,
 p_to_friend_id: friendId,
 p_message: message,
 p_photo_path: photoUrl,
 p_to_city: recipient.city,
 p_from_city: senderCity,
 p_scheduled_send_at: sendAt.toISOString(),
 });
 if (rpcErr) {
 console.error("[sms-inbound] send_postcard_sms (scheduled) failed", rpcErr);
 const oom = rpcErr.message?.includes("insufficient_credits");
 return twiml(oom
 ? "You're out of cards. Top up: BUY 5 ($5/4), BUY 10 ($10/10), or BUY 25 ($25/30). " +
 "Then schedule this card again."
 : "Couldn't schedule your card. Try again, or text a new photo.");
 }

 // 4. Consume the draft so the token can't be reused. consume_sms_draft
 // just marks consumed_at + postcard_id; postcard-confirmation still
 // resolves the URL after the card actually mails.
 await admin.rpc("consume_sms_draft", { p_token: draftToken, p_postcard_id: postcardId });
 await resetState(phone);

 // Always render our own short format ("Jun 15"). the LLM's `formatted`
 // sometimes includes the year ("June 15, 2026") which feels verbose in SMS.
 const sendDateFmt = sendAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
 const arrivalFmt = arrival.toLocaleDateString("en-US", { month: "short", day: "numeric" });

 return twiml(
 `Scheduled. We'll mail your card to ${recipientName} on ${sendDateFmt} so it arrives ` +
 `around ${arrivalFmt}. Save your link: https://app.themailroom.club/c/${draftToken}`
 );
}

// =============================================================================
// HTTP entry point
// =============================================================================

serve(async (req) => {
 if (req.method !== "POST") return new Response("POST only", { status: 405 });

 const rawBody = await req.text();
 const params = new URLSearchParams(rawBody);
 const formData: Record<string, string> = {};
 for (const [k, v] of params.entries()) formData[k] = v;

 // Signature verify (or bypass via SMS_INBOUND_SKIP_VERIFY=true)
 const reqUrl = new URL(req.url);
 const proto = req.headers.get("x-forwarded-proto") ?? reqUrl.protocol.replace(":", "");
 const host = req.headers.get("host") ?? reqUrl.host;
 const fullUrl = `${proto}://${host}${reqUrl.pathname}${reqUrl.search}`;
 const sig = req.headers.get("X-Twilio-Signature");
 const ok = await verifyTwilioSignature(fullUrl, formData, sig);
 if (!ok) {
 console.error("[sms-inbound] signature mismatch", { url: fullUrl, hasSig: !!sig });
 return new Response("Forbidden", { status: 403 });
 }

 const from = formData["From"] ?? "";
 const body = formData["Body"] ?? "";
 const numMedia = Number(formData["NumMedia"] ?? "0");
 const mediaUrl = formData["MediaUrl0"] ?? null;
 const mediaType = formData["MediaContentType0"] ?? null;

 if (!from) return twiml("Couldn't read your number. Try again?");

 try {
 return await handleInbound({ from, body, numMedia, mediaUrl, mediaType });
 } catch (e) {
 console.error("[sms-inbound] handler threw", e?.message ?? e);
 return twiml("Something broke on our end. Try again in a minute.");
 }
});
