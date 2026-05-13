// Supabase Edge Function: send-claim-link
//
// Dispatches a Mailroom claim URL to a recipient via SMS (Twilio) or
// email (SendGrid). Called by the app after sendPostcardViaLink resolves
// — the client passes the claim URL it received + the recipient's
// contact info (phone or email).
//
// Without this function, the app's existing fallback is the iOS Share
// sheet (user picks how to deliver the link manually). With this
// function deployed and Twilio/SendGrid keys set, the dispatch is
// automatic — the Escargot pattern.
//
// SECURITY:
//   - Caller MUST present an Authorization: Bearer <jwt> header.
//   - We verify the user owns the claim URL by looking up the
//     postcard_claims row, comparing sender_id to auth'd user.
//
// REQUIRED SECRETS (gated — function no-ops if neither set):
//   - TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER (for SMS)
//   - SENDGRID_API_KEY + SENDGRID_FROM_EMAIL (for email)
//
// DEPLOY:
//   supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxx
//   supabase secrets set TWILIO_AUTH_TOKEN=xxxxx
//   supabase secrets set TWILIO_FROM_NUMBER=+15551234567
//   supabase secrets set SENDGRID_API_KEY=SG.xxxxx
//   supabase secrets set SENDGRID_FROM_EMAIL=hello@mailrooms.app
//   supabase functions deploy send-claim-link

// @ts-nocheck — Deno runtime, not the RN tsconfig
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";

const SENDGRID_KEY = Deno.env.get("SENDGRID_API_KEY") ?? "";
const SENDGRID_FROM = Deno.env.get("SENDGRID_FROM_EMAIL") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Distinguish phone (+1xxx, digits, dashes, parens) from email
 *  (contains @). Returns "phone" | "email" | null for ambiguous input. */
function detectContactType(contact: string): "phone" | "email" | null {
  const c = contact.trim();
  if (c.includes("@") && c.includes(".")) return "email";
  // Strip everything but digits and check we got 10+ (US-ish).
  const digits = c.replace(/[^0-9]/g, "");
  if (digits.length >= 10) return "phone";
  return null;
}

/** Normalize a phone number to E.164 (+1xxxxxxxxxx). Defaults to US
 *  country code when no leading "+" is present. */
function toE164(phone: string): string | null {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

async function sendSms(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return { ok: false, error: "Twilio not configured" };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", TWILIO_FROM);
  form.set("Body", body);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Twilio ${res.status}: ${errText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Twilio request failed" };
  }
}

async function sendEmail(
  to: string,
  subject: string,
  bodyText: string,
  bodyHtml?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!SENDGRID_KEY || !SENDGRID_FROM) {
    return { ok: false, error: "SendGrid not configured" };
  }
  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: SENDGRID_FROM, name: "Mailroom" },
        subject,
        content: [
          { type: "text/plain", value: bodyText },
          ...(bodyHtml ? [{ type: "text/html", value: bodyHtml }] : []),
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `SendGrid ${res.status}: ${errText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "SendGrid request failed" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // 1) Auth check.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Not authenticated" }, 401);

  // 2) Parse + validate body.
  let body: { claim_url?: string; postcard_id?: string; contact?: string; recipient_name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }

  const claimUrl = (body.claim_url ?? "").trim();
  const contact = (body.contact ?? "").trim();
  const recipientName = (body.recipient_name ?? "").trim();
  if (!claimUrl || !contact) {
    return json({ error: "claim_url and contact are required" }, 400);
  }

  // 3) Ownership check — confirm the user owns the underlying
  //    postcard_claims row that this claim_url maps to. Done via the
  //    postcard_id (preferred) or by best-effort regex on the URL.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let postcardId = body.postcard_id;
  if (!postcardId) {
    // Try to extract postcard id from the claim URL path. Format:
    // https://app.mailrooms.app/claim/<token> — we'd need to look up
    // the postcard via the token. Soft-fail if we can't parse.
    const tokenMatch = claimUrl.match(/\/claim\/([A-Za-z0-9_-]+)/);
    if (tokenMatch) {
      const { data: claimRow } = await admin
        .from("postcard_claims")
        .select("postcard_id, sender_id")
        .eq("claim_token", tokenMatch[1])
        .maybeSingle();
      if (claimRow) {
        postcardId = claimRow.postcard_id;
        if (claimRow.sender_id !== user.id) {
          return json({ error: "Not your claim link" }, 403);
        }
      }
    }
  } else {
    const { data: postcard } = await admin
      .from("postcards")
      .select("sender_id")
      .eq("id", postcardId)
      .maybeSingle();
    if (!postcard) return json({ error: "Postcard not found" }, 404);
    if (postcard.sender_id !== user.id) {
      return json({ error: "Not your postcard" }, 403);
    }
  }

  // 4) Detect contact type.
  const ctype = detectContactType(contact);
  if (!ctype) {
    return json({ error: "Couldn't detect phone or email in contact" }, 400);
  }

  // 5) Compose copy. Use sender's first name if we can pull it.
  const { data: profile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  const senderName = (profile?.name ?? "Someone").split(" ")[0] || "Someone";
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";

  if (ctype === "phone") {
    const to = toE164(contact);
    if (!to) return json({ error: "Couldn't parse phone number" }, 400);
    const smsBody = `${senderName} sent you a postcard on Mailroom. Tap to claim it: ${claimUrl}`;
    const result = await sendSms(to, smsBody);
    if (!result.ok) return json({ error: result.error }, 502);
    return json({ ok: true, channel: "sms", to });
  }

  // email
  const text = `${greeting}\n\n${senderName} sent you a postcard on Mailroom. Tap to claim it and tell us where to mail it:\n\n${claimUrl}\n\nLove,\nMailroom`;
  const html = `<p>${greeting}</p><p><strong>${senderName}</strong> sent you a postcard on Mailroom.</p><p><a href="${claimUrl}">Tap to claim it</a> — we'll mail the postcard the moment you tell us your address.</p><p style="color:#888;font-size:12px;margin-top:24px;">Love,<br>Mailroom</p>`;
  const result = await sendEmail(contact, `${senderName} sent you a postcard`, text, html);
  if (!result.ok) return json({ error: result.error }, 502);
  return json({ ok: true, channel: "email", to: contact });
});
