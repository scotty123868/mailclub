// sms-inbound — conversational state machine for SMS-only postcard flow.
//
// v1.2: rewrote from "MMS → magic link" into "MMS → SMS conversation → mailed".
// The user texts a photo, then we walk them through composing the whole card
// via back-and-forth SMS. No web wizard required.
//
// Conversation states (full table in sms_conversation_state.step):
//
//   idle
//     ↓ (user texts photo)
//   awaiting_recipient_name
//     ↓ (user texts a name)
//   awaiting_recipient_address
//     ↓ (user texts an address, we parse via GPT-4o-mini)
//   awaiting_address_confirm
//     ↓ (user texts Y/yes/etc, parsed via LLM)
//   awaiting_message
//     ↓ (user texts the note)
//   awaiting_send_confirm
//     ↓ (user texts SEND, parsed via LLM)
//   → submit to Lob → reply with confirmation → reset to idle
//
// At ANY step:
//   - Texting a new photo restarts the conversation with a fresh draft.
//   - Texting CANCEL / STOP / RESTART resets to idle.
//
// Deploy: `supabase functions deploy sms-inbound --no-verify-jwt`
//
// Env vars (set via supabase secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
//   OPENAI_API_KEY               (for response parsing via gpt-4o-mini)
//   MAILROOM_INTERNAL_SECRET     (for Lob handoff via lob-send-postcard)
//   SMS_INBOUND_SKIP_VERIFY=true (temp until A2P approves — bypasses Twilio
//                                 signature check that's mismatching due to
//                                 host-header rewrite in Supabase Edge runtime)

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// First-card-free baseline — matches WelcomeSheet's iOS-app default so SMS
// signups and iOS signups get the same starting balance.
const FREE_CREDITS_NEW_USER = 1;

// =============================================================================
// Twilio helpers
// =============================================================================

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
// LLM parsing — GPT-4o-mini via OpenAI API
// =============================================================================

interface ParsedAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  confidence: number;          // 0-1, model's self-rated certainty
  formatted: string;            // human-readable for confirm prompt
}

interface ParsedConfirm {
  intent: "yes" | "no" | "unclear";
}

interface ParsedLocation {
  city: string;
  state: string;          // 2-letter
  confidence: number;     // 0-1
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
  if (/^(y|yes|yep|yeah|yas|sure|ok|okay|confirm|confirmed|send|ship|do it|go|👍|✅|🚀)$/i.test(trimmed)) {
    return { intent: "yes" };
  }
  if (/^(n|no|nope|nah|cancel|stop|wait)$/i.test(trimmed)) {
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
  // Hardcoded anon key — Supabase Edge no longer exposes SUPABASE_ANON_KEY env.
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

// Detect "start over" intent — single source of truth for restart commands.
function isRestartCommand(body: string): boolean {
  return /^(cancel|stop|restart|reset|start over|nevermind|never mind)$/i.test(body.trim());
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

  // Pull current state.
  const state = await getConversationState(from);

  switch (state.step) {
    case "idle":
      return twiml(
        "Please send a photo to get started. We'll turn it into a real paper postcard — first one's free."
      );

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
      // Shouldn't happen — defensive reset.
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
  // verified_phone immediately since this IS the verified phone — we're
  // OTP-equivalent because they texted us from their own number.
  await admin.from("sms_postcard_drafts").insert({
    token, from_phone: phone, caption: "",
    photo_path: upload.path, twilio_media_url: mediaUrl,
    verified_phone: phone,
  });
  // Reset conversation state + advance to awaiting_recipient_name.
  await advanceState(phone, "awaiting_recipient_name", token, {});
  return twiml(
    "Got your photo! Who's this postcard for? Reply with their name."
  );
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
    `Got it — to ${name}. What's their full address? You can send it one line ` +
    `like "123 Main St, Naples FL 34101" — we'll figure it out.`
  );
}

async function handleRecipientAddress(
  phone: string, body: string, state: any,
): Promise<Response> {
  const parsed = await parseAddress(body);
  if (!parsed || parsed.confidence < 0.7 || !parsed.line1 || !parsed.zip) {
    return twiml(
      "I had trouble with that address. Try again with street, city, state, and ZIP — " +
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
    `Reply Y to confirm or send the correct address.`
  );
}

async function handleAddressConfirm(
  phone: string, body: string, state: any,
): Promise<Response> {
  const confirm = await parseConfirmation(body);
  if (confirm.intent === "yes") {
    await advanceState(phone, "awaiting_message", state.draft_token, {});
    return twiml("What should the postcard say? Reply with your note (240 characters max).");
  }
  if (confirm.intent === "no") {
    await advanceState(phone, "awaiting_recipient_address", state.draft_token, {});
    return twiml("OK — send me the correct address.");
  }
  return twiml("Reply Y to confirm the address, or send the correct one.");
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
  // ask for it — we need it for the post-SEND delivery map confirmation
  // page that animates "your city → recipient's mailbox".
  const { data: profile } = await admin
    .from("profiles").select("city, state").eq("phone", phone).maybeSingle();
  const knownCity = (profile?.city ?? "").trim();
  const knownState = (profile?.state ?? "").trim();

  if (knownCity && knownState) {
    // Skip — already on file.
    await advanceState(phone, "awaiting_send_confirm", state.draft_token, {
      message: truncated,
    });
    const recipientName = (state.conversation_data?.recipient_name ?? "your friend") as string;
    return twiml(
      `Ready to mail. Your note to ${recipientName}: "${truncated}". ` +
      `Reply SEND to mail it (first card free) or CANCEL.`
    );
  }

  await advanceState(phone, "awaiting_sender_location", state.draft_token, {
    message: truncated,
  });
  return twiml(
    `Last thing: where are you texting from? Just your city + state (e.g. ` +
    `"Bethesda, MD"). Goes on the back as your return address.`
  );
}

async function handleSenderLocation(
  phone: string, body: string, state: any,
): Promise<Response> {
  const parsed = await parseLocation(body);
  if (!parsed || parsed.confidence < 0.6 || !parsed.city || !parsed.state) {
    return twiml(
      `I didn't catch a city. Try again — just "City, ST" works ` +
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
  const note = (state.conversation_data?.message ?? "") as string;
  return twiml(
    `Got it — from ${parsed.city}, ${parsed.state}. Ready to mail to ${recipientName}: ` +
    `"${note}". Reply SEND to mail it (first card free) or CANCEL.`
  );
}

async function handleSendConfirm(
  phone: string, body: string, state: any,
): Promise<Response> {
  const confirm = await parseConfirmation(body);
  if (confirm.intent === "no") {
    await resetState(phone);
    return twiml("Cancelled. Send a new photo when you're ready.");
  }
  if (confirm.intent !== "yes") {
    return twiml("Reply SEND to mail your postcard, or CANCEL to drop it.");
  }

  // Confirmed. Run the actual mail flow.
  return await doMail(phone, state);
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
  //    fall back to the profile we updated in handleSenderLocation, fall
  //    back to empty (cards back will just show the recipient address +
  //    a Mailroom return).
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
      ? "You're out of free credits. Card packs are coming soon."
      : "Couldn't mail your card. Try SEND again or text a new photo to start over.");
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
    // Don't reset state — let user retry SEND.
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
  // — the /c/<token> page reads the draft → postcard_id → renders.
  const confirmUrl = `https://app.themailroom.club/c/${draftToken}`;

  return twiml(
    `Mailed! 📮 Your card to ${recipientName} arrives ${eta}. ` +
    `See it travel: ${confirmUrl}`
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
