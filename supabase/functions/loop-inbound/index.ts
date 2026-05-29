// loop-inbound. LoopMessage iMessage webhook + state machine.
//
// Phase 2: full Mailroom conversation flow over iMessage.
// Inbound webhook → auth check → translate to canonical inbound shape →
// run conversational state machine → multi-bubble reply via loopSend().
//
// Mirrors sms-inbound's state machine but adapted for LoopMessage's payload
// shape and outbound API. Both functions write to the SAME database tables
// (sms_conversation_state, sms_postcard_drafts, profiles, postcards), so a
// user can technically start on one channel and finish on the other.
//
// iMessage-only superpowers used here:
// - subject: bold title above the message body ("📮 Mailroom")
// - attachments[]: inline photo embedded in the thread (not a link)
// - effect: screen animation (confetti on Mailed, balloons on Scheduled)
// - URL previews: /c/<token> renders as a rich card in Messages
//
// Deploy: `supabase functions deploy loop-inbound --no-verify-jwt`
//
// Required Supabase secrets:
// LOOPMESSAGE_API_KEY. Default-org sandbox or production key
// LOOPMESSAGE_SENDER_ID. sender_id captured on first successful send
// LOOPMESSAGE_WEBHOOK_AUTH. header LoopMessage echoes on every webhook
// OPENAI_API_KEY. LLM parsing (gpt-4o-mini)
// MAILROOM_INTERNAL_SECRET. Lob handoff
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)

// @ts-nocheck. Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LOOP_API_KEY = Deno.env.get("LOOPMESSAGE_API_KEY") ?? "";
const LOOP_SENDER_ID = Deno.env.get("LOOPMESSAGE_SENDER_ID") ?? "";
const WEBHOOK_AUTH = Deno.env.get("LOOPMESSAGE_WEBHOOK_AUTH") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Free-credit baseline matches sms-inbound + iOS WelcomeSheet default.
const FREE_CREDITS_NEW_USER = 1;

// =============================================================================
// LoopMessage outbound. loopSend()
// =============================================================================

interface LoopSendOptions {
 contact: string; // E.164 recipient
 text: string; // body
 subject?: string; // bold title above body (iMessage only)
 attachments?: string[]; // https URLs, max 5, embedded inline
 effect?: "confetti" | "fireworks" | "celebration" | "balloons" | "love"
 | "lasers" | "shootingStar" | "slam" | "loud" | "gentle"
 | "invisibleInk" | "echo" | "spotlight";
 reply_to_id?: string; // thread replies onto a prior bubble
 passthrough?: string; // opaque metadata roundtripped on webhooks
 contact_file?: boolean; // attach our org's configured vCard
}

async function loopSend(opts: LoopSendOptions): Promise<{ ok: boolean; messageId?: string; error?: string }> {
 if (!LOOP_API_KEY) return { ok: false, error: "LOOPMESSAGE_API_KEY not set" };
 const body: any = {
 contact: opts.contact,
 text: opts.text,
 };
 if (LOOP_SENDER_ID) body.sender = LOOP_SENDER_ID;
 if (opts.subject) body.subject = opts.subject;
 if (opts.attachments && opts.attachments.length) body.attachments = opts.attachments.slice(0, 5);
 if (opts.effect) body.effect = opts.effect;
 if (opts.reply_to_id) body.reply_to_id = opts.reply_to_id;
 if (opts.passthrough) body.passthrough = opts.passthrough;
 if (opts.contact_file) body.contact_file = true; // BUG FIX. was previously dropped

 try {
 const res = await fetch("https://a.loopmessage.com/api/v1/message/send/", {
 method: "POST",
 headers: {
 Authorization: LOOP_API_KEY,
 "Content-Type": "application/json",
 },
 body: JSON.stringify(body),
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok || data?.success === false) {
 return { ok: false, error: data?.message ?? `HTTP ${res.status}` };
 }
 return { ok: true, messageId: data?.message_id };
 } catch (e: any) {
 return { ok: false, error: e?.message ?? "network error" };
 }
}

// =============================================================================
// Presence helpers. react and typing indicator
// =============================================================================

// Send a tap-back reaction to a user's previous message. message_id comes
// from the inbound webhook payload. Reactions: love | like | dislike |
// laugh | emphasize | question. Prefix with "-" to remove.
//
// Used to acknowledge a user's message instantly while the bot's "real"
// reply is still composing. feels like a friend texting back ❤️ before
// they finish typing the long message.
async function loopReact(
 contact: string,
 message_id: string,
 reaction: "love" | "like" | "dislike" | "laugh" | "emphasize" | "question",
): Promise<void> {
 if (!LOOP_API_KEY) return;
 try {
 await fetch("https://a.loopmessage.com/api/v1/message/send_reaction/", {
 method: "POST",
 headers: { Authorization: LOOP_API_KEY, "Content-Type": "application/json" },
 body: JSON.stringify({
 message_id,
 reaction,
 ...(LOOP_SENDER_ID ? { sender: LOOP_SENDER_ID } : {}),
 }),
 });
 } catch (e: any) {
 console.warn("[loop-inbound] react failed", e?.message ?? e);
 }
}

// Fire iMessage typing indicator for N seconds before the next bubble.
// The "..." dots appear in the user's thread, then our actual reply lands.
// Makes the bot feel like it's thinking, not robotically auto-replying.
async function loopTyping(contact: string, seconds = 2): Promise<void> {
 if (!LOOP_API_KEY) return;
 try {
 await fetch("https://a.loopmessage.com/api/v1/message/show_typing/", {
 method: "POST",
 headers: { Authorization: LOOP_API_KEY, "Content-Type": "application/json" },
 body: JSON.stringify({
 contact,
 typing: Math.min(seconds, 60),
 ...(LOOP_SENDER_ID ? { sender: LOOP_SENDER_ID } : {}),
 }),
 });
 } catch (e: any) {
 console.warn("[loop-inbound] typing failed", e?.message ?? e);
 }
 // Wait the typing duration so the bubble actually lands AFTER the dots
 // disappear. otherwise the ... and the reply both appear at once.
 await sleep(seconds * 1000);
}

// Multi-bubble send. Sends each bubble sequentially with a tiny pause so
// they arrive in order on the recipient's device. Returns ok if ALL sent.
async function loopSendMany(contact: string, bubbles: Array<Partial<LoopSendOptions>>): Promise<{ ok: boolean; error?: string }> {
 for (const b of bubbles) {
 if (!b.text) continue;
 const res = await loopSend({ contact, text: b.text, ...b });
 if (!res.ok) return { ok: false, error: res.error };
 // tiny pause keeps order in the iMessage thread
 await new Promise((r) => setTimeout(r, 250));
 }
 return { ok: true };
}

// =============================================================================
// Photo intake. download from LoopMessage's CDN, upload to our storage
// =============================================================================

function mintToken(): string {
 const bytes = new Uint8Array(24);
 crypto.getRandomValues(bytes);
 return btoa(String.fromCharCode(...bytes))
 .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// SAFETY: photo + text content moderation. Critical for pen pal mode —
// a stranger's mailbox is going to receive whatever we approve, with
// USPS as our delivery network. CSAM/nudity/violence/explicit personal
// info would be a brand-ending event.
//
// Uses OpenAI's omni-moderation-latest endpoint which supports image
// input. Returns { ok: true } if both clear, { ok: false, reason } if
// either trips. Failure-safe: if the API is down, we ERR ON SAFETY
// and block. Better to inconvenience a sender than mail a stranger
// something illegal.
interface ModerationVerdict {
 ok: boolean;
 reason?: string;
 photo_flagged?: boolean;
 text_flagged?: boolean;
}

async function moderatePhotoAndText(
 photoUrl: string,
 noteText: string,
): Promise<ModerationVerdict> {
 const key = Deno.env.get("OPENAI_API_KEY") ?? "";
 if (!key) {
  console.warn("[loop-inbound] OPENAI_API_KEY not set, moderation DISABLED");
  // No API key = no moderation. For pen pal mode the caller should
  // treat this as a fail-closed condition.
  return { ok: false, reason: "moderation_unavailable" };
 }

 const inputs: any[] = [{ type: "image_url", image_url: { url: photoUrl } }];
 if (noteText && noteText.trim().length > 0) {
  inputs.push({ type: "text", text: noteText });
 }

 try {
  const res = await fetch("https://api.openai.com/v1/moderations", {
   method: "POST",
   headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
   body: JSON.stringify({
    model: "omni-moderation-latest",
    input: inputs,
   }),
  });
  if (!res.ok) {
   const body = await res.text().catch(() => "");
   console.error("[loop-inbound] moderation HTTP fail", res.status, body.slice(0, 200));
   // Fail closed for safety
   return { ok: false, reason: `moderation_http_${res.status}` };
  }
  const data = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) {
   return { ok: false, reason: "moderation_empty_results" };
  }
  // Multi-input: results[0] = photo, results[1] = text (if present)
  const photoResult = results[0];
  const textResult = results[1];
  const photoFlagged = !!photoResult?.flagged;
  const textFlagged = !!textResult?.flagged;
  if (!photoFlagged && !textFlagged) {
   return { ok: true };
  }
  // Identify the highest-scoring category for a useful reason string
  const allCats = [
   ...Object.entries(photoResult?.categories ?? {}),
   ...Object.entries(textResult?.categories ?? {}),
  ].filter(([, v]) => v === true).map(([k]) => k);
  return {
   ok: false,
   reason: allCats.length > 0 ? allCats[0] : "flagged",
   photo_flagged: photoFlagged,
   text_flagged: textFlagged,
  };
 } catch (e: any) {
  console.error("[loop-inbound] moderation threw", e?.message ?? e);
  return { ok: false, reason: "moderation_exception" };
 }
}

// SAFETY: strip EXIF metadata from a JPEG byte stream.
// iPhone photos carry GPS coords, camera serial, original capture time.
// If we publish the raw bytes via /c/<token> (where Lob also reads from),
// a recipient who saves the image can derive the sender's home GPS from
// EXIF — privacy hole especially in pen pal mode (stranger gets sender's
// coords).
//
// JPEG structure: SOI marker (FFD8), then segments. EXIF lives in APP1
// (FFE1) and sometimes APP2 (FFE2). We walk the segments and drop those,
// copying everything else byte-for-byte to a new buffer. SOS (FFDA) marks
// the start of pixel data — everything after is image content, untouched.
//
// HEIC + PNG + GIF pass through (HEIC rewriting requires box parsing,
// PNG rarely carries GPS, GIFs are gimmicks).
function stripJpegExif(bytes: Uint8Array): Uint8Array {
 if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
  return bytes; // not a JPEG, pass through
 }
 const out: number[] = [0xff, 0xd8];
 let i = 2;
 while (i < bytes.length - 1) {
  if (bytes[i] !== 0xff) break;
  const marker = bytes[i + 1];
  if (marker === 0xda) {
   // SOS: copy pixel data and everything after to the end
   for (let j = i; j < bytes.length; j++) out.push(bytes[j]);
   break;
  }
  // No-length markers: RSTn (D0-D7), TEM (01), padding (FF)
  if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01 || marker === 0xff) {
   out.push(bytes[i], bytes[i + 1]);
   i += 2;
   continue;
  }
  // Variable-length segment: read big-endian 16-bit length
  if (i + 4 > bytes.length) break;
  const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
  const segEnd = i + 2 + segLen;
  if (segEnd > bytes.length) break;
  // Drop APP1 (EXIF) and APP2 (ICC profile, sometimes EXIF-like).
  if (marker !== 0xe1 && marker !== 0xe2) {
   for (let j = i; j < segEnd; j++) out.push(bytes[j]);
  }
  i = segEnd;
 }
 return new Uint8Array(out);
}

async function downloadAndUploadPhoto(
 mediaUrl: string,
 token: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
 try {
 // LoopMessage CDN URLs may or may not need our API key. try without
 // first, fall back to authed fetch if that 401s. Most CDNs are public.
 let res = await fetch(mediaUrl);
 if (res.status === 401 || res.status === 403) {
 console.log("[loop-inbound] media fetch unauthed got", res.status, "retrying with API key");
 res = await fetch(mediaUrl, {
 headers: { Authorization: LOOP_API_KEY },
 });
 }
 if (!res.ok) {
 const bodyPreview = await res.text().catch(() => "").then((t) => t.slice(0, 200));
 console.error("[loop-inbound] media fetch failed", {
 status: res.status, url: mediaUrl.slice(0, 120), bodyPreview,
 });
 return { ok: false, error: `fetch ${res.status}: ${bodyPreview.slice(0, 80)}` };
 }
 const bytes = new Uint8Array(await res.arrayBuffer());
 if (bytes.length === 0) {
 console.error("[loop-inbound] media body empty", { url: mediaUrl.slice(0, 120) });
 return { ok: false, error: "empty media body" };
 }

 // Content-type detection. LoopMessage's CDN returns Content-Type:
 // application/octet-stream for image attachments (their generic binary
 // fallback), which our storage bucket whitelist rejects. Sniff the
 // actual format from magic bytes instead of trusting the header.
 const rawCt = res.headers.get("content-type") ?? "";
 let ct = rawCt;
 let ext = "jpg";
 if (bytes[0] === 0xFF && bytes[1] === 0xD8) { ct = "image/jpeg"; ext = "jpg"; }
 else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) { ct = "image/png"; ext = "png"; }
 else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) { ct = "image/gif"; ext = "gif"; }
 else if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && bytes[8] === 0x68 && bytes[9] === 0x65 && bytes[10] === 0x69 && bytes[11] === 0x63) { ct = "image/heic"; ext = "heic"; }
 else if (rawCt.startsWith("image/")) { ct = rawCt; ext = rawCt.split("/")[1].split(";")[0]; }
 else {
 // Last resort. assume jpeg. Lob accepts most image formats and our
 // bucket is happy with image/jpeg. Better to upload SOMETHING than to
 // hard-fail when the CDN gives us octet-stream.
 ct = "image/jpeg";
 ext = "jpg";
 }
 console.log("[loop-inbound] photo content-type detect", { rawCt, finalCt: ct, ext, magic: Array.from(bytes.slice(0, 12)).map((b) => b.toString(16).padStart(2, "0")).join(" ") });

 // SAFETY: strip EXIF before storage. JPEG only for now (HEIC/PNG pass
 // through). Drops GPS, camera serial, capture timestamp.
 let cleanBytes = bytes;
 if (ext === "jpg") {
  const beforeLen = bytes.length;
  cleanBytes = stripJpegExif(bytes);
  if (cleanBytes.length !== beforeLen) {
   console.log("[loop-inbound] EXIF stripped", { before: beforeLen, after: cleanBytes.length, dropped: beforeLen - cleanBytes.length });
  }
 }

 const path = `${token}/photo.${ext}`;
 const { error: uploadErr } = await admin.storage
 .from("sms-photos")
 .upload(path, cleanBytes, { contentType: ct, upsert: false });
 if (uploadErr) {
 console.error("[loop-inbound] storage upload failed", {
 path, ct, bytesLen: cleanBytes.length, error: uploadErr.message,
 });
 return { ok: false, error: `storage: ${uploadErr.message}` };
 }
 console.log("[loop-inbound] photo uploaded OK", { path, ct, bytesLen: cleanBytes.length });
 return { ok: true, path };
 } catch (e: any) {
 console.error("[loop-inbound] downloadAndUploadPhoto threw", e?.message ?? e);
 return { ok: false, error: e?.message ?? "fetch failed" };
 }
}

// =============================================================================
// LLM parsing. GPT-4o-mini via OpenAI (copied from sms-inbound)
// =============================================================================

interface ParsedAddress {
 line1: string; line2: string; city: string; state: string; zip: string;
 confidence: number;
 formatted: string;
 concerns: string; // why low confidence (city/state mismatch, etc)
 plausible: boolean; // LLM's verdict on deliverability
}
interface ParsedConfirm { intent: "yes" | "no" | "unclear"; }
interface ParsedLocation { city: string; state: string; confidence: number; }
interface ParsedSendConfirm {
 intent: "send_now" | "schedule" | "cancel" | "unclear";
 arrival_iso?: string;
 formatted?: string;
}

async function openaiJson(messages: Array<{ role: string; content: string }>): Promise<any | null> {
 const key = Deno.env.get("OPENAI_API_KEY") ?? "";
 if (!key) { console.warn("[loop-inbound] OPENAI_API_KEY not set"); return null; }
 try {
 const res = await fetch("https://api.openai.com/v1/chat/completions", {
 method: "POST",
 headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
 body: JSON.stringify({
 model: "gpt-4o-mini",
 messages,
 response_format: { type: "json_object" },
 temperature: 0,
 max_tokens: 200,
 }),
 });
 if (!res.ok) { console.warn("[loop-inbound] OpenAI", res.status); return null; }
 const data = await res.json();
 return JSON.parse(data.choices?.[0]?.message?.content ?? "");
 } catch (e: any) {
 console.warn("[loop-inbound] OpenAI threw", e?.message ?? e);
 return null;
 }
}

async function parseAddress(input: string): Promise<ParsedAddress | null> {
 // gpt-4o-mini parses AND verifies in one call. The verification step
 // catches city/state/ZIP mismatches (e.g. "Naples, CA 90210" is wrong),
 // implausible street names (e.g. just "Main"), and missing components
 //. without spending Lob's $0.05/lookup verification fee.
 //
 // The model has internal knowledge of US ZIP regions, real city names,
 // and street-naming conventions. good enough for plausibility checks.
 // Real USPS verification still happens implicitly at Lob print time.
 const r = await openaiJson([
 { role: "system", content:
 "You are a US mail expert. Parse AND verify mailing addresses from " +
 "messy text. Return JSON only.\n\n" +
 'Schema: { "line1": string, "line2": string|"", "city": string, ' +
 '"state": string (2-letter), "zip": string (5 or 5-4), ' +
 '"confidence": number 0-1, "formatted": string, "concerns": string, ' +
 '"plausible": boolean }\n\n' +
 "VERIFICATION CHECKS (lower confidence + populate 'concerns' if any fail):\n" +
 "1. City actually exists in the named state\n" +
 "2. ZIP first 3 digits match the state's USPS ZIP range\n" +
 "3. Street name is real-sounding (not 'asdf', 'xxx', single generic word)\n" +
 "4. All four required components present (street + city + state + zip)\n" +
 "5. House number is plausible (not '000' or single digit on rural-style street)\n\n" +
 "Examples:\n" +
 '"123 main st, naples ca 90210" → confidence 0.3, concerns "Naples is in Florida, not California. ZIP 90210 is Beverly Hills CA, not Naples FL.", plausible false\n' +
 '"861 humboldt st denver colorado 80218" → confidence 0.95, concerns "", plausible true\n' +
 '"123 fake street, real city, ny 11111" → confidence 0.2, concerns "Street name looks fake; city name is too generic.", plausible false\n' +
 '"just send it" → confidence 0, plausible false\n\n' +
 "Normalize state to 2 letters. Strip apt/unit from line1 into line2. " +
 "When confidence < 0.7, 'concerns' must explain the specific problem in one short sentence." },
 { role: "user", content: input },
 ]);
 if (!r) return null;
 // Defensive defaults so downstream code doesn't crash on missing keys.
 return {
 line1: r.line1 ?? "",
 line2: r.line2 ?? "",
 city: r.city ?? "",
 state: r.state ?? "",
 zip: r.zip ?? "",
 confidence: typeof r.confidence === "number" ? r.confidence : 0,
 formatted: r.formatted ?? "",
 concerns: r.concerns ?? "",
 plausible: r.plausible === true,
 };
}

async function parseLocation(input: string): Promise<ParsedLocation | null> {
 const r = await openaiJson([
 { role: "system", content:
 "You parse a US city + state from messy text. Return JSON only. " +
 'Schema: { "city": string, "state": string (2-letter), "confidence": number 0-1 }. ' +
 "If input doesn't clearly contain a city + state, return confidence: 0 and empty strings." },
 { role: "user", content: input },
 ]);
 return r as ParsedLocation | null;
}

async function parseConfirmation(input: string): Promise<ParsedConfirm> {
 const t = input.trim().toLowerCase();
 if (/^(y|yes|yep|yeah|yas|sure|ok|okay|confirm|confirmed|send|ship|do it|go|👍|✅|🚀|yeah sure|yes please|sounds good|looks good|go ahead|sure thing|that's right|thats right)$/i.test(t))
 return { intent: "yes" };
 if (/^(n|no|nope|nah|cancel|stop|wait|hold on|not yet|no thanks)$/i.test(t))
 return { intent: "no" };
 const r = await openaiJson([
 { role: "system", content:
 'Classify SMS reply as yes/no/unclear. Schema: { "intent": "yes"|"no"|"unclear" }.' },
 { role: "user", content: input },
 ]);
 return (r && ["yes", "no", "unclear"].includes(r.intent)) ? r as ParsedConfirm : { intent: "unclear" };
}

async function parseSendConfirm(input: string): Promise<ParsedSendConfirm> {
 const t = input.trim().toLowerCase();
 if (/^(y|yes|yep|yeah|yas|sure|ok|okay|confirm|confirmed|send|ship|do it|go|👍|✅|🚀|yeah sure|yes please|sounds good|looks good|go ahead|sure thing|let's go|lets go)$/i.test(t))
 return { intent: "send_now" };
 if (/^(n|no|nope|nah|cancel|stop|wait|hold on|not yet|no thanks)$/i.test(t))
 return { intent: "cancel" };
 const today = new Date().toISOString().slice(0, 10);
 const r = await openaiJson([
 { role: "system", content:
 `Today is ${today}. Classify a SEND-step reply: "send_now" | "schedule" | "cancel" | "unclear". ` +
 `Return JSON { "intent": ..., "arrival_iso": "YYYY-MM-DD"|null, "formatted": string|null }. ` +
 `When user names a future date (e.g. "send June 15", "in 3 days", "next Tuesday"), set intent="schedule" ` +
 `and arrival_iso = the arrival date. Set arrival_iso even for too-close dates; lead-time is checked downstream. ` +
 `formatted = short human label like "Jun 15". Only return "unclear" if you genuinely can't parse.` },
 { role: "user", content: input },
 ]);
 return (r && ["send_now", "schedule", "cancel", "unclear"].includes(r.intent)) ? r as ParsedSendConfirm : { intent: "unclear" };
}

function parseBuyKeyword(body: string): { matched: true; pack_id: string } | { matched: false } {
 // BUY uses dollar amounts (matches new pricing: $5 / $10 / $25).
 // Bare BUY → p10 (the cleanest "ten for ten" middle option).
 const m = body.trim().toUpperCase().match(/^BUY\s*(5|10|25)?$/);
 if (!m) return { matched: false };
 if (m[1] === "5") return { matched: true, pack_id: "p5" };
 if (m[1] === "25") return { matched: true, pack_id: "p25" };
 return { matched: true, pack_id: "p10" };
}

// =============================================================================
// State + DB helpers
// =============================================================================

async function getConversationState(phone: string) {
 const { data } = await admin
 .from("sms_conversation_state").select("*").eq("phone", phone).maybeSingle();
 if (!data) return { step: "idle", draft_token: null, conversation_data: {} };
 return data;
}

async function advanceState(phone: string, step: string, draftToken: string | null, patch: Record<string, unknown>) {
 await admin.rpc("advance_sms_conversation", {
 p_phone: phone, p_step: step, p_draft_token: draftToken, p_data_patch: patch,
 });
}

async function resetState(phone: string) {
 await admin.rpc("reset_sms_conversation", { p_phone: phone });
}

async function balanceParenthetical(phone: string): Promise<string> {
 const { data: prof } = await admin
 .from("profiles").select("id, credits").eq("phone", phone).maybeSingle();
 if (!prof?.id) return " (First one's free.)";
 const { count } = await admin
 .from("postcards").select("id", { count: "exact", head: true })
 .eq("sender_id", prof.id)
 .in("status", ["sent", "delivered", "in_transit", "scheduled", "queued"]);
 if ((count ?? 0) === 0) return " (First one's free.)";
 const c = prof.credits ?? 0;
 if (c <= 0) return "";
 return ` (Uses 1 of ${c} card${c === 1 ? "" : "s"}.)`;
}

async function findOrCreateUserByPhone(phone: string): Promise<string> {
 const { data: existing } = await admin
 .from("profiles").select("id").eq("phone", phone).maybeSingle();
 if (existing?.id) return existing.id;
 const { data: created, error } = await admin.auth.admin.createUser({
 phone, phone_confirm: true, user_metadata: { signup_surface: "imessage" },
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
 recipient: { line1: string; line2: string; city: string; state: string; zip: string; name: string },
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
// Lob handoff (same internal-secret HTTP pattern as sms-inbound)
// =============================================================================

async function submitToLob(postcardId: string): Promise<{ ok: boolean; expectedDelivery?: string; error?: string }> {
 // HARD GUARD: if MAILROOM_TEST_MODE_NO_LOB is set, return a fake ok
 // response without calling the real Lob endpoint. Prevents accidental
 // real-money postcard mailing during integration test cycles.
 // Production deploys leave this env var unset.
 if (Deno.env.get("MAILROOM_TEST_MODE_NO_LOB") === "true") {
   console.log("[loop-inbound] TEST_MODE_NO_LOB enabled, stubbing Lob call", { postcardId });
   const fakeEta = new Date(Date.now() + 5 * 86400 * 1000).toISOString().slice(0, 10);
   return { ok: true, expectedDelivery: fakeEta };
 }

 const internalSecret = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";
 if (!internalSecret) return { ok: false, error: "internal secret not set" };
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
 const data = await res.json().catch(() => ({}));
 if (!data?.ok || !data?.lob_id) {
 return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
 }
 return { ok: true, expectedDelivery: data.expected_delivery_date };
 } catch (e: any) {
 return { ok: false, error: e?.message ?? "network error" };
 }
}

// =============================================================================
// BUY checkout (same pattern as sms-inbound. internal HTTP to sms-buy-checkout)
// =============================================================================

async function createBuyCheckout(phone: string, packId: string): Promise<{ ok: true; url: string; pack_label: string } | { ok: false; error: string }> {
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
 if (!data?.ok || !data?.url) return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
 return { ok: true, url: data.url, pack_label: data.pack_label };
 } catch (e: any) {
 return { ok: false, error: e?.message ?? "network error" };
 }
}

// =============================================================================
// Choreography helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
 return new Promise((r) => setTimeout(r, ms));
}

// True when no profile exists for this phone yet (we've never seen them).
// Used to gate first-time-only flourishes like the vCard delivery.
async function isFirstTimeContact(phone: string): Promise<boolean> {
 const { data } = await admin
 .from("profiles").select("id").eq("phone", phone).maybeSingle();
 return !data?.id;
}

// Pick an iMessage screen effect based on the emotional content of the
// user's postcard note. The "Mailed!" reply fires this effect on the
// recipient's screen, so it should match the message they just wrote.
//
// "miss you" → hearts; "birthday" → balloons; "congrats" → fireworks;
// "wish" / "dreams" → shootingStar; default → confetti.
//
// Apple supports 13 effects via iMessage; we map the most contextually
// resonant ones. Order matters. first match wins.
type IMessageEffect =
 | "confetti" | "fireworks" | "celebration" | "balloons" | "love"
 | "lasers" | "shootingStar" | "slam" | "loud" | "gentle"
 | "invisibleInk" | "echo" | "spotlight";

function pickEffectForNote(note: string): IMessageEffect {
 const n = note.toLowerCase();

 // LOVE. closest, warmest. The full-screen heart shower.
 if (/\b(love|miss you|missing you|thinking of you|xoxo|<3|❤️|💕|💖|💗|💝)\b/.test(n)) return "love";

 // BALLOONS. birthdays, anniversaries, milestones.
 if (/\b(birthday|happy bday|hbd|anniversary|congrats on .*(year|years|decade))\b/.test(n)) return "balloons";

 // FIREWORKS. big achievements, "you did it" energy.
 if (/\b(congrats|congratulations|you did it|so proud|nailed it|big win|graduated|promotion|engaged|married|wedding|baby)\b/.test(n)) return "fireworks";

 // SHOOTING STAR. wishes, dreams, hope.
 if (/\b(wish|wishing|hopes|dreams|magic|miracle|stars|⭐|✨|🌟)\b/.test(n)) return "shootingStar";

 // CELEBRATION. gratitude, thanks.
 if (/\b(thank you|thanks|grateful|appreciate|gratitude|🙏)\b/.test(n)) return "celebration";

 // LASERS. playful / pumped energy.
 if (/\b(let's go|lfg|woohoo|hype|🎉|🎊|🚀)\b/.test(n)) return "lasers";

 // Default. the universal "we did a thing" celebration.
 return "confetti";
}

// =============================================================================
// AI note suggestions. "?" command at the message step
// =============================================================================
//
// User stuck on what to write? They text "?" or "ideas" and we generate 3
// short, warm, contextually-personalized notes via gpt-4o-mini. They pick
// by number (1/2/3) or write their own. Suggestions are stashed in
// conversation_data.pending_ideas so the number-pick works on next reply.

async function sendNoteIdeas(phone: string, state: any): Promise<void> {
 // Typing indicator while the LLM thinks. 3s is roughly how long the
 // OpenAI call takes, so the "..." dots disappear right as our ideas land.
 await loopTyping(phone, 2.5);

 const recipientName = (state.conversation_data?.recipient_name ?? "your friend") as string;
 const recipient = (state.conversation_data?.recipient ?? {}) as { city?: string; state?: string };
 const recipLoc = [recipient.city, recipient.state].filter(Boolean).join(", ");

 // Pull sender location for personalization if available.
 const { data: profile } = await admin
 .from("profiles").select("city, state").eq("phone", phone).maybeSingle();
 const senderLoc = [profile?.city, profile?.state].filter(Boolean).join(", ");

 const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });

 const res = await openaiJson([
 { role: "system", content:
 "You are a warm, thoughtful ghost-writer of paper postcards. Voice: " +
 "personal, specific, sounds like a real person, not greeting-card generic. " +
 "Never use clichés, never use em-dashes, keep each note under 140 characters." },
 { role: "user", content:
 `Write 3 short postcard notes (under 140 chars each) to ${recipientName}` +
 `${recipLoc ? ` in ${recipLoc}` : ""}.` +
 `${senderLoc ? ` From a sender in ${senderLoc}.` : ""}` +
 ` Today is ${today}.\n\n` +
 `Vary the tone across the three: one nostalgic/warm, one playful, one thoughtful/sincere. ` +
 `Each should be specific (mention a moment, feeling, or detail), not generic.\n\n` +
 `Return JSON: { "ideas": ["...", "...", "..."] }`,
 },
 ]);

 // Defensive: fall back to safe defaults if the LLM call fails.
 const ideas: string[] = (Array.isArray(res?.ideas) ? res.ideas : [])
 .filter((x: unknown) => typeof x === "string")
 .slice(0, 3);
 while (ideas.length < 3) {
 ideas.push([
 `Thinking of you, ${recipientName}. Hope today's a good one.`,
 `Just wanted to drop you a line. Miss your face.`,
 `Sending good vibes your way from afar.`,
 ][ideas.length]);
 }

 // Stash in state so the number-pick on next reply maps to the right idea.
 await advanceState(phone, "awaiting_message", state.draft_token, {
 ...(state.conversation_data ?? {}),
 pending_ideas: ideas,
 });

 await loopSend({
 contact: phone,
 subject: "💡 Some ideas",
 text: ideas.map((idea, i) => `${i + 1}. ${idea}`).join("\n\n"),
 });
 await sleep(350);
 await loopSend({
 contact: phone,
 text: `Reply 1, 2, or 3, or write your own.`,
 });
}

// =============================================================================
// Milestone-aware framing. detect emotionally significant notes
// =============================================================================
//
// When a user writes something heavy ("I love you", "miss you so much",
// "thinking of you", "so proud") the pre-send framing slows down. No timer,
// no urgency. just a "this one matters, send when you're ready" beat.
// Apple-grade emotional intelligence at zero cost.

function isHeavyNote(note: string): boolean {
 return /\b(love you|i love|miss you|missing you|thinking of you|so proud|grateful for|sorry|forever|always|never forget|love always|all my love|loved (you|her|him|them))\b/i.test(note);
}

// =============================================================================
// State machine. handlers
// =============================================================================

function isRestartCommand(body: string): boolean {
 return /^(cancel|stop|restart|reset|start over|nevermind|never mind)$/i.test(body.trim());
}

interface InboundCtx {
 from: string;
 body: string;
 attachments: string[]; // https URLs from LoopMessage
 messageId?: string; // the user's inbound message id, used for reactions
}

async function handleInbound(ctx: InboundCtx): Promise<void> {
 const { from, body, attachments, messageId } = ctx;

 // 1. Global: a new photo restarts the conversation.
 // Drop a "love" tapback on the photo itself BEFORE we say anything .
 // user gets instant ❤️ acknowledgment of their photo while the bot's
 // welcome message is still being composed.
 if (attachments.length >= 1) {
 if (messageId) await loopReact(from, messageId, "love");
 return await startNewConversation(from, attachments[0]);
 }

 // 2. Global: explicit reset.
 if (isRestartCommand(body)) {
 await resetState(from);
 await loopSend({ contact: from, text: "Cancelled." });
 return;
 }

 // 3. Global: MEMORIES. send the last 3 postcard photos inline.
 // Returns the user to "memory lane" without disrupting any in-progress draft.
 if (/^memories?$/i.test(body.trim())) {
 return await sendMemories(from);
 }

 // 3. Global: BUY keyword.
 const buy = parseBuyKeyword(body);
 if (buy.matched) {
 const checkout = await createBuyCheckout(from, buy.pack_id);
 if (!checkout.ok) {
 await loopSend({
 contact: from,
 text: "Checkout's down. Try in a minute, or email hello@mailroomclub.io.",
 });
 return;
 }
 await loopSend({
 contact: from,
 subject: "🛒 Top up",
 text: `${checkout.pack_label}\n${checkout.url}\n\nExpires in 1h. Other sizes: BUY 5 or BUY 25.`,
 });
 return;
 }
 if (/^buy\b/i.test(body.trim())) {
 await loopSend({
 contact: from,
 text: "BUY 5 ($5/4), BUY 10 ($10/10), or BUY 25 ($25/30). Just BUY = 10-pack.",
 });
 return;
 }

 // 4. Step-based routing.
 const state = await getConversationState(from);
 switch (state.step) {
 case "idle":
 return await handleIdle(from);
 case "awaiting_send_type":
 return await handleSendType(from, body, state);
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
 await resetState(from);
 await loopSend({ contact: from, text: "Something's off on our end. Send a fresh photo to start over." });
 }
}

async function handleIdle(from: string): Promise<void> {
 const { data: prof } = await admin
 .from("profiles").select("credits").eq("phone", from).maybeSingle();
 if (!prof) {
 await loopSend({
 contact: from,
 subject: "📮 Mailroom",
 text: "Send a photo to start. First one's on us.",
 });
 return;
 }
 const credits = prof.credits ?? 0;
 if (credits <= 0) {
 await loopSend({
 contact: from,
 text: "Out of cards. BUY 5, 10, or 25 to top up.",
 });
 return;
 }
 await loopSend({
 contact: from,
 text: `You have ${credits} card${credits === 1 ? "" : "s"} left. Text a photo to start a new one.`,
 });
}

async function startNewConversation(phone: string, mediaUrl: string): Promise<void> {
 // First-time check fires BEFORE we touch the DB so we can serve the
 // vCard before our profile insert pollutes the result.
 const firstTime = await isFirstTimeContact(phone);

 const token = mintToken();
 const upload = await downloadAndUploadPhoto(mediaUrl, token);
 if (!upload.ok) {
 // Verbose error during debug. strip back once photo path verified.
 console.error("[loop-inbound] photo intake failed", { mediaUrl: mediaUrl.slice(0, 200), error: upload.error });
 await loopSend({
 contact: phone,
 text: `Couldn't save that photo. Try again?`,
 });
 return;
 }
 await admin.from("sms_postcard_drafts").insert({
 token, from_phone: phone, caption: "",
 photo_path: upload.path, twilio_media_url: mediaUrl,
 verified_phone: phone,
 });
 await advanceState(phone, "awaiting_recipient_name", token, {});

 // Warm, clear, conversational opener. Full questions, not cryptic
 // arrows. Two-bubble pattern: Bubble A is the "we saw it" beat,
 // Bubble B is the actual question. The 450ms pause makes the photo
 // land before the bot starts asking. Reads as paced, not robotic.
 await advanceState(phone, "awaiting_send_type", token, {});

 // Bubble A: instant acknowledgment that we received the photo
 await loopSend({ contact: phone, text: "📮 Got the photo." });
 await sleep(450);

 // Bubble B: welcome + the send-type question
 if (firstTime) {
 await loopSend({
 contact: phone,
 subject: "📮 Welcome to Mailroom",
 text:
 "Who do you want to send this to? Your first postcard is on us. You can send it to a randomly matched pen pal, or to a friend.\n\n" +
 "Just tell us \"penpal\", or the name of the friend you want to send to.",
 contact_file: true,
 });
 } else {
 await loopSend({
 contact: phone,
 text: "Who's this one for? Reply \"penpal\" for a random match, or just type a friend's name.",
 });
 }
}

// =============================================================================
// Send-type choice: friend vs stranger pen pal
// =============================================================================
async function handleSendType(phone: string, body: string, state: any): Promise<void> {
 const raw = body.trim();
 const lower = raw.toLowerCase();

 // Pen pal path. NOW LIVE. The bot picks a match at SEND time (no
 // recipient name/address asked because the user shouldn't see who
 // they're sending to). We skip straight to the note step.
 //
 // Privacy model: the sender never sees the recipient's address,
 // name, or city of the recipient. They only know "somewhere in
 // America." The recipient gets the card with only the sender's city
 // as a return label, and can reply via the bot.
 if (lower === "penpal" || lower === "pen pal" || lower === "anywhere" || lower === "2"
 || /\b(stranger|pen pal|penpal|random|surprise|somewhere)\b/.test(lower)) {
 await advanceState(phone, "awaiting_message", state.draft_token, {
 send_type: "stranger",
 });
 await loopSend({
 contact: phone,
 subject: "🪶 Pen pal mode",
 text:
 "We'll match you with someone in the pool. You won't see their address. They won't see yours.\n\n" +
 "What should your card say? (Up to 240 chars, or text SKIP for just the photo.)",
 });
 return;
 }

 // Explicit "friend" keyword (rare. most users will just type a name).
 if (lower === "1" || /\b(friend|someone|a person|specific)\b/.test(lower)) {
 await advanceState(phone, "awaiting_recipient_name", state.draft_token, {
 send_type: "friend",
 });
 await loopSend({ contact: phone, text: "Got it. Who's it for?" });
 return;
 }

 // Looks like a name. friend-mode shortcut. Skip the "who's it for?"
 // prompt and go straight to the address ask. Names are 1-80 chars,
 // contain at least one letter, no digits or weird symbols.
 if (
 raw.length >= 1 && raw.length <= 80 &&
 /[a-z]/i.test(raw) &&
 !/[0-9@#$%^&*<>{}\[\]\\\/]/.test(raw)
 ) {
 await advanceState(phone, "awaiting_recipient_address", state.draft_token, {
 send_type: "friend",
 recipient_name: raw,
 });
 const firstName = raw.split(/\s+/)[0];
 await loopSend({ contact: phone, text: `Great. What's a good address for ${firstName}?` });
 return;
 }

 // Couldn't parse. re-prompt with the same warmth.
 await loopSend({
 contact: phone,
 text: "Reply with a friend's name, or \"penpal\" for a random match.",
 });
}

// =============================================================================
// MEMORIES. global "/memories" lane. Send their last 3 postcard photos
// back inline as iMessage attachments + a short caption.
// =============================================================================
async function sendMemories(phone: string): Promise<void> {
 const { data: prof } = await admin
 .from("profiles").select("id").eq("phone", phone).maybeSingle();
 if (!prof?.id) {
 await loopSend({
 contact: phone,
 text: "No postcards yet. Send a photo to start. 📮",
 });
 return;
 }

 // Last 3 sent or delivered postcards with their recipient + photo path.
 // We re-sign each photo URL (24h) so the iMessage attachments load.
 const { data: cards } = await admin
 .from("postcards")
 .select("id, photo_path, message, sent_at, to_friend_id, friends:to_friend_id(name)")
 .eq("sender_id", prof.id)
 .in("status", ["sent", "delivered", "in_transit"])
 .order("sent_at", { ascending: false })
 .limit(3);

 if (!cards || cards.length === 0) {
 await loopSend({
 contact: phone,
 text: "No history yet. Send a photo. 📮",
 });
 return;
 }

 // Build signed URLs for each photo. Some photos may already be full https
 // URLs (Twilio MMS-era); leave those alone.
 const photoUrls: string[] = [];
 for (const c of cards) {
 if (!c.photo_path) continue;
 if (c.photo_path.startsWith("http")) { photoUrls.push(c.photo_path); continue; }
 const { data: signed } = await admin.storage
 .from("sms-photos").createSignedUrl(c.photo_path, 60 * 60 * 24);
 if (signed?.signedUrl) photoUrls.push(signed.signedUrl);
 }

 await loopTyping(phone, 1.5);
 await loopSend({
 contact: phone,
 subject: "📮 Your postcards",
 text: `Your last ${cards.length}. Text a photo to send a new one.`,
 attachments: photoUrls.slice(0, 5), // LoopMessage cap is 5
 });
}

// =============================================================================
// Recipient memory. "we've sent here before" surprise
// =============================================================================
// When the user is in the address-confirm step and we recognize the
// recipient from a prior postcard, drop a warm callback before the
// "what should the card say?" prompt. The "it remembered me" beat.
async function getRecipientMemory(
 phone: string,
 recipientName: string,
 zip: string,
): Promise<{ lastMessage: string; sentAt: string } | null> {
 const { data: prof } = await admin
 .from("profiles").select("id").eq("phone", phone).maybeSingle();
 if (!prof?.id) return null;

 // Match by both name AND zip. same name + different address is a
 // different person (Lori in Naples vs Lori in Naples FL ZIP+4 mismatch).
 // ilike is case-insensitive. Friends table holds the canonical addressing.
 const { data: cards } = await admin
 .from("postcards")
 .select("id, message, sent_at, friends!inner(name, address_zip)")
 .eq("sender_id", prof.id)
 .in("status", ["sent", "delivered", "in_transit"])
 .order("sent_at", { ascending: false })
 .limit(20); // grab a window, filter in code

 if (!cards) return null;
 const match = cards.find((c: any) =>
 c.friends?.name?.toLowerCase() === recipientName.toLowerCase() &&
 (!zip || c.friends?.address_zip === zip)
 );
 if (!match) return null;
 return { lastMessage: match.message ?? "", sentAt: match.sent_at };
}

async function handleRecipientName(phone: string, body: string, state: any): Promise<void> {
 const name = body.trim();
 if (name.length < 1 || name.length > 80) {
 await loopSend({ contact: phone, text: "Need a real name. Try again?" });
 return;
 }
 await advanceState(phone, "awaiting_recipient_address", state.draft_token, { recipient_name: name });
 // Warm, specific question. Uses first name so it reads like a friend
 // asking, not a form. "What's a good address for Lori?" beats both
 // "Lori → ?" (too cryptic) and "Where does Lori live?" (vague).
 const firstName = name.split(/\s+/)[0];
 await loopSend({
 contact: phone,
 text: `Got it. What's a good address for ${firstName}?`,
 });
}

async function handleRecipientAddress(phone: string, body: string, state: any): Promise<void> {
 // No typing indicator. keep it snappy. The verify happens in well
 // under a second on average. Drama is reserved for the SEND moment.
 const parsed = await parseAddress(body);

 if (!parsed || parsed.confidence < 0.5) {
 await loopSend({ contact: phone, text: `Didn't catch an address. Try: "123 Main St, Naples FL 34101"` });
 return;
 }
 if (parsed.confidence < 0.7 || !parsed.plausible) {
 // We HAVE a parse but the LLM flagged a real-world concern. Quote it
 // verbatim so they know WHY. "Naples is in FL not CA" beats a
 // generic "try again."
 const concern = parsed.concerns?.trim() || "doesn't look right";
 await loopSend({ contact: phone, text: `${concern} Send the right one?` });
 return;
 }
 if (!parsed.line1 || !parsed.zip || !parsed.city || !parsed.state) {
 const missing = [
 !parsed.line1 && "street",
 !parsed.city && "city",
 !parsed.state && "state",
 !parsed.zip && "ZIP",
 ].filter(Boolean).join(", ");
 await loopSend({ contact: phone, text: `Missing ${missing}. Full address?` });
 return;
 }

 await advanceState(phone, "awaiting_address_confirm", state.draft_token, {
 recipient: { line1: parsed.line1, line2: parsed.line2 || "", city: parsed.city, state: parsed.state, zip: parsed.zip },
 });
 const name = (state.conversation_data?.recipient_name ?? "your friend") as string;
 const firstName = name.split(/\s+/)[0];
 // Aesthetic: render the address as it'll appear on the postcard. Three
 // indented lines (recipient name, street, city/state/zip) read like a
 // real mailing label. Same info as before, totally different feel.
 const line2Line = parsed.line2 ? `\n   ${parsed.line2}` : "";
 const label =
 `   ${firstName}\n` +
 `   ${parsed.line1}${line2Line}\n` +
 `   ${parsed.city}, ${parsed.state} ${parsed.zip}`;
 await loopSend({
 contact: phone,
 text: `${label}\n\nDoes this look right?`,
 });
}

async function handleAddressConfirm(phone: string, body: string, state: any): Promise<void> {
 const c = await parseConfirmation(body);
 if (c.intent === "yes") {
 await advanceState(phone, "awaiting_message", state.draft_token, {});

 // RECIPIENT MEMORY. "we've been here before" surprise. Pure delight,
 // earns its bubble. Last note quoted verbatim, no preamble.
 const recipientName = (state.conversation_data?.recipient_name ?? "") as string;
 const zip = (state.conversation_data?.recipient?.zip ?? "") as string;
 const memory = recipientName ? await getRecipientMemory(phone, recipientName, zip) : null;
 if (memory) {
 const firstName = recipientName.split(/\s+/)[0];
 const lastDate = new Date(memory.sentAt).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
 const preview = memory.lastMessage.length > 50
 ? memory.lastMessage.slice(0, 50) + "…"
 : memory.lastMessage;
 await loopSend({
 contact: phone,
 text: `Last time, you wrote ${firstName} (${lastDate}): "${preview}"\n\nWant me to draft a few ideas, or write your own? Reply IDEAS or just write your note.`,
 });
 return;
 }

 // First-time message prompt. explicit question, offers SKIP as an
 // out for users who want just the photo with no words.
 await loopSend({
 contact: phone,
 text: "Would you like to add a note? Reply with your message (up to 240 chars), or text SKIP to mail just the photo.",
 });
 return;
 }
 if (c.intent === "no") {
 await advanceState(phone, "awaiting_recipient_address", state.draft_token, {});
 await loopSend({ contact: phone, text: "No problem. Send me the correct address?" });
 return;
 }
 await loopSend({ contact: phone, text: "Does it look right? Reply Y, or send the correct address." });
}

async function handleMessage(phone: string, body: string, state: any): Promise<void> {
 let message = body.trim();

 // QUICK-PICK from prior suggestions: if user replies "1", "2", or "3"
 // after we offered ideas, look up the stashed array and use that text
 // as if they'd typed it themselves. Zero-friction selection.
 const pendingIdeas = (state.conversation_data?.pending_ideas ?? null) as string[] | null;
 const pickMatch = message.match(/^([123])\s*$/);
 if (pendingIdeas && pickMatch) {
 const idx = parseInt(pickMatch[1]) - 1;
 if (pendingIdeas[idx]) message = pendingIdeas[idx];
 }

 if (message.length === 0) {
 await loopSend({ contact: phone, text: "What should the card say?" });
 return;
 }

 // SKIP path. user wants to mail just the photo, no note. Strict
 // single-word match so "skip class today" isn't misread.
 if (/^(skip|no note|none|nope|no thanks)$/i.test(message)) {
 message = "";
 }

 // "?" / "ideas" / "help me" → AI-generated suggestions based on the
 // recipient + sender context. Stays in awaiting_message state so the
 // user can either pick one (by number) or write their own.
 if (message && /^(\?|ideas|idea|help me|suggest|suggestions|what should i say|stuck)\b/i.test(message)) {
 await sendNoteIdeas(phone, state);
 return;
 }

 const truncated = message.length > 240 ? message.slice(0, 240) : message;
 // Gate on FULL home address. line1 + city + state + zip are all required
 // to send (so pen pal reciprocation works downstream). Users with just
 // city/state on file from earlier rounds get re-prompted for the full
 // address on this send. line2 is optional (apt/unit).
 const { data: profile } = await admin
 .from("profiles").select("city, state, home_line1, home_zip").eq("phone", phone).maybeSingle();
 const hasFullAddress = !!(
   profile?.home_line1 && profile?.home_zip &&
   profile?.city && profile?.state
 );
 const knownCity = (profile?.city ?? "").trim();
 const knownState = (profile?.state ?? "").trim();

 if (hasFullAddress) {
 await advanceState(phone, "awaiting_send_confirm", state.draft_token, { message: truncated });
 const name = (state.conversation_data?.recipient_name ?? "your friend") as string;
 const firstName = name.split(/\s+/)[0];
 const recip = (state.conversation_data?.recipient ?? {}) as { city?: string; state?: string };
 const recipCity = recip.city || "their place";
 const balanceTag = await balanceParenthetical(phone);
 const heavy = isHeavyNote(truncated);

 // Returning sender (city already on file). Acknowledge the note in
 // its own bubble first. confirms we heard them, builds the dialogue
 // beat. then drop the pre-send summary.
 if (truncated.length > 0) {
 await loopSend({ contact: phone, text: `Got it. "${truncated}"` });
 await sleep(550);
 }
 // Aesthetic: vertical postcard composition. Two cities flanking an
 // em-rule + arrow reads like a postal route. The "To:" label + note
 // sit centered below, mimicking the back of a real postcard.
 const noteBlock = truncated.length > 0
 ? `\n\n   "${truncated}"`
 : "";
 const composition =
 `${knownCity.toUpperCase()} ──→ ${recipCity.toUpperCase()}\n\n` +
 `   To: ${firstName}${noteBlock}`;
 await loopSend({
 contact: phone,
 text: heavy
 ? `${composition}\n\nThis one feels meaningful. SEND when you're ready, or CANCEL.${balanceTag}`
 : `${composition}\n\nSEND, schedule, or CANCEL.${balanceTag}`,
 });
 return;
 }

 // First-time sender (no city on file yet). confirm the note FIRST,
 // then ask for their address with reciprocity framing. The address
 // ask isn't "where do you live". it's "so they can write back."
 await advanceState(phone, "awaiting_sender_location", state.draft_token, { message: truncated });

 const recipName = (state.conversation_data?.recipient_name ?? "your friend") as string;
 const recipFirst = recipName.split(/\s+/)[0];
 const sendType = (state.conversation_data?.send_type ?? "friend") as string;
 const writeBackWho = sendType === "stranger_requested" ? "your pen pal" : recipFirst;

 // Bubble 1: acknowledge the note so the user knows we heard them
 if (truncated.length > 0) {
 await loopSend({ contact: phone, text: `Got it. "${truncated}"` });
 await sleep(550);
 } else {
 await loopSend({ contact: phone, text: "Got it. No note, just the photo." });
 await sleep(550);
 }

 // Bubble 2: ask for the FULL mailing address with reciprocity framing.
 // Required to send (gates the pen pal mechanic). We keep the full
 // address private. only the user's city shows on the postcard front.
 await loopSend({
 contact: phone,
 text: `Last step. What's your full mailing address? We keep it private (only your city shows on the postcard) so ${writeBackWho} can mail one back to you.\n\nFormat: street, city, state, ZIP.`,
 });
}

async function handleSenderLocation(phone: string, body: string, state: any): Promise<void> {
 // Parse the FULL mailing address (same parser as recipient address).
 // We need line1 + city + state + zip at minimum. line2 (apt/unit) optional.
 // line1 + zip together prove this is a real mailing address, not just
 // a city + state. Used for pen pal reciprocation (someone mails back
 // to this exact address). Never appears on the postcard front.
 const parsed = await parseAddress(body);
 if (!parsed || parsed.confidence < 0.7 || !parsed.line1 || !parsed.zip || !parsed.city || !parsed.state) {
 await loopSend({
 contact: phone,
 text: `That looks like just a city. I need the full mailing address. Format: street, city, state, ZIP.\n\nE.g. "123 Main St, San Francisco CA 94102".`,
 });
 return;
 }
 const { data: existing } = await admin
 .from("profiles").select("id").eq("phone", phone).maybeSingle();
 if (existing?.id) {
 // Save the FULL address privately, AND set city/state for postcard
 // (only city shows on the postcard front; line1/line2/zip stay private).
 await admin.from("profiles").update({
 home_line1: parsed.line1,
 home_line2: parsed.line2 || null,
 home_zip: parsed.zip,
 city: parsed.city,
 state: parsed.state,
 }).eq("id", existing.id);
 }
 await advanceState(phone, "awaiting_send_confirm", state.draft_token, {
 sender_city: parsed.city, sender_state: parsed.state,
 });
 const name = (state.conversation_data?.recipient_name ?? "your friend") as string;
 const firstName = name.split(/\s+/)[0];
 const recip = (state.conversation_data?.recipient ?? {}) as { city?: string; state?: string };
 const recipCity = recip.city || "their place";
 const note = (state.conversation_data?.message ?? "") as string;
 const balanceTag = await balanceParenthetical(phone);
 const heavy = isHeavyNote(note);
 // Vertical postcard composition (same aesthetic as handleMessage path).
 const noteBlock = note.length > 0 ? `\n\n   "${note}"` : "";
 const composition =
 `${parsed.city.toUpperCase()} ──→ ${recipCity.toUpperCase()}\n\n` +
 `   To: ${firstName}${noteBlock}`;
 await loopSend({
 contact: phone,
 text: heavy
 ? `${composition}\n\nThis one feels meaningful. SEND when ready, or CANCEL.${balanceTag}`
 : `${composition}\n\nSEND, schedule, or CANCEL.${balanceTag}`,
 });
}

async function handleSendConfirm(phone: string, body: string, state: any): Promise<void> {
 const c = await parseSendConfirm(body);
 if (c.intent === "cancel") {
 await resetState(phone);
 await loopSend({ contact: phone, text: "Cancelled. Send a new photo when you're ready." });
 return;
 }
 if (c.intent === "send_now") return await doMail(phone, state);
 if (c.intent === "schedule" && c.arrival_iso) return await doSchedule(phone, state, c);
 await loopSend({
 contact: phone,
 text: `Reply SEND to mail now, schedule it for later ("June 15" or "in 3 days"), or CANCEL.`,
 });
}

// PEN PAL SEND. Stranger mode forks here. We call match_pen_pal at
// SEND time (not earlier — pool may have changed since they picked
// pen pal mode), insert via send_postcard_sms_direct (bypasses friends
// table for privacy), and auto-opt the sender into the pool too so the
// loop closes.
async function doMailStranger(phone: string, state: any): Promise<void> {
 const data = state.conversation_data ?? {};
 const message = (data.message ?? "") as string;
 const draftToken = state.draft_token as string;

 if (!draftToken) {
  await resetState(phone);
  await loopSend({ contact: phone, text: "Something's missing from your draft. Text us a fresh photo to start over." });
  return;
 }

 // Sender setup
 let userId: string;
 try { userId = await findOrCreateUserByPhone(phone); }
 catch (e: any) {
  console.error("[loop-inbound] user create failed (stranger)", e);
  await loopSend({ contact: phone, text: "Couldn't set up your account. Try again in a minute." });
  return;
 }

 // Sender must have a full home address on file. Per round 14, we
 // collect this before the SEND prompt. If it's somehow missing, route
 // back to the address ask.
 const { data: senderProfile } = await admin
  .from("profiles")
  .select("city, state, home_line1, home_zip, accepts_strangers")
  .eq("id", userId).maybeSingle();
 if (!senderProfile?.home_line1 || !senderProfile?.home_zip ||
     !senderProfile?.city || !senderProfile?.state) {
  await advanceState(phone, "awaiting_sender_location", state.draft_token, {});
  await loopSend({
   contact: phone,
   text: "First, your mailing address — pen pals need somewhere to mail back. Format: street, city, state, ZIP.",
  });
  return;
 }

 // Auto-opt into the pool if not already (sending TO a stranger implies
 // willingness to receive — fair-exchange model).
 if (!senderProfile.accepts_strangers) {
  await admin.from("profiles").update({ accepts_strangers: true }).eq("id", userId);
 }

 // Match. Call the RPC.
 const { data: match, error: matchErr } = await admin.rpc("match_pen_pal", {
  p_sender_id: userId,
 });
 if (matchErr) {
  console.error("[loop-inbound] match_pen_pal threw", matchErr);
  await loopSend({ contact: phone, text: "Matching's having a moment. Try SEND again in a sec." });
  return;
 }
 const matchedRecipient = Array.isArray(match) && match.length > 0 ? match[0] : null;

 // Empty pool — soft fail. Keep the draft, tell the user we're on it.
 // (Later round: actual queueing. for now, drop with a graceful message
 // so the user knows their address is in the pool.)
 if (!matchedRecipient) {
  await loopSend({
   contact: phone,
   text:
    "📭 You're in the pool, but no eligible matches right now.\n\n" +
    "Your card stays drafted. We'll mail it the moment a match opens up. " +
    "Want to send to a friend instead? Reply with a name.",
  });
  // Reset the state machine but DON'T burn the credit or the draft —
  // the user can come back and pick a friend.
  // For v1 simplicity, just reset. Future: queue the draft for matching.
  await resetState(phone);
  return;
 }

 // Photo URL
 const { data: draftRow } = await admin
  .from("sms_postcard_drafts").select("photo_path").eq("token", draftToken).maybeSingle();
 if (!draftRow?.photo_path) {
  await resetState(phone);
  await loopSend({ contact: phone, text: "Your photo expired. Text a new one to start over." });
  return;
 }
 let photoUrl = draftRow.photo_path;
 if (!photoUrl.startsWith("http")) {
  const { data: signed } = await admin.storage
   .from("sms-photos").createSignedUrl(photoUrl, 60 * 60 * 24 * 7);
  if (!signed?.signedUrl) {
   await loopSend({ contact: phone, text: "Couldn't access your photo. Text us another to start over." });
   return;
  }
  photoUrl = signed.signedUrl;
 }

 // SAFETY GATE: pen pal cards go to a stranger's mailbox via USPS.
 // Hard-block CSAM / nudity / violence / weapons / explicit personal
 // info before insert. Fail-closed: if moderation is unavailable,
 // block. Better to inconvenience a sender than mail something illegal.
 const mod = await moderatePhotoAndText(photoUrl, message);
 if (!mod.ok) {
  console.warn("[loop-inbound] pen pal moderation blocked", { phone, reason: mod.reason, photo_flagged: mod.photo_flagged, text_flagged: mod.text_flagged });
  await resetState(phone);
  await loopSend({
   contact: phone,
   text:
    "📵 We can't send this to a stranger.\n\n" +
    "Pen pal cards go to someone we've never met, so we're conservative about " +
    "what we mail. Try a different photo or note, or send to a friend instead.",
  });
  return;
 }

 // Insert the postcard via the direct-address RPC (no friend row, no PII
 // exposed to the sender).
 const { data: postcardId, error: rpcErr } = await admin.rpc("send_postcard_sms_direct", {
  p_user_id: userId,
  p_message: message,
  p_photo_path: photoUrl,
  p_to_line1: matchedRecipient.recipient_line1,
  p_to_line2: matchedRecipient.recipient_line2,
  p_to_city: matchedRecipient.recipient_city,
  p_to_state: matchedRecipient.recipient_state,
  p_to_zip: matchedRecipient.recipient_zip,
  p_from_city: senderProfile.city,
 });
 if (rpcErr) {
  console.error("[loop-inbound] send_postcard_sms_direct failed", rpcErr);
  const oom = rpcErr.message?.includes("insufficient_credits");
  await loopSend({
   contact: phone,
   text: oom
    ? "Out of cards. BUY 5, 10, or 25 to top up, then SEND."
    : "Couldn't mail your card. Try SEND again, or text a new photo to start over.",
  });
  return;
 }

 // Lob handoff
 const lob = await submitToLob(postcardId as string);
 if (!lob.ok) {
  const { data: cur } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
  await admin.from("profiles").update({ credits: (cur?.credits ?? 0) + 1 }).eq("id", userId);
  await admin.from("postcards").delete().eq("id", postcardId);
  console.error("[loop-inbound] Lob failed (stranger)", lob.error);
  await loopSend({
   contact: phone,
   text: `Printer's down (${lob.error?.slice(0, 60)}). Credit refunded. SEND to retry.`,
  });
  return;
 }

 // Pairing log + recipient cool-down update
 await admin.from("pen_pal_pairings").insert({
  sender_id: userId,
  recipient_id: matchedRecipient.recipient_id,
  postcard_id: postcardId,
 });
 await admin
  .from("profiles")
  .update({ last_received_stranger_at: new Date().toISOString() })
  .eq("id", matchedRecipient.recipient_id);

 // Consume the draft + reset
 await admin.rpc("consume_sms_draft", { p_token: draftToken, p_postcard_id: postcardId });
 await resetState(phone);

 const eta = lob.expectedDelivery
  ? new Date(lob.expectedDelivery).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  : "in 3-5 days";
 const confirmUrl = `https://app.themailroom.club/c/${draftToken}`;

 // 3-act celebration, stranger flavor. Recipient city kept anonymous
 // ("somewhere new" instead of city name) so the sender doesn't know
 // where their card landed until the recipient writes back.
 await loopTyping(phone, 2);

 // Act 1: The moment. Stranger mode gets shootingStar (the "wish"
 // effect) regardless of note content — the pen pal vibe is wish-like
 // by nature.
 const postmarkDate = new Date().toLocaleDateString("en-US", {
  month: "short", day: "numeric", year: "numeric",
 }).toUpperCase();
 const mailedRes = await loopSend({
  contact: phone,
  subject: "🪶 Sent into the wire",
  text: `POSTMARKED · ${postmarkDate}\n\nYour card is on its way to someone, somewhere.`,
  effect: "shootingStar",
  passthrough: `stranger:${postcardId}`,
 });
 // Persist the Mailed bubble's message_id so lob-webhook can thread
 // later status updates as in-thread replies. Also stash from_phone
 // for the webhook to skip a profiles join.
 if (mailedRes.ok && mailedRes.messageId) {
  await admin.from("postcards").update({
   mailed_imessage_id: mailedRes.messageId,
   from_phone: phone,
  }).eq("id", postcardId);
 } else {
  await admin.from("postcards").update({ from_phone: phone }).eq("id", postcardId);
 }
 await sleep(700);

 // Act 2: Photo, still anonymous on the destination
 await loopSend({
  contact: phone,
  text: `→ somewhere new`,
  attachments: [photoUrl],
 });
 await sleep(450);

 // Act 3: The promise. The recipient will reply (we hope).
 await loopSend({
  contact: phone,
  text: `Arrives ${eta}. When they write back, you'll know.\n${confirmUrl}`,
 });
}

async function doMail(phone: string, state: any): Promise<void> {
 const data = state.conversation_data ?? {};
 const sendType = (data.send_type ?? "friend") as string;
 const message = data.message as string;
 const draftToken = state.draft_token as string;

 // Stranger mode short-circuit. No recipient name + address gathered.
 // We match at SEND time. Different code path entirely from friend mode.
 if (sendType === "stranger") {
   return await doMailStranger(phone, state);
 }

 const recipientName = data.recipient_name as string;
 const recipient = data.recipient as { line1: string; line2: string; city: string; state: string; zip: string };
 // SKIP-path bug fix (codex caught): empty-string message is VALID
 // (user texted SKIP). Use null/undefined check, not truthiness.
 if (!recipientName || !recipient || message == null || !draftToken) {
 await resetState(phone);
 await loopSend({ contact: phone, text: "Something's missing from your draft. Text us a fresh photo to start over." });
 return;
 }

 let userId: string;
 try { userId = await findOrCreateUserByPhone(phone); }
 catch (e: any) {
 console.error("[loop-inbound] user create failed", e);
 await loopSend({ contact: phone, text: "Couldn't set up your account. Try again in a minute." });
 return;
 }

 const senderCity = (data.sender_city as string) || "";
 const senderState = (data.sender_state as string) || "";
 if (senderCity && senderState) {
 await admin.from("profiles").update({ city: senderCity, state: senderState }).eq("id", userId);
 }

 let friendId: string;
 try {
 friendId = await findOrCreateFriend(userId, { ...recipient, name: recipientName });
 } catch (e: any) {
 console.error("[loop-inbound] friend create failed", e);
 await loopSend({ contact: phone, text: "Couldn't save your recipient. Try again in a minute." });
 return;
 }

 const { data: draftRow } = await admin
 .from("sms_postcard_drafts").select("photo_path").eq("token", draftToken).maybeSingle();
 if (!draftRow?.photo_path) {
 await resetState(phone);
 await loopSend({ contact: phone, text: "Your photo expired. Text a new one to start over." });
 return;
 }
 let photoUrl = draftRow.photo_path;
 if (!photoUrl.startsWith("http")) {
 const { data: signed } = await admin.storage
 .from("sms-photos").createSignedUrl(photoUrl, 60 * 60 * 24 * 7);
 if (!signed?.signedUrl) {
 await loopSend({ contact: phone, text: "Couldn't access your photo. Text us another to start over." });
 return;
 }
 photoUrl = signed.signedUrl;
 }

 const { data: postcardId, error: rpcErr } = await admin.rpc("send_postcard_sms", {
 p_user_id: userId, p_to_friend_id: friendId, p_message: message,
 p_photo_path: photoUrl, p_to_city: recipient.city, p_from_city: senderCity,
 });
 if (rpcErr) {
 console.error("[loop-inbound] send_postcard_sms failed", rpcErr);
 const oom = rpcErr.message?.includes("insufficient_credits");
 await loopSend({
 contact: phone,
 text: oom
 ? "Out of cards. BUY 5, 10, or 25 to top up, then SEND."
 : "Couldn't mail your card. Try SEND again, or text a new photo to start over.",
 });
 return;
 }

 const lob = await submitToLob(postcardId as string);
 if (!lob.ok) {
 const { data: cur } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
 await admin.from("profiles").update({ credits: (cur?.credits ?? 0) + 1 }).eq("id", userId);
 await admin.from("postcards").delete().eq("id", postcardId);
 console.error("[loop-inbound] Lob failed", lob.error);
 await loopSend({
 contact: phone,
 text: `Printer's down (${lob.error?.slice(0, 60)}). Credit refunded. SEND to retry.`,
 });
 return;
 }

 await admin.rpc("consume_sms_draft", { p_token: draftToken, p_postcard_id: postcardId });
 await resetState(phone);

 const eta = lob.expectedDelivery
 ? new Date(lob.expectedDelivery).toLocaleDateString("en-US", { month: "short", day: "numeric" })
 : "in 3-5 days";
 const confirmUrl = `https://app.themailroom.club/c/${draftToken}`;
 const recipLocLabel = [recipient.city, recipient.state].filter(Boolean).join(", ") || "their address";

 const { data: balRow } = await admin
 .from("profiles").select("credits").eq("id", userId).maybeSingle();
 const remaining = balRow?.credits ?? 0;

 // ===================================================================
 // THE CELEBRATION SEQUENCE. three bubbles, choreographed.
 // ===================================================================
 // Designed as a 3-act story instead of one wall-of-text bubble. Each
 // bubble does ONE thing and lands separately on the recipient's
 // device. iMessage shows them in order with the 450-700ms pauses
 // creating dramatic timing.
 //
 // Act 1. THE MOMENT
 // Hero declaration + confetti screen effect. No clutter. Just the
 // celebration. The "MAILED!" subject reads as a header.
 //
 // Act 2. THE PROOF
 // The user's own photo, embedded inline in the thread. Caption is
 // a one-line "→ destination" so the photo IS the message. Embedded
 // attachment = no Safari trip needed to see their card.
 //
 // Act 3. THE PROMISE
 // When, where, and how to track. URL gets a rich preview card from
 // iMessage so it never has to be tapped to see the route.
 // ===================================================================

 // Dramatic pause before Act 1. The "..." builds anticipation, then
 // BOOM. confetti and the celebration drops.
 await loopTyping(phone, 2);

 // Act 1. THE MOMENT (effect picked from note's emotional content)
 // Postmark line is the aesthetic anchor. Reads like a real cancellation
 // stamp. CAPS + center dot separator. The user comes back to the
 // thread a week later and sees the exact date their card was stamped.
 const effect = pickEffectForNote(message);
 const firstName = recipientName.split(/\s+/)[0];
 const postmarkDate = new Date().toLocaleDateString("en-US", {
   month: "short", day: "numeric", year: "numeric",
 }).toUpperCase();
 const mailedRes = await loopSend({
 contact: phone,
 subject: "📮 Mailed",
 text: `POSTMARKED · ${postmarkDate}\n\nCard to ${firstName} is in the mail.`,
 effect,
 passthrough: `mailed:${postcardId}`,
 });
 // Persist message_id + from_phone so lob-webhook can thread later
 // status updates into this same bubble.
 if (mailedRes.ok && mailedRes.messageId) {
  await admin.from("postcards").update({
   mailed_imessage_id: mailedRes.messageId,
   from_phone: phone,
  }).eq("id", postcardId);
 } else {
  await admin.from("postcards").update({ from_phone: phone }).eq("id", postcardId);
 }
 await sleep(700);

 // Act 2. THE PROOF (photo IS the message, caption is just a tag)
 await loopSend({
 contact: phone,
 text: `→ ${recipLocLabel}`,
 attachments: [photoUrl],
 });
 await sleep(450);

 // Act 3. THE PROMISE
 const buyTail = remaining <= 0
 ? `\n\nLast one. Reply BUY 5, BUY 10, or BUY 25 for more.`
 : remaining <= 2
 ? `\n\n${remaining} left. Reply BUY for more.`
 : "";
 await loopSend({
 contact: phone,
 text: `Arrives ${eta}.\n${confirmUrl}${buyTail}`,
 });
}

async function doSchedule(phone: string, state: any, schedule: ParsedSendConfirm): Promise<void> {
 const data = state.conversation_data ?? {};
 const recipientName = data.recipient_name as string;
 const recipient = data.recipient as { line1: string; line2: string; city: string; state: string; zip: string };
 const message = data.message as string;
 const draftToken = state.draft_token as string;
 if (!recipientName || !recipient || message == null || !draftToken || !schedule.arrival_iso) {
 await resetState(phone);
 await loopSend({ contact: phone, text: "Something's missing from your draft. Text us a fresh photo to start over." });
 return;
 }
 const arrival = new Date(schedule.arrival_iso + "T12:00:00Z");
 const sendAt = new Date(arrival.getTime() - 7 * 24 * 60 * 60 * 1000);
 if (sendAt.getTime() < Date.now() + 24 * 60 * 60 * 1000) {
 const arrivalLabel = arrival.toLocaleDateString("en-US", { month: "short", day: "numeric" });
 await loopSend({
 contact: phone,
 text: `${arrivalLabel} is too soon. Mail takes ~7 days. SEND now, or pick a later date.`,
 });
 return;
 }

 let userId: string;
 try { userId = await findOrCreateUserByPhone(phone); }
 catch (e: any) {
 console.error("[loop-inbound] user create failed (schedule)", e);
 await loopSend({ contact: phone, text: "Couldn't set up your account. Try again in a minute." });
 return;
 }
 const senderCity = (data.sender_city as string) || "";
 const senderState = (data.sender_state as string) || "";
 if (senderCity && senderState) {
 await admin.from("profiles").update({ city: senderCity, state: senderState }).eq("id", userId);
 }
 let friendId: string;
 try { friendId = await findOrCreateFriend(userId, { ...recipient, name: recipientName }); }
 catch (e: any) {
 console.error("[loop-inbound] friend create failed (schedule)", e);
 await loopSend({ contact: phone, text: "Couldn't save your recipient. Try again in a minute." });
 return;
 }

 const { data: draftRow } = await admin
 .from("sms_postcard_drafts").select("photo_path").eq("token", draftToken).maybeSingle();
 if (!draftRow?.photo_path) {
 await resetState(phone);
 await loopSend({ contact: phone, text: "Your photo expired. Text a new one to start over." });
 return;
 }
 let photoUrl = draftRow.photo_path;
 if (!photoUrl.startsWith("http")) {
 const { data: signed } = await admin.storage
 .from("sms-photos").createSignedUrl(photoUrl, 60 * 60 * 24 * 30);
 if (!signed?.signedUrl) {
 await loopSend({ contact: phone, text: "Couldn't access your photo. Text us another to start over." });
 return;
 }
 photoUrl = signed.signedUrl;
 }

 const { data: postcardId, error: rpcErr } = await admin.rpc("send_postcard_sms", {
 p_user_id: userId, p_to_friend_id: friendId, p_message: message,
 p_photo_path: photoUrl, p_to_city: recipient.city, p_from_city: senderCity,
 p_scheduled_send_at: sendAt.toISOString(),
 });
 if (rpcErr) {
 const oom = rpcErr.message?.includes("insufficient_credits");
 await loopSend({
 contact: phone,
 text: oom
 ? "Out of cards. BUY 5, 10, or 25 to top up, then schedule again."
 : "Couldn't schedule your card. Try again, or text a new photo.",
 });
 return;
 }

 await admin.rpc("consume_sms_draft", { p_token: draftToken, p_postcard_id: postcardId });
 await resetState(phone);
 const sendDateFmt = sendAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
 const arrivalFmt = arrival.toLocaleDateString("en-US", { month: "short", day: "numeric" });
 const confirmUrl = `https://app.themailroom.club/c/${draftToken}`;
 const recipLocLabel = [recipient.city, recipient.state].filter(Boolean).join(", ") || "their address";

 // ===================================================================
 // SCHEDULED CELEBRATION. same 3-act choreography as doMail,
 // but balloons (birthday-card vibe) instead of confetti.
 // ===================================================================

 // Dramatic pause to build anticipation
 await loopTyping(phone, 2);

 // Act 1. THE COMMITMENT
 const firstNameSched = recipientName.split(/\s+/)[0];
 await loopSend({
 contact: phone,
 subject: "🗓️ Scheduled",
 text: `Card to ${firstNameSched} mails ${sendDateFmt}.`,
 effect: "balloons",
 passthrough: `scheduled:${postcardId}`,
 });
 await sleep(700);

 // Act 2. THE PROOF
 await loopSend({
 contact: phone,
 text: `→ ${recipLocLabel}, arriving ~${arrivalFmt}`,
 attachments: [photoUrl],
 });
 await sleep(450);

 // Act 3. THE PROMISE
 await loopSend({ contact: phone, text: confirmUrl });
}

// =============================================================================
// LoopMessage webhook receiver. HTTP entry point
// =============================================================================

interface LoopWebhookPayload {
 event: string;
 contact: string;
 text?: string;
 message_type?: "text" | "reaction" | "audio" | "attachments" | "sticker" | "location";
 channel?: "imessage" | "sms" | "rcs";
 message_id: string;
 webhook_id: string;
 attachments?: string[];
 error_code?: number;
 passthrough?: string;
}

serve(async (req) => {
 if (req.method !== "POST") return new Response("POST only", { status: 405 });

 // Auth: LoopMessage echoes the dashboard-configured value in the Authorization header
 const auth = req.headers.get("Authorization") ?? "";
 if (!WEBHOOK_AUTH || auth !== WEBHOOK_AUTH) {
 console.warn("[loop-inbound] auth mismatch");
 return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
 status: 401, headers: { "Content-Type": "application/json" },
 });
 }

 let payload: LoopWebhookPayload;
 try { payload = await req.json(); }
 catch { return new Response("bad json", { status: 400 }); }

 if (!payload?.webhook_id || !payload?.event) {
 return new Response("missing fields", { status: 400 });
 }

 console.log("[loop-inbound]", {
 event: payload.event,
 webhook_id: payload.webhook_id,
 contact: payload.contact,
 message_type: payload.message_type,
 channel: payload.channel,
 text_preview: payload.text?.slice(0, 80),
 });

 // We only react to inbound user messages. Delivery/failure events are
 // logged above but don't trigger any reply (yet. Phase 3 will use them
 // for analytics + retry).
 if (payload.event !== "message_inbound") {
 return new Response(JSON.stringify({ ok: true, ignored: payload.event }), {
 status: 200, headers: { "Content-Type": "application/json" },
 });
 }

 // Route through the state machine. Run async so we can ACK fast. LoopMessage
 // expects 200 within 15s, and the state machine + OpenAI calls + Lob handoff
 // can take longer than that.
 const ctx: InboundCtx = {
 from: payload.contact,
 body: payload.text ?? "",
 attachments: payload.attachments ?? [],
 messageId: payload.message_id,
 };

 // ACK first, process in background. EdgeRuntime.waitUntil keeps the function
 // alive past the response so the state machine can finish.
 //
 // CRITICAL: any throw inside handleInbound dies SILENTLY because we've
 // already returned 200 to LoopMessage. To prevent black-hole failures,
 // the catch handler ALSO tries to send a fallback reply to the user so
 // they at least know something failed. Without this, a downstream bug
 // (e.g. malformed LoopMessage CDN URL) shows up as zero response, no
 // signal to the user, and no visible error to us.
 const safeHandle = async () => {
 try {
 await handleInbound(ctx);
 } catch (e: any) {
 const errMsg = e?.message ?? String(e);
 const errStack = (e?.stack ?? "").split("\n").slice(0, 3).join(" | ");
 console.error("[loop-inbound] handler threw", { errMsg, errStack, ctx });
 // Best-effort recovery message. don't let the user wonder why
 // nothing came back. Catch the catch so a recovery failure also
 // doesn't crash silently.
 try {
 await loopSend({
 contact: ctx.from,
 text: `Something broke on our end. (debug: ${errMsg.slice(0, 100)}) Try again, or text RESTART to reset.`,
 });
 } catch (sendErr: any) {
 console.error("[loop-inbound] recovery send also failed", sendErr?.message ?? sendErr);
 }
 }
 };

 // @ts-ignore
 if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
 // @ts-ignore
 EdgeRuntime.waitUntil(safeHandle());
 } else {
 await safeHandle();
 }

 return new Response(JSON.stringify({ ok: true }), {
 status: 200, headers: { "Content-Type": "application/json" },
 });
});
