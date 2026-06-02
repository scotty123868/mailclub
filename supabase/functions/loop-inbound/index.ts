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
// Non-blocking typing indicator. Fires show_typing and returns
// immediately WITHOUT sleeping — for the case where we want the "..."
// to appear instantly and persist while we do slow work (e.g. a photo
// download/upload) in the same handler. seconds = how long iMessage
// shows the dots (max 60). Use loopTyping() instead when you want to
// pace a bubble to land AFTER the dots clear.
function fireTyping(contact: string, seconds = 12): void {
 if (!LOOP_API_KEY) return;
 fetch("https://a.loopmessage.com/api/v1/message/show_typing/", {
 method: "POST",
 headers: { Authorization: LOOP_API_KEY, "Content-Type": "application/json" },
 body: JSON.stringify({
 contact,
 typing: Math.min(seconds, 60),
 ...(LOOP_SENDER_ID ? { sender: LOOP_SENDER_ID } : {}),
 }),
 }).catch((e) => console.warn("[loop-inbound] fireTyping failed", e?.message ?? e));
}

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
 // Hard timeout so a slow/hanging OpenAI can't freeze a conversation
 // step. On timeout (or any error) we return null and callers fall
 // back to their regex paths.
 const ctrl = new AbortController();
 const timer = setTimeout(() => ctrl.abort(), 7000);
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
 signal: ctrl.signal,
 });
 if (!res.ok) { console.warn("[loop-inbound] OpenAI", res.status); return null; }
 const data = await res.json();
 return JSON.parse(data.choices?.[0]?.message?.content ?? "");
 } catch (e: any) {
 console.warn("[loop-inbound] OpenAI threw", e?.message ?? e);
 return null;
 } finally {
 clearTimeout(timer);
 }
}

// US state name → 2-letter abbreviation. Used by the heuristic address
// fallback so "denver colorado 80218" still resolves when OpenAI is down.
const US_STATE_ABBR: Record<string, string> = {
 alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
 colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
 hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
 kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
 massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
 missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
 "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
 "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
 oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
 "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
 virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
 wyoming: "WY", "district of columbia": "DC",
};
const US_STATE_ABBRS = new Set(Object.values(US_STATE_ABBR));

// Regex/heuristic address parser. NO network. The safety net for when
// OpenAI is unreachable (dead key, rate limit, outage) so the address
// step never hard-sticks on "that looks like just a city." Requires a
// 5-digit ZIP, a resolvable state, a city, and a street number in line1.
// Returns null when it genuinely can't find a plausible mailing address.
function parseAddressHeuristic(input: string): ParsedAddress | null {
 const text = input.trim().replace(/\s+/g, " ");
 const zipM = text.match(/\b(\d{5})(?:-\d{4})?\b/);
 if (!zipM) return null;
 const zip = zipM[1];
 let beforeZip = text.slice(0, zipM.index).trim().replace(/[,\s]+$/, "");

 // State: 2-letter abbr or full name immediately before the ZIP.
 let state = "";
 const abbrM = beforeZip.match(/(?:^|[,\s])([A-Za-z]{2})$/);
 if (abbrM && US_STATE_ABBRS.has(abbrM[1].toUpperCase())) {
  state = abbrM[1].toUpperCase();
  beforeZip = beforeZip.slice(0, abbrM.index).trim().replace(/[,\s]+$/, "");
 } else {
  const words = beforeZip.split(/[,\s]+/);
  const last2 = words.slice(-2).join(" ").toLowerCase();
  const last1 = (words.slice(-1)[0] ?? "").toLowerCase();
  if (US_STATE_ABBR[last2]) {
   state = US_STATE_ABBR[last2];
   beforeZip = words.slice(0, -2).join(" ");
  } else if (US_STATE_ABBR[last1]) {
   state = US_STATE_ABBR[last1];
   beforeZip = words.slice(0, -1).join(" ");
  }
 }
 if (!state) return null;
 beforeZip = beforeZip.replace(/[,\s]+$/, "");

 // Split remaining "line1 [, ] city".
 let line1 = "", city = "";
 if (beforeZip.includes(",")) {
  const segs = beforeZip.split(",").map((s) => s.trim()).filter(Boolean);
  city = segs.pop() ?? "";
  line1 = segs.join(", ");
 } else {
  const words = beforeZip.split(" ");
  const cityWords = words.length >= 5 ? 2 : 1;
  city = words.slice(-cityWords).join(" ");
  line1 = words.slice(0, -cityWords).join(" ");
 }
 // Pull apt/unit into line2 BEFORE validating line1, so the street-name
 // check looks at the real street, not the unit token.
 let line2 = "";
 const aptM = line1.match(/\b(?:apt|apartment|unit|suite|ste|#)\s*\.?\s*[\w-]+\b/i);
 if (aptM) {
  line2 = aptM[0];
  line1 = line1.replace(aptM[0], "").trim().replace(/[,\s]+$/, "");
 }
 // line1 must be a real street: a house number AND at least one more
 // token (street name). Rejects "123" alone or a bare unit. This keeps
 // the instant fast-path honest — anything sketchier falls to the LLM.
 if (!line1 || !/\d/.test(line1) || line1.trim().split(/\s+/).length < 2) return null;
 if (!city) return null;

 return {
  line1, line2, city, state, zip,
  confidence: 0.75, // structurally valid; clears the 0.7 gate
  formatted: `${line1}${line2 ? " " + line2 : ""}, ${city}, ${state} ${zip}`,
  concerns: "",
  plausible: true,
 };
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
 // OpenAI unreachable (null) → heuristic fallback so the flow never
 // hard-sticks on the address step when the LLM is down.
 if (!r) return parseAddressHeuristic(input);
 // Defensive defaults so downstream code doesn't crash on missing keys.
 const result = {
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
 // The LLM sometimes under-scores a perfectly valid address — e.g. a
 // street with no "St"/"Ave" suffix like "861 Humboldt Denver Colorado
 // 80218" — and the hard 0.7 gate then rejects a real address. If the
 // LLM did NOT flag it implausible (so the city/state/ZIP are
 // consistent) AND the structural regex parser independently finds all
 // four components, trust the structure and bump confidence so it
 // passes. Genuinely bad input still fails: implausible (wrong
 // city/state) keeps plausible=false, and incomplete input makes the
 // heuristic return null.
 if (result.confidence < 0.7 && r.plausible !== false) {
 const h = parseAddressHeuristic(input);
 if (h && h.line1 && h.city && h.state && h.zip) {
 return { ...result, confidence: Math.max(result.confidence, 0.75) };
 }
 }
 return result;
}

// Address resolution for the conversation flow. FAST PATH FIRST: a
// structurally-complete address (house number + street + city + state +
// ZIP) parses instantly via regex with NO network call, so the bot
// confirms it the moment the user hits send. Only genuinely ambiguous or
// incomplete input falls back to the LLM (gpt-4o-mini, ~2-4s) — and only
// then do we show the typing indicator, because only then is there a
// wait. The user reviews the parsed address at the confirm step and Lob
// verifies deliverability at print, so skipping the LLM's geographic
// check on the clean happy path is a safe trade for instant feel.
// Lob US address verification. Takes a (possibly ZIP-less) address and
// returns a CASS-verified, completed one with the real USPS ZIP — or null
// if undeliverable / no match. Separate endpoint from mailing (no print,
// no charge beyond the cheap lookup), so it's safe to call even while
// MAILROOM_TEST_MODE_NO_LOB stops real cards. 6s timeout so it never
// hangs the step.
async function lobVerifyAddress(a: {
 line1: string; line2?: string; city: string; state: string; zip?: string;
}): Promise<{ line1: string; line2: string; city: string; state: string; zip: string } | null> {
 const key = Deno.env.get("LOB_API_KEY");
 if (!key) return null;
 const ctrl = new AbortController();
 const timer = setTimeout(() => ctrl.abort(), 6000);
 try {
 const form = new URLSearchParams();
 form.set("primary_line", a.line1);
 if (a.line2) form.set("secondary_line", a.line2);
 form.set("city", a.city);
 form.set("state", a.state);
 if (a.zip) form.set("zip_code", a.zip);
 const res = await fetch("https://api.lob.com/v1/us_verifications", {
 method: "POST",
 headers: {
 Authorization: `Basic ${btoa(key + ":")}`,
 "Content-Type": "application/x-www-form-urlencoded",
 },
 body: form,
 signal: ctrl.signal,
 });
 if (!res.ok) return null;
 const v = await res.json();
 const deliverable = typeof v?.deliverability === "string" && v.deliverability.startsWith("deliverable");
 const comp = v?.components ?? {};
 const zip = comp.zip_code ?? "";
 if (!deliverable || !zip) return null;
 return {
 line1: v.primary_line || a.line1,
 line2: a.line2 || "",
 city: comp.city || a.city,
 state: comp.state || a.state,
 zip,
 };
 } catch (e: any) {
 console.warn("[loop-inbound] lob verify failed", e?.message ?? e);
 return null;
 } finally {
 clearTimeout(timer);
 }
}

async function resolveAddress(phone: string, input: string): Promise<ParsedAddress | null> {
 let parsed = parseAddressHeuristic(input);
 if (!parsed) {
 fireTyping(phone, 8);
 parsed = await parseAddress(input);
 }
 // ZIP BACKFILL. If we got a real street + city + state but no ZIP, don't
 // force the user to type it — ask Lob to verify + complete the address
 // (USPS-accurate). Only runs on the missing-ZIP gap, so it's cheap. The
 // completed address is shown at the confirm step, so the user still
 // sees + approves the filled ZIP. If Lob can't verify, we fall through
 // with the ZIP still empty and the handler asks for it specifically.
 if (parsed && parsed.line1 && parsed.city && parsed.state && !parsed.zip) {
 fireTyping(phone, 6);
 const v = await lobVerifyAddress(parsed);
 if (v) {
 return {
 ...parsed,
 line1: v.line1, line2: v.line2, city: v.city, state: v.state, zip: v.zip,
 confidence: Math.max(parsed.confidence, 0.85),
 formatted: `${v.line1}, ${v.city}, ${v.state} ${v.zip}`,
 plausible: true,
 };
 }
 }
 return parsed;
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
 if (/^(y|yes|yep|yeah|yas|ya|sure|ok|okay|k|confirm|confirmed|send|send it|ship|ship it|do it|go|👍|✅|🚀|yeah sure|yes please|sounds good|looks good|looks right|look right|that looks right|go ahead|sure thing|that's right|thats right|correct|right|perfect|that's it|thats it|that's the one|good|all good)$/i.test(t))
 return { intent: "yes" };
 if (/^(n|no|nope|nah|cancel|stop|wait|hold on|not yet|no thanks|never mind|nevermind|nvm|not right|that's wrong|thats wrong|wrong)$/i.test(t))
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
 if (/^(y|yes|yep|yeah|yas|ya|sure|ok|okay|k|confirm|confirmed|send|send it|send it now|send away|mail it|mail it now|ship|ship it|do it|go|go for it|👍|✅|🚀|yeah sure|yes please|sounds good|looks good|looks great|go ahead|sure thing|let's go|lets go|let's do it|lets do it|perfect|do it now)$/i.test(t))
 return { intent: "send_now" };
 if (/^(n|no|nope|nah|cancel|stop|wait|hold on|not yet|no thanks|never mind|nevermind|nvm|not right|that's wrong|thats wrong|wrong)$/i.test(t))
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

// Release the anti-double-send claim: move the step back from "sending"
// to "awaiting_send_confirm" so the user's "SEND to retry" works after a
// RECOVERABLE failure (out of credits → BUY → SEND, a Lob hiccup, a pen
// pal match miss). Without this, the claim from handleSendConfirm would
// strand them at "sending" and the retry would silently no-op.
async function releaseSendClaim(phone: string, draftToken: string | null) {
 await advanceState(phone, "awaiting_send_confirm", draftToken, {});
}

// ===================================================================
// PEN PAL RECIPROCATION
// ===================================================================
// When a stranger receives a paper pen pal card, the QR code on the
// back deep-links them to text our number. We detect that scenario at
// photo-arrival time and offer them the path to mail back to their
// original pen pal (closing the loop) instead of starting fresh.
interface UnreciprocatedPairing {
 pairingId: string;
 senderId: string;          // the original sender, now the new recipient
 senderFirstName: string;
 senderCity: string;
 senderState: string;
 senderLine1: string;
 senderLine2: string | null;
 senderZip: string;
 pairedDaysAgo: number;
}

async function findUnreciprocatedPairing(phone: string): Promise<UnreciprocatedPairing | null> {
 // Resolve THIS phone to its profile id FIRST, then filter pairings by
 // recipient_id. PostgREST embedded-resource filters
 // (.eq("recipient.phone", ...)) do NOT reliably constrain the PARENT
 // row without !inner — the old query risked surfacing ANOTHER user's
 // pairing and routing a reply to the wrong sender. recipient_id is exact.
 const { data: me } = await admin
 .from("profiles").select("id").eq("phone", phone).maybeSingle();
 if (!me?.id) return null;

 // Most recent pen pal card this user received that hasn't been
 // responded to. 60-day window. Joins the original sender's home address
 // (where the reply will be mailed).
 const { data } = await admin
 .from("pen_pal_pairings")
 .select(`
 id, sender_id, paired_at, reciprocated_at,
 sender:profiles!pen_pal_pairings_sender_id_fkey(
 name, city, state, home_line1, home_line2, home_zip
 )
 `)
 .eq("recipient_id", me.id)
 .is("reciprocated_at", null)
 .gt("paired_at", new Date(Date.now() - 60 * 86400 * 1000).toISOString())
 .order("paired_at", { ascending: false })
 .limit(1)
 .maybeSingle();
 if (!data) return null;
 const sender = (data as any).sender;
 if (!sender?.home_line1 || !sender?.home_zip) return null;
 const firstName = (sender.name ?? "your pen pal").split(/\s+/)[0] || "your pen pal";
 const pairedDaysAgo = Math.floor((Date.now() - new Date((data as any).paired_at).getTime()) / 86400 / 1000);
 return {
 pairingId: (data as any).id,
 senderId: (data as any).sender_id,
 senderFirstName: firstName,
 senderCity: sender.city ?? "",
 senderState: sender.state ?? "",
 senderLine1: sender.home_line1,
 senderLine2: sender.home_line2 ?? null,
 senderZip: sender.home_zip,
 pairedDaysAgo,
 };
}

// ===================================================================
// SUNDAY DROP
// ===================================================================
// Pen pal cards queue for the next Sunday at noon UTC instead of mailing
// immediately. Anticipation + ritual: feels like a club, not a transaction.
// The fire-scheduled-postcards cron handles the actual Sunday handoff.
function nextSundayDropTime(): Date {
 const now = new Date();
 const dayOfWeek = now.getUTCDay(); // 0 = Sunday
 const noonToday = new Date(now);
 noonToday.setUTCHours(12, 0, 0, 0);
 const daysUntilSunday = dayOfWeek === 0 && now < noonToday
 ? 0
 : (7 - dayOfWeek) % 7 || 7;
 const sunday = new Date(now);
 sunday.setUTCDate(sunday.getUTCDate() + daysUntilSunday);
 sunday.setUTCHours(12, 0, 0, 0);
 return sunday;
}

async function getSundayDropQueuePosition(dropDate: Date): Promise<number> {
 const { count } = await admin
 .from("postcards")
 .select("id", { count: "exact", head: true })
 .eq("status", "scheduled")
 .eq("to_kind", "stranger")
 .eq("scheduled_send_at", dropDate.toISOString());
 return (count ?? 0) + 1;
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

// Rolodex reuse. When a texting user names a friend, see if that friend
// is already saved (in the app or from a past text send) WITH a full
// address — so we can offer to reuse it instead of asking them to retype
// it. Resolves the user by phone (read-only; no account is created just
// to look up). Returns the single confident match, or null when there's
// no profile, no match, no saved address, or the name is ambiguous (2+
// matches) — in which case the caller falls back to asking for the
// address, which is the safe path.
async function findSavedFriendAddress(
 phone: string,
 name: string,
): Promise<{ id: string; name: string; line1: string; line2: string; city: string; state: string; zip: string } | null> {
 const typed = name.trim();
 if (typed.length < 2) return null;
 const { data: prof } = await admin
 .from("profiles").select("id").eq("phone", phone).maybeSingle();
 if (!prof?.id) return null;
 const { data: rows } = await admin
 .from("friends")
 .select("id, name, address_line1, address_line2, address_city, address_state, address_zip")
 .eq("owner_id", prof.id)
 .ilike("name", `${typed}%`)
 .not("address_line1", "is", null)
 .not("address_zip", "is", null)
 .limit(3);
 const withAddr = (rows ?? []).filter(
 (r: any) => r.address_line1 && r.address_zip && r.address_city && r.address_state,
 );
 if (withAddr.length !== 1) return null; // 0 or ambiguous → ask normally
 const f: any = withAddr[0];
 return {
 id: f.id, name: f.name,
 line1: f.address_line1, line2: f.address_line2 ?? "",
 city: f.address_city, state: f.address_state, zip: f.address_zip,
 };
}

// =============================================================================
// Celebration gallery composition
// =============================================================================
//
// The Mailed celebration's Act 2 is a 3-tile story shown inline in
// iMessage (rendered as a photo grid — no link tap required):
//
//   1. their photo    the human moment (full-bleed original)
//   2. the card       the artifact: flip GIF (front w/ photo ↔ back
//                     w/ note), or static front+back if the flip
//                     didn't render
//   3. the route      the journey: native Apple Maps snapshot
//
// Order matters — photo first (most personal), map last (the
// resolution). Each tile degrades independently. iMessage caps
// attachments at 5; worst case here is 4 (photo + front + back + map).

interface GallerySources {
  frontThumbnailUrl?: string;
  backThumbnailUrl?: string;
  flipGifUrl?: string;
  routeMapUrl?: string;
}

function buildCelebrationGallery(src: GallerySources, photoUrl: string): string[] {
  const gallery: string[] = [];

  // 1. The photo — always lead with it. It's the most personal frame
  //    and grounds the whole gallery in "this is YOUR shot."
  if (photoUrl) gallery.push(photoUrl);

  // 2. The card. Prefer the animated flip; fall back to the two static
  //    sides; if neither rendered, the photo above already stands in.
  if (src.flipGifUrl) {
    gallery.push(src.flipGifUrl);
  } else {
    if (src.frontThumbnailUrl) gallery.push(src.frontThumbnailUrl);
    if (src.backThumbnailUrl) gallery.push(src.backThumbnailUrl);
  }

  // 3. The journey. Native Apple Maps route snapshot. Dropped silently
  //    if geocoding/snapshot failed.
  if (src.routeMapUrl) gallery.push(src.routeMapUrl);

  // Safety: never return empty (would send a captionless bubble).
  if (gallery.length === 0 && photoUrl) gallery.push(photoUrl);

  return gallery.slice(0, 5);
}

// Act 2 caption for the gallery. Postal-label centering ("· To
// Brooklyn, NY ·") with the great-circle distance underneath when it's
// far enough to feel like a journey. The 25-mile floor avoids a silly
// "3 miles by post" on same-town sends.
function routeCaption(toLabel: string, miles?: number): string {
  const base = `· To ${toLabel} ·`;
  if (miles && miles > 25) {
    return `${base}\n${miles.toLocaleString("en-US")} miles by post`;
  }
  return base;
}

// =============================================================================
// Lob handoff (same internal-secret HTTP pattern as sms-inbound)
// =============================================================================

async function submitToLob(postcardId: string): Promise<{ ok: boolean; expectedDelivery?: string; frontThumbnailUrl?: string; backThumbnailUrl?: string; flipGifUrl?: string; routeMapUrl?: string; routeMiles?: number; error?: string }> {
 // HARD GUARD: stub the Lob call entirely if MAILROOM_TEST_MODE_NO_LOB
 // is set AND no Lob test key is configured. The stub returns a fake
 // ok response — no thumbnails, no GIFs, the celebration falls back to
 // the raw camera-roll photo. Prevents real-money mailings during the
 // earliest dev cycles when no Lob test key is wired up yet.
 //
 // SOFTER PATH (preferred for dev): set LOB_API_KEY_TEST in project
 // secrets. lob-send-postcard auto-prefers it, runs the FULL Lob render
 // pipeline (composing the card, generating PNG thumbnails) without
 // printing or charging. This stub becomes a no-op when the test key
 // is present, so the gallery (flip + route GIFs) renders end-to-end
 // for visual validation without burning real cards.
 const hasLobTestKey = !!Deno.env.get("LOB_API_KEY_TEST");
 if (Deno.env.get("MAILROOM_TEST_MODE_NO_LOB") === "true" && !hasLobTestKey) {
   console.log("[loop-inbound] TEST_MODE_NO_LOB enabled (no test key), stubbing Lob call", { postcardId });
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
 // Pass through all the rendered surfaces:
 //   - frontThumbnailUrl / backThumbnailUrl: Lob's static PNG of
 //     each side of the card (composed by Lob).
 //   - flipGifUrl: front ↔ back animated flip (built by
 //     postcard-render-gifs from the two thumbnails).
 //   - routeMapUrl: native Apple Maps snapshot of the route.
 //
 // Used by Act 2 as the [photo, card flip, route map] gallery. Each
 // degrades independently — missing flip falls back to static
 // thumbnails, missing map just drops the third tile.
 return {
   ok: true,
   expectedDelivery: data.expected_delivery_date,
   frontThumbnailUrl: data.front_thumbnail_url ?? undefined,
   backThumbnailUrl: data.back_thumbnail_url ?? undefined,
   flipGifUrl: data.flip_gif_url ?? undefined,
   routeMapUrl: data.route_map_url ?? undefined,
   routeMiles: data.route_miles ?? undefined,
 };
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
 text: `Pick 1, 2, or 3, or just write your own.`,
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

 // Fetch state once at the top — used by the photo-restart guard, the
 // loose-BUY gate, and step routing.
 const state = await getConversationState(from);

 // 1. Global: explicit reset is the universal escape hatch. First, so it
 // works even mid-confirmation.
 if (isRestartCommand(body)) {
 await resetState(from);
 await loopSend({ contact: from, text: "Cancelled." });
 return;
 }

 // 1a. Resolve a pending "start over with this new photo?" confirmation.
 // (Set when a photo arrived mid-draft — see the photo block below. We
 // ask instead of silently wiping a card the user is in the middle of.)
 const pendingNewPhotoUrl = state.conversation_data?.pending_new_photo_url as string | undefined;
 if (pendingNewPhotoUrl) {
 if (attachments.length >= 1) {
 // Another photo while deciding: swap in the newest and re-ask.
 if (messageId) await loopReact(from, messageId, "love");
 await advanceState(from, state.step, state.draft_token, {
 ...(state.conversation_data ?? {}), pending_new_photo_url: attachments[0],
 });
 await loopSend({ contact: from, text: "Got the new photo. Start over with it? Yes, or no to keep your current card." });
 return;
 }
 const ans = await parseConfirmation(body);
 if (ans.intent === "yes") {
 // startNewConversation builds a fresh draft from the new photo and
 // replaces conversation_data, which clears the pending flag.
 return await startNewConversation(from, pendingNewPhotoUrl);
 }
 if (ans.intent === "no") {
 await advanceState(from, state.step, state.draft_token, {
 ...(state.conversation_data ?? {}), pending_new_photo_url: null,
 });
 await loopSend({ contact: from, text: "Okay, keeping your card in progress. Reply to the last step above to keep going." });
 return;
 }
 await loopSend({ contact: from, text: "Want to start over with the new photo? Yes, or no to keep your current card." });
 return;
 }

 // 2. Global: a new photo. If there's a card in progress that ALREADY has
 // a photo, a new one would wipe that work — so ask first instead of
 // silently discarding. If idle, or in a state waiting FOR a photo (the
 // REPLY-code reply flow has an empty draft), just start normally.
 if (attachments.length >= 1) {
 if (state.step !== "idle" && state.draft_token) {
 const { data: draftRow } = await admin
 .from("sms_postcard_drafts").select("photo_path").eq("token", state.draft_token).maybeSingle();
 if (draftRow?.photo_path) {
 if (messageId) await loopReact(from, messageId, "love");
 await advanceState(from, state.step, state.draft_token, {
 ...(state.conversation_data ?? {}), pending_new_photo_url: attachments[0],
 });
 await loopSend({ contact: from, text: "You've got a card in progress. Start over with this new photo? Yes, or no to keep going." });
 return;
 }
 }
 // Instant ❤️ tapback, then build the new card.
 if (messageId) await loopReact(from, messageId, "love");
 return await startNewConversation(from, attachments[0]);
 }

 // 2b. Global: REPLY <code> — the QR-on-postcard deep link target.
 // When someone scans the QR on a Mailroom postcard or types the
 // printed instruction, the prefilled body is "REPLY ABC123".
 // We look up the short_code, find the original sender's home
 // address, stash pending_reply on conversation state, and ask
 // them for a photo. The rest of the flow runs as a reciprocation
 // send (see handleSendType + doMailReplyToPenPal).
 const replyMatch = body.trim().match(/^REPLY\s+([A-Z0-9]{4,8})$/i);
 if (replyMatch) {
 const code = replyMatch[1].toUpperCase();
 const { data: lookup } = await admin.rpc("lookup_reciprocation_short_code", {
 p_code: code,
 });
 const match = Array.isArray(lookup) && lookup.length > 0 ? lookup[0] : null;
 if (!match) {
 await loopSend({
 contact: from,
 text: `Couldn't find a card with code ${code}. Double-check the code on the back of the postcard.`,
 });
 return;
 }
 if (!match.sender_line1 || !match.sender_zip) {
 await loopSend({
 contact: from,
 text: `${match.sender_first_name}'s address isn't on file yet, so I can't route a card back to them right now. Sorry for the run-around.`,
 });
 return;
 }
 // Stash the pending_reply context on a fresh state and ask for a photo.
 const token = mintToken();
 await admin.from("sms_postcard_drafts").insert({
 token,
 from_phone: from,
 caption: "",
 photo_path: "",
 twilio_media_url: "",
 verified_phone: from,
 });
 await advanceState(from, "awaiting_send_type", token, {
 pending_reply: {
 pairing_id: null, // not always a pen pal pairing (could be a friend send)
 sender_id: match.sender_id,
 sender_first_name: match.sender_first_name,
 sender_city: match.sender_city,
 sender_state: match.sender_state,
 sender_line1: match.sender_line1,
 sender_line2: match.sender_line2,
 sender_zip: match.sender_zip,
 paired_days_ago: null,
 short_code: code,
 },
 });
 await loopSend({
 contact: from,
 subject: "💌 Writing back",
 text:
 `Send me the photo you want on ${match.sender_first_name}'s card` +
 (match.sender_city ? ` in ${match.sender_city}` : "") + `.`,
 });
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
 text: `${checkout.pack_label}\n${checkout.url}\n\nExpires in 1h. Other sizes: say "buy 5" or "buy 25".`,
 });
 return;
 }
 // Loose "buy ..." hint (e.g. "buy more credits"), but ONLY when the user
 // is NOT mid free-text entry. In a content-entry step a message that
 // starts with "buy" is the user's actual note/name/address (a postcard
 // that reads "buy yourself something nice" must NOT be hijacked into the
 // purchase menu). The exact BUY / BUY 5 / 10 / 25 command above is
 // anchored and stays global.
 const CONTENT_ENTRY_STEPS = new Set([
 "awaiting_message", "awaiting_recipient_name",
 "awaiting_recipient_address", "awaiting_sender_location",
 ]);
 if (/^buy\b/i.test(body.trim()) && !CONTENT_ENTRY_STEPS.has(state.step)) {
 await loopSend({
 contact: from,
 text: "Top up: 5 cards for $5, 10 for $10, 25 for $25. Just say \"buy 10\" (or buy 5, buy 25).",
 });
 return;
 }

 // 5. Step-based routing.
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
 case "awaiting_sender_address_confirm":
 return await handleSenderAddressConfirm(from, body, state);
 case "awaiting_send_confirm":
 return await handleSendConfirm(from, body, state);
 default:
 await resetState(from);
 await loopSend({ contact: from, text: "Let's start fresh. Text a photo to begin a new card." });
 }
}

async function handleIdle(from: string): Promise<void> {
 const { data: prof } = await admin
 .from("profiles").select("credits").eq("phone", from).maybeSingle();
 if (!prof) {
 // Cold-open for someone who's texted us but has no profile yet.
 // Anchor the brand (magical mail club) before the utility (send a
 // photo). The "First one's on us" is the value prop nudge.
 await loopSend({
 contact: from,
 subject: "📮 Welcome to Mailroom",
 text: "A magical mail club. Real paper. By text.\n\nText us a photo to send your first postcard, on us.",
 });
 return;
 }
 const credits = prof.credits ?? 0;
 if (credits <= 0) {
 await loopSend({
 contact: from,
 text: "Out of cards. Text \"buy\" to top up.",
 });
 return;
 }
 await loopSend({
 contact: from,
 text: `You have ${credits} card${credits === 1 ? "" : "s"} left. Text a photo to start a new one.`,
 });
}

async function startNewConversation(phone: string, mediaUrl: string): Promise<void> {
 // INSTANT FEEDBACK. The photo download from LoopMessage's CDN + EXIF
 // strip + re-upload to storage takes 10-15s for a large HEIC. Without
 // this the thread sits dead-silent the whole time. Fire a typing
 // indicator immediately (non-blocking) AND send the "got it" ack
 // BEFORE the slow upload, so the user sees a response in ~1-2s. The
 // heavy lifting happens behind the typing dots.
 fireTyping(phone, 25);

 // Two cheap lookups, parallelized: first-time status (drives the ack
 // copy + vCard) and any stashed REPLY-code reply context. REPLY CODE
 // continuation: if this phone is mid-flow from a recent REPLY <code>
 // text (QR scan), they already told us who to write back to — the
 // photo they're sending now is for THAT card, so we must NOT clobber
 // the stashed pending_reply on the awaiting_send_type advance.
 const [firstTime, priorStateRes] = await Promise.all([
  isFirstTimeContact(phone),
  admin
   .from("sms_conversation_state")
   .select("conversation_data")
   .eq("phone", phone)
   .maybeSingle(),
 ]);
 const carryReply = (priorStateRes.data?.conversation_data?.pending_reply ?? null) as any;

 // Bubble A — sent NOW, before the upload. One clean beat for everyone
 // (reply-code senders get a name-aware line). No fluff; the question
 // is what matters. If the upload then fails, the "lost it on the
 // conveyor" line below reads as an honest follow-up.
 const ackText = carryReply
  ? `📮 Got it.`
  : "📮 Got it.";
 await loopSend({ contact: phone, text: ackText });

 const token = mintToken();
 const upload = await downloadAndUploadPhoto(mediaUrl, token);
 if (!upload.ok) {
 // Verbose error during debug. strip back once photo path verified.
 console.error("[loop-inbound] photo intake failed", { mediaUrl: mediaUrl.slice(0, 200), error: upload.error });
 await loopSend({
 contact: phone,
 text: `Couldn't download that photo. Send it again?`,
 });
 return;
 }
 await admin.from("sms_postcard_drafts").insert({
 token, from_phone: phone, caption: "",
 photo_path: upload.path, twilio_media_url: mediaUrl,
 verified_phone: phone,
 });

 // CLEAN SLATE. advance_sms_conversation SHALLOW-MERGES conversation_data,
 // so advancing with {} below would NOT clear stale keys from a prior
 // conversation (old recipient_name, message, pending_reply,
 // pending_new_photo_url, pending_ideas). Reset first so this new card
 // starts truly fresh. carryReply was already captured above, before any
 // reset, and is re-applied explicitly in the REPLY-code branch.
 await resetState(phone);

 // REPLY CODE FAST PATH: stranger scanned a QR on a Mailroom card, texted
 // REPLY <code>, then sent their photo. Skip the "who's this for?"
 // question entirely — they already told us via the code. Jump straight
 // to message capture with send_type=reply_to_pen_pal pre-set so
 // handleSendConfirm routes to doMailReplyToPenPal at the end.
 if (carryReply) {
  await advanceState(phone, "awaiting_message", token, {
   pending_reply: carryReply,
   send_type: "reply_to_pen_pal",
  });
  // Ack (Bubble A) already sent above, before the upload. Go straight
  // to the note prompt.
  await loopSend({
   contact: phone,
   subject: "✍️ Write your note",
   text: `What should the card say?\n\nUp to 240 characters, or say "skip" for just the photo.`,
   contact_file: firstTime,
  });
  return;
 }

 await advanceState(phone, "awaiting_recipient_name", token, {});

 // Warm, clear, conversational opener. Full questions, not cryptic
 // arrows. Two-bubble pattern: Bubble A is the "we saw it" beat,
 // Bubble B is the actual question.
 //
 // ACTIVE PENPAL DEEP LINK: if this phone recently received an
 // unreciprocated pen pal card, surface that as a third option in
 // Bubble B. The user texts back a photo and the bot says "looks
 // like Sarah in Brooklyn sent you a card — want to write her back?"
 // This closes the most important loop in the entire product.
 await advanceState(phone, "awaiting_send_type", token, {});

 const pendingReply = await findUnreciprocatedPairing(phone);

 // Bubble A (the "got it" ack) was already sent up top, before the
 // upload. Now send Bubble B — the question — which lands after the
 // upload completes (the typing dots covered the gap).

 // If there's a pen pal to reply to, stash the pairing context so
 // handleSendType / doMail can branch on it.
 if (pendingReply) {
 await advanceState(phone, "awaiting_send_type", token, {
 pending_reply: {
 pairing_id: pendingReply.pairingId,
 sender_id: pendingReply.senderId,
 sender_first_name: pendingReply.senderFirstName,
 sender_city: pendingReply.senderCity,
 sender_state: pendingReply.senderState,
 sender_line1: pendingReply.senderLine1,
 sender_line2: pendingReply.senderLine2,
 sender_zip: pendingReply.senderZip,
 paired_days_ago: pendingReply.pairedDaysAgo,
 },
 });
 const daysWord = pendingReply.pairedDaysAgo <= 1 ? "yesterday"
 : pendingReply.pairedDaysAgo < 7 ? `${pendingReply.pairedDaysAgo} days ago`
 : `${Math.floor(pendingReply.pairedDaysAgo / 7)} week${Math.floor(pendingReply.pairedDaysAgo / 7) > 1 ? "s" : ""} ago`;
 const locationLabel = pendingReply.senderCity
 ? `${pendingReply.senderFirstName} in ${pendingReply.senderCity}${pendingReply.senderState ? ", " + pendingReply.senderState : ""}`
 : pendingReply.senderFirstName;
 await loopSend({
 contact: phone,
 subject: "📬 Pen pal reply waiting",
 text:
 `${locationLabel} sent you a card ${daysWord}.\n\n` +
 `Want to write them back? Just say yes, or give me a friend's name, or say "penpal" for a new match.`,
 contact_file: firstTime,
 });
 return;
 }

 // Bubble B: get straight to the question. Someone texting a photo
 // already knows what Mailroom is — no welcome spiel. First-timers get
 // a one-clause "on us" nudge + the vCard; returning senders just get
 // the question.
 if (firstTime) {
 await loopSend({
 contact: phone,
 text: "Who's this card for?\n\nTell me a name, or say \"penpal\" to be matched with someone new. First one's free.",
 contact_file: true,
 });
 } else {
 await loopSend({
 contact: phone,
 text: "Who's this one for?\n\nTell me a name, or say \"penpal\" for a new match.",
 });
 }
}

// =============================================================================
// Send-type choice: friend vs stranger pen pal
// =============================================================================
async function handleSendType(phone: string, body: string, state: any): Promise<void> {
 const raw = body.trim();
 const lower = raw.toLowerCase();

 // ACTIVE PENPAL REPLY: if startNewConversation found an unreciprocated
 // pairing and stashed it on conversation_data.pending_reply, YES (or
 // equivalent) means "close the loop with that pen pal." We skip the
 // name + address asks entirely because routing is already cached.
 const pendingReply = (state.conversation_data?.pending_reply ?? null) as any;
 if (pendingReply && /^(y|yes|yeah|yep|sure|do it|let's go|lets go|reply|write back|close the loop)$/i.test(raw)) {
 // Guard: the REPLY-code deep link stashes pending_reply BEFORE any
 // photo is sent. If someone says "yes" here without a photo on the
 // draft, advancing to the note step would end in a Lob reject (no
 // front image). Route them to send the photo first. (The active-pen-
 // pal flow already has a photo on the draft, so it sails through.)
 const { data: draftRow } = await admin
 .from("sms_postcard_drafts").select("photo_path").eq("token", state.draft_token).maybeSingle();
 if (!draftRow?.photo_path) {
 await loopSend({
 contact: phone,
 text: `First, send me the photo you want on ${pendingReply.sender_first_name}'s card.`,
 });
 return;
 }
 await advanceState(phone, "awaiting_message", state.draft_token, {
 send_type: "reply_to_pen_pal",
 });
 await loopSend({
 contact: phone,
 text: `Writing ${pendingReply.sender_first_name} back. What should your card say? (Up to 240 chars, or say "skip" for just the photo.)`,
 });
 return;
 }

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
 "What should your card say? (Up to 240 chars, or say 'skip' for just the photo.)",
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
 // Rolodex reuse: if this friend is already saved with an address,
 // offer to reuse it instead of asking the user to retype it.
 const saved = await findSavedFriendAddress(phone, raw);
 if (saved) {
 await advanceState(phone, "awaiting_address_confirm", state.draft_token, {
 send_type: "friend",
 recipient_name: saved.name,
 recipient: { line1: saved.line1, line2: saved.line2, city: saved.city, state: saved.state, zip: saved.zip },
 });
 const f = saved.name.split(/\s+/)[0];
 await loopSend({
 contact: phone,
 text: `Found ${f} in ${saved.city}, ${saved.state} (${saved.line1}). Send there? Or give me a different address.`,
 });
 return;
 }
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
 text: "Tell me a friend's name, or say \"penpal\" to be matched with someone new.",
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
 await loopSend({ contact: phone, text: "That doesn't look like a name. Who's the card for?" });
 return;
 }
 // Rolodex reuse: skip the address ask if this friend is already saved
 // with one. Confirm before using (addresses go stale).
 const saved = await findSavedFriendAddress(phone, name);
 if (saved) {
 await advanceState(phone, "awaiting_address_confirm", state.draft_token, {
 recipient_name: saved.name,
 recipient: { line1: saved.line1, line2: saved.line2, city: saved.city, state: saved.state, zip: saved.zip },
 });
 const f = saved.name.split(/\s+/)[0];
 await loopSend({
 contact: phone,
 text: `Found ${f} in ${saved.city}, ${saved.state} (${saved.line1}). Send there? Or give me a different address.`,
 });
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
 // Fast path: a clean address confirms instantly (no LLM). Only
 // ambiguous input hits the LLM, and resolveAddress shows typing then.
 const parsed = await resolveAddress(phone, body);

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
 // No-ZIP is the common miss — name it + pre-fill the rest so they
 // don't have to retype the whole thing.
 let text: string;
 if (parsed.line1 && parsed.city && parsed.state && !parsed.zip) {
 text = `Almost there. I just need the ZIP. Resend it like:\n${parsed.line1}, ${parsed.city} ${parsed.state} <ZIP>`;
 } else {
 const missing = [
 !parsed.line1 && "street",
 !parsed.city && "city",
 !parsed.state && "state",
 !parsed.zip && "ZIP",
 ].filter(Boolean).join(", ");
 text = `I'm missing the ${missing}. Full address? Format: street, city, state, ZIP.`;
 }
 await loopSend({ contact: phone, text });
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
 // "Mailing to:" reframes — the user's confirming a real-world
 // action, not validating data. "Good?" is friendlier than "Does
 // this look right?" which has a clipboard-and-checkboxes vibe.
 await loopSend({
 contact: phone,
 text: `Mailing to:\n${label}\n\nLook right?`,
 });
}

async function handleAddressConfirm(phone: string, body: string, state: any): Promise<void> {
 // Y/N hits a regex fast-path; anything fuzzier falls to the LLM. Show
 // dots either way — cheap insurance against a laggy classify.
 fireTyping(phone, 6);
 const t = body.trim();
 // Inline address override. If they typed a NEW address here instead of
 // Y/N (common when a reused/saved address is stale, or they just want to
 // correct it), parse + switch to it and re-confirm — no "no" detour. The
 // digit gate skips the LLM for plain Y/N.
 if (/\d/.test(t)) {
 const newAddr = await parseAddress(t);
 if (newAddr && newAddr.confidence >= 0.7 && newAddr.line1 && newAddr.zip && newAddr.city && newAddr.state) {
 await advanceState(phone, "awaiting_address_confirm", state.draft_token, {
 recipient: { line1: newAddr.line1, line2: newAddr.line2 || "", city: newAddr.city, state: newAddr.state, zip: newAddr.zip },
 });
 const nm = (state.conversation_data?.recipient_name ?? "your friend") as string;
 const fn = nm.split(/\s+/)[0];
 const l2 = newAddr.line2 ? `\n   ${newAddr.line2}` : "";
 const label = `   ${fn}\n   ${newAddr.line1}${l2}\n   ${newAddr.city}, ${newAddr.state} ${newAddr.zip}`;
 await loopSend({ contact: phone, text: `Mailing to:\n${label}\n\nGood?` });
 return;
 }
 }
 const c = await parseConfirmation(t);
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
 text: `Last time, you wrote ${firstName} (${lastDate}): "${preview}"\n\nWant a few ideas to start? Just say "ideas", or go ahead and write your own.`,
 });
 return;
 }

 // First-time message prompt. explicit question, offers SKIP as an
 // out for users who want just the photo with no words.
 await loopSend({
 contact: phone,
 text: "Want to add a note? Just type it (up to 240 chars), or say \"skip\" to mail only the photo.",
 });
 return;
 }
 if (c.intent === "no") {
 await advanceState(phone, "awaiting_recipient_address", state.draft_token, {});
 await loopSend({ contact: phone, text: "No problem. Send me the correct address?" });
 return;
 }
 await loopSend({ contact: phone, text: "Does that look right? Or just send the correct address." });
}

// Pre-send postcard composition shown at the SEND-confirm step. Branches
// on send type so pen pal mode reads correctly (no recipient identity —
// it conveys the mystery) instead of the broken "CITY ──→ THEIR PLACE /
// To: your friend" the friend-template produced for strangers.
function buildPreSendComposition(opts: {
 fromCity: string;
 sendType: string;
 recipientName?: string;
 recipientCity?: string;
 note: string;
}): string {
 const from = (opts.fromCity || "").trim().toUpperCase() || "YOUR CITY";
 const noteBlock = opts.note.length > 0 ? `\n\n   "${opts.note}"` : "";
 if (opts.sendType === "stranger") {
  return `${from} ──→ ✦\n\n   To: a pen pal in the pool${noteBlock}`;
 }
 const firstName = (opts.recipientName ?? "").split(/\s+/)[0] || "your friend";
 const toCity = (opts.recipientCity || "their place").toUpperCase();
 return `${from} ──→ ${toCity}\n\n   To: ${firstName}${noteBlock}`;
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

 // A postcard back only holds so much, so we cap the note at 240. If
 // they wrote more, trim it AND tell them (so they see exactly what
 // will print, never a silent cut).
 const wasTrimmed = message.length > 240;
 const truncated = wasTrimmed ? message.slice(0, 240) : message;
 const echoText = wasTrimmed
 ? `That's a little long for a postcard, so I trimmed it to fit (240 characters). Here's what'll print:\n"${truncated}"`
 : `Got it. "${truncated}"`;
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
 const sendType = (state.conversation_data?.send_type ?? "friend") as string;
 const recip = (state.conversation_data?.recipient ?? {}) as { city?: string; state?: string };
 const balanceTag = await balanceParenthetical(phone);
 const heavy = isHeavyNote(truncated);

 // Returning sender (city already on file). Acknowledge the note in
 // its own bubble first. confirms we heard them, builds the dialogue
 // beat. then drop the pre-send summary.
 if (truncated.length > 0) {
 await loopSend({ contact: phone, text: echoText });
 await sleep(550);
 }
 const composition = buildPreSendComposition({
 fromCity: knownCity,
 sendType,
 recipientName: state.conversation_data?.recipient_name,
 recipientCity: recip.city,
 note: truncated,
 });
 await loopSend({
 contact: phone,
 text: heavy
 ? `${composition}\n\nThis one feels meaningful. Tell me to send it whenever you're ready.${balanceTag}`
 : `${composition}\n\nReady? Tell me to send it, or name a day to mail it later.${balanceTag}`,
 });
 return;
 }

 // First-time sender (no city on file yet). confirm the note FIRST,
 // then ask for their address with reciprocity framing. The address
 // ask isn't "where do you live". it's "so they can write back."
 await advanceState(phone, "awaiting_sender_location", state.draft_token, { message: truncated });

 const recipName = (state.conversation_data?.recipient_name ?? "") as string;
 const recipFirst = recipName.split(/\s+/)[0] || "your friend";
 const sendType = (state.conversation_data?.send_type ?? "friend") as string;
 // Pen pal mode sets send_type "stranger" (NOT "stranger_requested" —
 // that older value never existed here, which is why this used to read
 // "so your can mail one back to you" when recipName was empty).
 const writeBackWho = sendType === "stranger" ? "your pen pal" : recipFirst;

 // Bubble 1: acknowledge the note so the user knows we heard them
 if (truncated.length > 0) {
 await loopSend({ contact: phone, text: echoText });
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
 // Fast path: a clean full address confirms instantly (no LLM). Only
 // ambiguous input hits the LLM (resolveAddress shows typing then).
 // We need line1 + city + state + zip at minimum. Used for pen pal
 // reciprocation (someone mails back to this exact address). Never
 // appears on the postcard front.
 const parsed = await resolveAddress(phone, body);
 if (!parsed || parsed.confidence < 0.7 || !parsed.line1 || !parsed.zip || !parsed.city || !parsed.state) {
 // Be SPECIFIC about what's missing. The common case is a real street
 // + city + state but no ZIP — telling them "just a city" there is
 // wrong and traps them. Name the gap and pre-fill the rest.
 let text: string;
 if (parsed && parsed.line1 && parsed.city && parsed.state && !parsed.zip) {
 text = `Almost there. I just need the ZIP code. Resend it like:\n${parsed.line1}, ${parsed.city} ${parsed.state} <ZIP>`;
 } else if (parsed && parsed.line1 && (!parsed.city || !parsed.state)) {
 text = `Got the street. I also need the city, state, and ZIP. Format: street, city, state, ZIP.\n\nE.g. "123 Main St, San Francisco CA 94102".`;
 } else {
 text = `I need the full mailing address. Format: street, city, state, ZIP.\n\nE.g. "123 Main St, San Francisco CA 94102".`;
 }
 await loopSend({ contact: phone, text });
 return;
 }
 // Resolved + complete. CONFIRM before committing — Lob may have filled
 // the ZIP or corrected the street (e.g. added a directional), so the
 // user should see + approve the exact address pen pals will write back
 // to. Stash it; the commit happens on confirm.
 await advanceState(phone, "awaiting_sender_address_confirm", state.draft_token, {
 sender_resolved: {
 line1: parsed.line1, line2: parsed.line2 || "", city: parsed.city,
 state: parsed.state, zip: parsed.zip,
 },
 });
 const senderLabel =
 `   ${parsed.line1}${parsed.line2 ? `\n   ${parsed.line2}` : ""}\n` +
 `   ${parsed.city}, ${parsed.state} ${parsed.zip}`;
 await loopSend({
 contact: phone,
 text: `Your address (where pen pals write back):\n${senderLabel}\n\nLook right? Or send a different one.`,
 });
}

async function handleSenderAddressConfirm(phone: string, body: string, state: any): Promise<void> {
 const resolved = state.conversation_data?.sender_resolved as
 { line1: string; line2: string; city: string; state: string; zip: string } | undefined;
 if (!resolved) {
 await advanceState(phone, "awaiting_sender_location", state.draft_token, {});
 await loopSend({ contact: phone, text: "Let's try that again. What's your full mailing address?" });
 return;
 }
 fireTyping(phone, 5);
 const c = await parseConfirmation(body);

 if (c.intent === "yes") {
 // Commit the private home address, then proceed to the send step.
 const { data: existing } = await admin
 .from("profiles").select("id").eq("phone", phone).maybeSingle();
 if (existing?.id) {
 await admin.from("profiles").update({
 home_line1: resolved.line1,
 home_line2: resolved.line2 || null,
 home_zip: resolved.zip,
 city: resolved.city,
 state: resolved.state,
 }).eq("id", existing.id);
 }
 await advanceState(phone, "awaiting_send_confirm", state.draft_token, {
 sender_city: resolved.city, sender_state: resolved.state,
 });
 const sendType = (state.conversation_data?.send_type ?? "friend") as string;
 const recip = (state.conversation_data?.recipient ?? {}) as { city?: string; state?: string };
 const note = (state.conversation_data?.message ?? "") as string;
 const balanceTag = await balanceParenthetical(phone);
 const heavy = isHeavyNote(note);
 const composition = buildPreSendComposition({
 fromCity: resolved.city,
 sendType,
 recipientName: state.conversation_data?.recipient_name,
 recipientCity: recip.city,
 note,
 });
 await loopSend({
 contact: phone,
 text: heavy
 ? `${composition}\n\nThis one feels meaningful. Tell me to send it whenever you're ready.${balanceTag}`
 : `${composition}\n\nReady? Tell me to send it, or name a day to mail it later.${balanceTag}`,
 });
 return;
 }

 if (c.intent === "no") {
 await advanceState(phone, "awaiting_sender_location", state.draft_token, {});
 await loopSend({ contact: phone, text: "No problem. What's the correct mailing address?" });
 return;
 }

 // Unclear — they may have typed a corrected address instead of Y/N.
 // Re-resolve it; if it's a complete address, re-confirm the new one.
 const reparsed = await resolveAddress(phone, body);
 if (reparsed && reparsed.line1 && reparsed.zip && reparsed.city && reparsed.state) {
 await advanceState(phone, "awaiting_sender_address_confirm", state.draft_token, {
 sender_resolved: {
 line1: reparsed.line1, line2: reparsed.line2 || "", city: reparsed.city,
 state: reparsed.state, zip: reparsed.zip,
 },
 });
 const reLabel =
 `   ${reparsed.line1}${reparsed.line2 ? `\n   ${reparsed.line2}` : ""}\n` +
 `   ${reparsed.city}, ${reparsed.state} ${reparsed.zip}`;
 await loopSend({
 contact: phone,
 text: `Your address (where pen pals write back):\n${reLabel}\n\nLook right? Or send a different one.`,
 });
 return;
 }
 await loopSend({ contact: phone, text: "That look right? Or just send your full mailing address." });
}

async function handleSendConfirm(phone: string, body: string, state: any): Promise<void> {
 // SEND/CANCEL hit a regex fast-path; date phrasing ("June 15") falls
 // to the LLM. Show dots so the parse never feels frozen.
 fireTyping(phone, 6);
 const c = await parseSendConfirm(body);
 if (c.intent === "cancel") {
 await resetState(phone);
 await loopSend({ contact: phone, text: "Cancelled. Send a new photo when you're ready." });
 return;
 }

 const sendType = (state.conversation_data?.send_type ?? "friend") as string;

 // Scheduling only applies to FRIEND sends. Pen pal cards ride the Sunday
 // drop; replies mail immediately. Routing those to doSchedule (which
 // needs recipient_name/recipient) used to reset with "lost the thread."
 if (c.intent === "schedule" && c.arrival_iso) {
 if (sendType === "stranger") {
 await loopSend({ contact: phone, text: "Pen pal cards go out in the next Sunday drop, so they can't be scheduled. Just tell me to send it, or say never mind." });
 return;
 }
 if (sendType === "reply_to_pen_pal") {
 await loopSend({ contact: phone, text: "Replies mail right away, so there's no scheduling. Just tell me to send it, or say never mind." });
 return;
 }
 }

 if (c.intent === "send_now" || (c.intent === "schedule" && c.arrival_iso)) {
 // ANTI-DOUBLE-SEND. A rapid second SEND is a DISTINCT message_id, so the
 // webhook dedup doesn't catch it — both would read awaiting_send_confirm
 // and create two postcards / double-charge. Atomically flip the step
 // awaiting_send_confirm → sending; Postgres UPDATE...WHERE serializes,
 // so the loser matches 0 rows and bails. resetState at the end of the
 // send clears "sending"; a mid-send failure leaves "sending", which the
 // step router's default case recovers ("Let's start fresh").
 const { data: claimed } = await admin
 .from("sms_conversation_state")
 .update({ step: "sending", updated_at: new Date().toISOString() })
 .eq("phone", phone).eq("step", "awaiting_send_confirm").select("phone");
 if (!claimed || claimed.length === 0) {
 console.log("[loop-inbound] duplicate SEND ignored (already sending)", { phone });
 return;
 }
 if (c.intent === "send_now") return await doMail(phone, state);
 return await doSchedule(phone, state, c);
 }

 await loopSend({
 contact: phone,
 text: `Just tell me to send it, name a day to mail it later ("June 15", "in 3 days"), or say never mind.`,
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
  await loopSend({ contact: phone, text: "That draft expired. Text a new photo to start over." });
  return;
 }

 // Sender setup
 let userId: string;
 try { userId = await findOrCreateUserByPhone(phone); }
 catch (e: any) {
  console.error("[loop-inbound] user create failed (stranger)", e);
  await loopSend({ contact: phone, text: "Something went wrong on our end. Try again in a minute?" });
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
   text: "First, your mailing address. Pen pals need somewhere to mail back. Format: street, city, state, ZIP.",
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
  await releaseSendClaim(phone, draftToken);
  await loopSend({ contact: phone, text: "No one in the pool right now. I'll hold your card and match you the moment someone joins." });
  return;
 }
 const matchedRecipient = Array.isArray(match) && match.length > 0 ? match[0] : null;

 // Empty pool — soft fail. No credit is burned yet (that happens in
 // send_postcard_sms_direct below), so the user can retry for free.
 // CRITICAL: keep the draft AND park the state at awaiting_send_type so
 // their next reply (a friend's name, or "penpal" to retry) actually
 // reuses this card. The old code resetState'd here, which stranded the
 // draft — the user's "Sarah" landed on idle and did nothing — and the
 // copy promised auto-matching that isn't implemented. Honest copy now.
 if (!matchedRecipient) {
  await advanceState(phone, "awaiting_send_type", draftToken, {});
  await loopSend({
   contact: phone,
   text:
    "📭 No pen pals open right now.\n\n" +
    "Your card's saved. Give me a friend's name to send it to them, or say \"penpal\" to try the pool again.",
  });
  return;
 }

 // Photo URL
 const { data: draftRow } = await admin
  .from("sms_postcard_drafts").select("photo_path").eq("token", draftToken).maybeSingle();
 if (!draftRow?.photo_path) {
  await resetState(phone);
  await loopSend({ contact: phone, text: "Couldn't read that photo. Send another?" });
  return;
 }
 let photoUrl = draftRow.photo_path;
 if (!photoUrl.startsWith("http")) {
  const { data: signed } = await admin.storage
   .from("sms-photos").createSignedUrl(photoUrl, 60 * 60 * 24 * 7);
  if (!signed?.signedUrl) {
   await loopSend({ contact: phone, text: "That photo didn't upload. Send it again?" });
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

 // SUNDAY DROP: pen pal cards queue for the next Sunday at noon UTC
 // instead of mailing immediately. The whole pool drops together,
 // creating a ritual ("this Sunday's mail just went out") that makes
 // pen pal mode feel like a club, not a transaction.
 const sundayDrop = nextSundayDropTime();
 const queuePosition = await getSundayDropQueuePosition(sundayDrop);

 // Insert via direct-address RPC with scheduled_send_at set so the
 // existing fire-scheduled-postcards cron picks it up on Sunday.
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
  p_scheduled_send_at: sundayDrop.toISOString(),  // Sunday Drop
 });
 if (rpcErr) {
  console.error("[loop-inbound] send_postcard_sms_direct failed", rpcErr);
  const oom = rpcErr.message?.includes("insufficient_credits");
  await releaseSendClaim(phone, draftToken);
  await loopSend({
   contact: phone,
   text: oom
    ? "Out of cards. Text \"buy\" to top up, then tell me to send it."
    : "Couldn't queue your card. Try sending again, or text a new photo to start over.",
  });
  return;
 }

 // NO Lob handoff yet — the cron fires it on Sunday. The card sits in
 // status='scheduled' until then.

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

 // c-bridge wraps /c/<token> with per-token OG meta tags so iMessage's
 // preview shows THIS recipient + THIS photo + THIS ETA instead of the
 // generic landing card. Real browsers get a meta-refresh to /c/<token>.
 const confirmUrl = `https://nlwnmgwylmmnaemdnzlq.supabase.co/functions/v1/c-bridge?token=${draftToken}`;
 const dropDateLabel = sundayDrop.toLocaleDateString("en-US", {
  weekday: "long", month: "short", day: "numeric",
 });
 const ordinalSuffix = (n: number) => {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
 };
 const positionLabel = `${queuePosition}${ordinalSuffix(queuePosition)}`;

 // 4-act SUNDAY DROP celebration. Different vibe than friend mode.
 // Anticipation > immediacy. The user joins a queue, the pool drops
 // together on Sunday. Effect: shootingStar (wish-like).
 //
 // Act 0 ("stamping" beat): quiet line + typing indicator turn the
 // 1-2s before the celebration from dead air into ritual.
 // Act 1: queue position (the "where am I" answer).
 // Act 2: the cadence promise ("flies Sunday").
 // Act 3: anonymous photo.
 // Act 4: the reciprocation promise.
 await loopSend({ contact: phone, text: "🪶 Joining the pool..." });
 await loopTyping(phone, 2);

 // Act 1: queue position. Standalone — the "you're #14" beat needs
 // its own breath, not crammed into a paragraph with the cadence.
 const mailedRes = await loopSend({
  contact: phone,
  subject: "🪶 In Sunday's drop",
  text: `You're the ${positionLabel} card in this week's pool.`,
  effect: "shootingStar",
  passthrough: `stranger:${postcardId}`,
 });
 // Persist the Mailed bubble's message_id so lob-webhook can thread
 // later status updates as in-thread replies.
 if (mailedRes.ok && mailedRes.messageId) {
  await admin.from("postcards").update({
   mailed_imessage_id: mailedRes.messageId,
   from_phone: phone,
  }).eq("id", postcardId);
 } else {
  await admin.from("postcards").update({ from_phone: phone }).eq("id", postcardId);
 }
 await sleep(700);

 // Act 2: the cadence. "Flies" carries the postal romance — cards
 // don't "go out," they fly. The day label closes the loop on when.
 await loopSend({
  contact: phone,
  text: `We match + mail every Sunday at noon. Yours flies ${dropDateLabel}.`,
 });
 await sleep(550);

 // Act 3: Photo — anonymous destination. "· To somewhere ·" uses
 // postal-label centering instead of console-style arrows.
 await loopSend({
  contact: phone,
  text: `· To somewhere ·`,
  attachments: [photoUrl],
 });
 await sleep(450);

 // Act 4: The promise — they'll know when the loop closes
 await loopSend({
  contact: phone,
  text: `When they write back, you'll know.\n${confirmUrl}`,
 });
}

// ===================================================================
// PEN PAL RECIPROCATION RESPONSE
// ===================================================================
// Sender is closing the loop with a recent pen pal. The pending_reply
// stash on conversation_data has all the routing info. Mails IMMEDIATELY
// (replies should feel responsive, not delayed by Sunday Drop). Marks
// the pen_pal_pairings row as reciprocated_at = now() so the loop is
// closed.
async function doMailReplyToPenPal(phone: string, state: any): Promise<void> {
 const data = state.conversation_data ?? {};
 const pendingReply = data.pending_reply as any;
 const message = (data.message ?? "") as string;
 const draftToken = state.draft_token as string;

 if (!pendingReply || !draftToken) {
  await resetState(phone);
  await loopSend({ contact: phone, text: "Couldn't find the pen pal you're replying to. Text a fresh photo to start over." });
  return;
 }

 // Sender setup
 let userId: string;
 try { userId = await findOrCreateUserByPhone(phone); }
 catch (e: any) {
  console.error("[loop-inbound] user create failed (reciprocation)", e);
  await loopSend({ contact: phone, text: "Something went wrong on our end. Try again in a minute?" });
  return;
 }

 // Sender's home city (for the from_city on the postcard back)
 const { data: senderProfile } = await admin
  .from("profiles").select("city, state").eq("id", userId).maybeSingle();
 const senderCity = senderProfile?.city ?? "";

 // Photo URL
 const { data: draftRow } = await admin
  .from("sms_postcard_drafts").select("photo_path").eq("token", draftToken).maybeSingle();
 if (!draftRow?.photo_path) {
  await resetState(phone);
  await loopSend({ contact: phone, text: "Couldn't read that photo. Send another?" });
  return;
 }
 let photoUrl = draftRow.photo_path;
 if (!photoUrl.startsWith("http")) {
  const { data: signed } = await admin.storage
   .from("sms-photos").createSignedUrl(photoUrl, 60 * 60 * 24 * 7);
  if (!signed?.signedUrl) {
   await loopSend({ contact: phone, text: "That photo didn't upload. Send it again?" });
   return;
  }
  photoUrl = signed.signedUrl;
 }

 // Same safety gate as new-stranger sends
 const mod = await moderatePhotoAndText(photoUrl, message);
 if (!mod.ok) {
  console.warn("[loop-inbound] reciprocation moderation blocked", { phone, reason: mod.reason });
  await resetState(phone);
  await loopSend({
   contact: phone,
   text:
    "📵 We can't send this to your pen pal.\n\n" +
    "Pen pal cards go through the mail to someone we've never met. Try a different photo or note.",
  });
  return;
 }

 // Insert via direct RPC. NOT scheduled — replies mail immediately so
 // they feel responsive (you replied, your card goes out today).
 const { data: postcardId, error: rpcErr } = await admin.rpc("send_postcard_sms_direct", {
  p_user_id: userId,
  p_message: message,
  p_photo_path: photoUrl,
  p_to_line1: pendingReply.sender_line1,
  p_to_line2: pendingReply.sender_line2,
  p_to_city: pendingReply.sender_city,
  p_to_state: pendingReply.sender_state,
  p_to_zip: pendingReply.sender_zip,
  p_from_city: senderCity,
 });
 if (rpcErr) {
  console.error("[loop-inbound] send_postcard_sms_direct failed (reciprocation)", rpcErr);
  const oom = rpcErr.message?.includes("insufficient_credits");
  await releaseSendClaim(phone, draftToken);
  await loopSend({
   contact: phone,
   text: oom
    ? "Out of cards. Text \"buy\" to top up, then tell me to send it."
    : "Couldn't print your reply. Tell me to send it again.",
  });
  return;
 }

 // Lob handoff
 const lob = await submitToLob(postcardId as string);
 if (!lob.ok) {
  const { data: cur } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
  await admin.from("profiles").update({ credits: (cur?.credits ?? 0) + 1 }).eq("id", userId);
  await admin.from("postcards").delete().eq("id", postcardId);
  console.error("[loop-inbound] Lob failed (reciprocation)", lob.error);
  await releaseSendClaim(phone, draftToken);
  await loopSend({
   contact: phone,
   text: `Couldn't print your card (${lob.error?.slice(0, 60)}). Your credit's back. Tell me to send it again.`,
  });
  return;
 }

 // Close the loop in the pairings table.
 //
 // Two paths get here:
 //   a) Organic reply: user got a pen pal card, texted a NEW photo, the
 //      bot offered them the active-reply path via findUnreciprocatedPairing.
 //      pairing_id is set — close that exact row.
 //   b) REPLY CODE: stranger scanned the QR, no prior pairing row in
 //      THIS user's recipient_id. pairing_id is null. Look up the
 //      open pairing where the OTHER side is sender (the original
 //      pen pal) and THIS user is recipient, close it. Falls through
 //      silently if no row (e.g., the original card was friend-mode,
 //      not pen pal).
 if (pendingReply.pairing_id) {
  await admin
   .from("pen_pal_pairings")
   .update({ reciprocated_at: new Date().toISOString() })
   .eq("id", pendingReply.pairing_id);
 } else {
  await admin
   .from("pen_pal_pairings")
   .update({ reciprocated_at: new Date().toISOString() })
   .eq("sender_id", pendingReply.sender_id)
   .eq("recipient_id", userId)
   .is("reciprocated_at", null);
 }

 // Create a NEW pairing for the reverse direction so the original
 // sender's NEXT photo session surfaces "this person wrote you back —
 // want to keep the conversation going?" Without this row, the loop
 // ends at one round-trip.
 //
 // ON CONFLICT DO NOTHING in case both sides race (organic reply +
 // REPLY CODE arrival around the same time).
 await admin
  .from("pen_pal_pairings")
  .insert({
   sender_id: userId,
   recipient_id: pendingReply.sender_id,
   postcard_id: postcardId as string,
   paired_at: new Date().toISOString(),
   reciprocated_at: null,
  })
  .select()
  .maybeSingle();

 // Consume the draft + reset
 await admin.rpc("consume_sms_draft", { p_token: draftToken, p_postcard_id: postcardId });
 await resetState(phone);

 const eta = lob.expectedDelivery
  ? new Date(lob.expectedDelivery).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  : "in 3-5 days";
 // c-bridge wraps /c/<token> with per-token OG meta tags so iMessage's
 // preview shows THIS recipient + THIS photo + THIS ETA instead of the
 // generic landing card. Real browsers get a meta-refresh to /c/<token>.
 const confirmUrl = `https://nlwnmgwylmmnaemdnzlq.supabase.co/functions/v1/c-bridge?token=${draftToken}`;
 const senderFirstName = pendingReply.sender_first_name;

 // 4-act reciprocation celebration. Effect: love (closing a loop is
 // intimate). Act 0 stamping beat turns the wait into ritual.
 await loopSend({ contact: phone, text: "💌 Stamping the reply..." });
 await loopTyping(phone, 2);

 // Sender's home city for the FROM-STATION cancellation line.
 const senderProfileForStation = await admin
   .from("profiles").select("city").eq("id", userId).maybeSingle();
 const senderStationCity = senderProfileForStation.data?.city ?? "";
 const stationLine = senderStationCity
   ? `${senderStationCity.toUpperCase()} STATION\n\n`
   : "";

 const postmarkDate = new Date().toLocaleDateString("en-US", {
  month: "short", day: "numeric", year: "numeric",
 }).toUpperCase();
 const mailedRes = await loopSend({
  contact: phone,
  subject: "💌 Postmarked",
  text: `POSTMARKED · ${postmarkDate}\n${stationLine}Off to ${senderFirstName}.`,
  effect: "love",
  passthrough: `reciprocation:${postcardId}`,
 });
 if (mailedRes.ok && mailedRes.messageId) {
  await admin.from("postcards").update({
   mailed_imessage_id: mailedRes.messageId,
   from_phone: phone,
  }).eq("id", postcardId);
 } else {
  await admin.from("postcards").update({ from_phone: phone }).eq("id", postcardId);
 }
 await sleep(700);

 // Gallery: [their photo, card flip, native route map]. Same
 // three-part story as a fresh send (see buildCelebrationGallery).
 const gallery = buildCelebrationGallery(lob, photoUrl);
 await loopSend({
  contact: phone,
  text: routeCaption(pendingReply.sender_city || "them", lob.routeMiles),
  attachments: gallery,
 });
 await sleep(450);

 await loopSend({
  contact: phone,
  text: `Lands in ${senderFirstName}'s mailbox ${eta}.\n${confirmUrl}`,
 });

 // PEN-PAL REVEAL. The loop just closed: this sender wrote back to the
 // original pen pal. Push that original sender a heads-up NOW so the
 // reply becomes an anticipated event, not just a surprise envelope days
 // later. Fire-and-forget: never block or fail this celebration on it.
 // We reveal only the writer's CITY (the same return label they'll see
 // on the physical card), preserving the mystery. Skipped when the
 // original sender has no phone, or is the same phone (self-reply / a
 // single tester playing both sides).
 try {
  const { data: original } = await admin
   .from("profiles").select("phone").eq("id", pendingReply.sender_id).maybeSingle();
  if (original?.phone && original.phone !== phone) {
   const fromCityBit = senderStationCity ? ` in ${senderStationCity}` : "";
   await loopSend({
    contact: original.phone,
    subject: "💌 A reply is on its way",
    text: `Someone${fromCityBit} just wrote you back. Their card is heading to your mailbox now.`,
    effect: "confetti",
   });
  }
 } catch (e: any) {
  console.warn("[loop-inbound] pen pal reveal failed (non-fatal)", e?.message ?? e);
 }
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

 // Reciprocation reply. Sender is writing back to a recent pen pal.
 // All routing cached in conversation_data.pending_reply. Mails
 // immediately (replies should feel responsive, not queued).
 if (sendType === "reply_to_pen_pal") {
   return await doMailReplyToPenPal(phone, state);
 }

 const recipientName = data.recipient_name as string;
 const recipient = data.recipient as { line1: string; line2: string; city: string; state: string; zip: string };
 // SKIP-path bug fix (codex caught): empty-string message is VALID
 // (user texted SKIP). Use null/undefined check, not truthiness.
 if (!recipientName || !recipient || message == null || !draftToken) {
 await resetState(phone);
 await loopSend({ contact: phone, text: "That draft expired. Text a new photo to start over." });
 return;
 }

 let userId: string;
 try { userId = await findOrCreateUserByPhone(phone); }
 catch (e: any) {
 console.error("[loop-inbound] user create failed", e);
 await loopSend({ contact: phone, text: "Something went wrong on our end. Try again in a minute?" });
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
 await loopSend({ contact: phone, text: "Couldn't save that. Try once more?" });
 return;
 }

 const { data: draftRow } = await admin
 .from("sms_postcard_drafts").select("photo_path").eq("token", draftToken).maybeSingle();
 if (!draftRow?.photo_path) {
 await resetState(phone);
 await loopSend({ contact: phone, text: "Couldn't read that photo. Send another?" });
 return;
 }
 let photoUrl = draftRow.photo_path;
 if (!photoUrl.startsWith("http")) {
 const { data: signed } = await admin.storage
 .from("sms-photos").createSignedUrl(photoUrl, 60 * 60 * 24 * 7);
 if (!signed?.signedUrl) {
 await loopSend({ contact: phone, text: "That photo didn't upload. Send it again?" });
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
 await releaseSendClaim(phone, draftToken);
 await loopSend({
 contact: phone,
 text: oom
 ? "Out of cards. Text \"buy\" to top up, then tell me to send it."
 : "Couldn't print your card. Try sending again, or text a new photo to start over.",
 });
 return;
 }

 const lob = await submitToLob(postcardId as string);
 if (!lob.ok) {
 const { data: cur } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
 await admin.from("profiles").update({ credits: (cur?.credits ?? 0) + 1 }).eq("id", userId);
 await admin.from("postcards").delete().eq("id", postcardId);
 console.error("[loop-inbound] Lob failed", lob.error);
 await releaseSendClaim(phone, draftToken);
 await loopSend({
 contact: phone,
 text: `The press is jammed (${lob.error?.slice(0, 60)}). Credit refunded. Just tell me to send it again.`,
 });
 return;
 }

 await admin.rpc("consume_sms_draft", { p_token: draftToken, p_postcard_id: postcardId });
 await resetState(phone);

 const eta = lob.expectedDelivery
 ? new Date(lob.expectedDelivery).toLocaleDateString("en-US", { month: "short", day: "numeric" })
 : "in 3-5 days";
 // c-bridge wraps /c/<token> with per-token OG meta tags so iMessage's
 // preview shows THIS recipient + THIS photo + THIS ETA instead of the
 // generic landing card. Real browsers get a meta-refresh to /c/<token>.
 const confirmUrl = `https://nlwnmgwylmmnaemdnzlq.supabase.co/functions/v1/c-bridge?token=${draftToken}`;
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

 // Act 0. STAMPING BEAT. The 6-8s of Lob + GIF rendering would
 // otherwise be dead air. One quiet bubble + typing indicator turn
 // dead air into ritual: "ah, my card is being stamped right now."
 await loopSend({ contact: phone, text: "📮 Stamping..." });
 await loopTyping(phone, 2);

 // Act 1. THE MOMENT (effect picked from note's emotional content)
 // Postmark line is the aesthetic anchor. Reads like a real cancellation
 // stamp. CAPS + center dot separator. The user comes back to the
 // thread a week later and sees the exact date their card was stamped.
 // The FROM-city STATION line under the date evokes a real postal
 // station cancellation mark ("CHICAGO STATION · MAY 29, 2026").
 // "Off to Sarah" (past tense, in motion) beats "is in the mail"
 // (passive, administrative).
 const effect = pickEffectForNote(message);
 const firstName = recipientName.split(/\s+/)[0];
 const postmarkDate = new Date().toLocaleDateString("en-US", {
   month: "short", day: "numeric", year: "numeric",
 }).toUpperCase();
 const stationLine = senderCity
   ? `${senderCity.toUpperCase()} STATION\n\n`
   : "";
 const mailedRes = await loopSend({
 contact: phone,
 subject: "📮 Postmarked",
 text: `POSTMARKED · ${postmarkDate}\n${stationLine}Off to ${firstName}.`,
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

 // Act 2. THE GALLERY — the three-part story, inline in the thread,
 // no link tap required:
 //   1. their photo       (the human moment — full-bleed original)
 //   2. the card flip     (the artifact — front w/ photo ↔ back w/ note)
 //   3. the route map     (the journey — native Apple Maps snapshot)
 // Each tile degrades independently: no flip → static front+back;
 // no map → drop the third tile; no thumbnails at all → just photo.
 const gallery = buildCelebrationGallery(lob, photoUrl);
 await loopSend({
 contact: phone,
 text: routeCaption(recipLocLabel, lob.routeMiles),
 attachments: gallery,
 });
 await sleep(450);

 // Act 3. THE PROMISE — put the recipient in the frame. "Lands in
 // Sarah's mailbox Jun 3" beats "Arrives Jun 3" because it makes
 // the recipient's experience visible to the sender.
 //
 // Tail priority: BUY nudges (urgent — they're out of credits) WIN
 // over MEMORIES nudges (discovery). After the 3rd card a sender
 // crosses into "regular" territory — that's the right moment to
 // unlock the MEMORIES word.
 let tail = "";
 if (remaining <= 0) {
   tail = `\n\nLast one. Text "buy" for more.`;
 } else if (remaining <= 2) {
   tail = `\n\n${remaining} left. Reply BUY for more.`;
 } else {
   const { count: sentCount } = await admin
     .from("postcards")
     .select("id", { count: "exact", head: true })
     .eq("sender_id", userId);
   if (sentCount === 3) {
     tail = `\n\nThat's three cards from you. Text MEMORIES anytime to see them.`;
   }
 }
 await loopSend({
 contact: phone,
 text: `Lands in ${firstName}'s mailbox ${eta}.\n${confirmUrl}${tail}`,
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
 await loopSend({ contact: phone, text: "That draft expired. Text a new photo to start over." });
 return;
 }
 const arrival = new Date(schedule.arrival_iso + "T12:00:00Z");
 const sendAt = new Date(arrival.getTime() - 7 * 24 * 60 * 60 * 1000);
 if (sendAt.getTime() < Date.now() + 24 * 60 * 60 * 1000) {
 const arrivalLabel = arrival.toLocaleDateString("en-US", { month: "short", day: "numeric" });
 // Release the send claim so "SEND now" / a later date actually works.
 await releaseSendClaim(phone, state.draft_token);
 await loopSend({
 contact: phone,
 text: `${arrivalLabel} is too soon. Mail takes ~7 days. Tell me to send it now, or pick a later date.`,
 });
 return;
 }

 let userId: string;
 try { userId = await findOrCreateUserByPhone(phone); }
 catch (e: any) {
 console.error("[loop-inbound] user create failed (schedule)", e);
 await loopSend({ contact: phone, text: "Something went wrong on our end. Try again in a minute?" });
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
 await loopSend({ contact: phone, text: "Couldn't save that. Try once more?" });
 return;
 }

 const { data: draftRow } = await admin
 .from("sms_postcard_drafts").select("photo_path").eq("token", draftToken).maybeSingle();
 if (!draftRow?.photo_path) {
 await resetState(phone);
 await loopSend({ contact: phone, text: "Couldn't read that photo. Send another?" });
 return;
 }
 let photoUrl = draftRow.photo_path;
 if (!photoUrl.startsWith("http")) {
 const { data: signed } = await admin.storage
 .from("sms-photos").createSignedUrl(photoUrl, 60 * 60 * 24 * 30);
 if (!signed?.signedUrl) {
 await loopSend({ contact: phone, text: "That photo didn't upload. Send it again?" });
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
 await releaseSendClaim(phone, state.draft_token);
 await loopSend({
 contact: phone,
 text: oom
 ? "Out of cards. Text \"buy\" to top up, then pick your date again."
 : "Couldn't schedule your card. Try again, or text a new photo.",
 });
 return;
 }

 await admin.rpc("consume_sms_draft", { p_token: draftToken, p_postcard_id: postcardId });
 await resetState(phone);
 const sendDateFmt = sendAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
 const arrivalFmt = arrival.toLocaleDateString("en-US", { month: "short", day: "numeric" });
 // c-bridge wraps /c/<token> with per-token OG meta tags so iMessage's
 // preview shows THIS recipient + THIS photo + THIS ETA instead of the
 // generic landing card. Real browsers get a meta-refresh to /c/<token>.
 const confirmUrl = `https://nlwnmgwylmmnaemdnzlq.supabase.co/functions/v1/c-bridge?token=${draftToken}`;
 const recipLocLabel = [recipient.city, recipient.state].filter(Boolean).join(", ") || "their address";

 // ===================================================================
 // SCHEDULED CELEBRATION. 4-act choreography. Effect: gentle (not
 // balloons — balloons is for IMMEDIATE celebration; scheduling
 // creates anticipation, not party). Act 0 stamping beat turns the
 // brief wait into a "saving it" moment.
 // ===================================================================

 await loopSend({ contact: phone, text: "🗓️ Saving for later..." });
 await loopTyping(phone, 2);

 // Act 1. THE COMMITMENT — date IS the subject. Body adds the
 // promise that we'll text when it goes. Reframes "scheduled" from
 // calendar entry to social pact.
 const firstNameSched = recipientName.split(/\s+/)[0];
 await loopSend({
 contact: phone,
 subject: `🗓️ Saved for ${sendDateFmt}`,
 text: `Card to ${firstNameSched} ships ${sendDateFmt}.\nWe'll text you when it goes.`,
 effect: "gentle",
 passthrough: `scheduled:${postcardId}`,
 });
 await sleep(700);

 // Act 2. THE PROOF — postal-label centering (no console arrow),
 // recipient mailbox framing on arrival side.
 await loopSend({
 contact: phone,
 text: `· To ${recipLocLabel} ·\nLands in ${firstNameSched}'s mailbox ~${arrivalFmt}`,
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

 // IDEMPOTENCY. LoopMessage is at-least-once: the same message_inbound can
 // arrive twice. Record message_id; a unique-violation (23505) means we've
 // already handled it, so ACK and skip. Without this, a redelivered photo
 // makes two drafts + two replies, and a redelivered SEND double-charges.
 if (payload.message_id) {
 const { error: dupErr } = await admin
 .from("loop_inbound_dedup")
 .insert({ message_id: payload.message_id });
 if (dupErr) {
 if ((dupErr as any).code === "23505") {
 console.log("[loop-inbound] duplicate webhook, skipping", { message_id: payload.message_id });
 return new Response(JSON.stringify({ ok: true, deduped: true }), {
 status: 200, headers: { "Content-Type": "application/json" },
 });
 }
 // Non-duplicate DB error: log but proceed (don't drop a real message).
 console.warn("[loop-inbound] dedup insert error (proceeding)", (dupErr as any).message ?? dupErr);
 }
 }

 // Route through the state machine. Run async so we can ACK fast. LoopMessage
 // expects 200 within 15s, and the state machine + OpenAI calls + Lob handoff
 // can take longer than that.
 //
 // PHOTO GATE: accept an attachment whenever one is present, EXCEPT for the
 // explicit non-photo message types (audio clip, sticker, shared location,
 // reaction) which also carry attachment URLs we must not mail as a photo.
 // We intentionally do NOT require message_type === "attachments":
 // LoopMessage does not reliably set that for image messages (it's often
 // undefined), and requiring it silently dropped real photos.
 const NON_PHOTO_TYPES = new Set(["reaction", "audio", "sticker", "location"]);
 const hasAttachment = (payload.attachments?.length ?? 0) > 0;
 const isPhotoMessage = hasAttachment && !NON_PHOTO_TYPES.has(payload.message_type ?? "");
 const ctx: InboundCtx = {
 from: payload.contact,
 body: payload.text ?? "",
 attachments: isPhotoMessage ? (payload.attachments ?? []) : [],
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
 text: `Something broke on our end. (debug: ${errMsg.slice(0, 100)}) Try again, or say "start over" to reset.`,
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
