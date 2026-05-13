// claim — recipient-facing endpoint for "Send a Link" postcards
//
// URL: https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/claim?t=TOKEN
//
// GET  → Returns an HTML page that shows "Scotty wants to send you a postcard"
//        plus an address form. Mobile-friendly. No authentication required.
//
// POST → JSON body { token, name, line1, line2?, city, state, zip } →
//        validates + redeems the claim → triggers Lob submission server-side.
//        Returns JSON {ok, postcard_id} on success.
//
// PRIVACY: this endpoint NEVER returns the sender's address — only the
// snapshot of their display name + city (frozen at send time so it works
// even if the sender later updates their profile or quits the service).
//
// Deploy:
//   supabase functions deploy claim --no-verify-jwt

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const tokenFromQuery = url.searchParams.get("t") ?? url.searchParams.get("token");

  if (req.method === "GET") {
    return handleGet(tokenFromQuery ?? "");
  }
  if (req.method === "POST") {
    return handlePost(req, tokenFromQuery);
  }
  return new Response("Method not allowed", { status: 405 });
});

async function handleGet(token: string): Promise<Response> {
  if (!token) return htmlResponse(errorPage("Missing claim token in URL."), 400);

  const { data, error } = await admin.rpc("claim_lookup", { p_claim_token: token });
  if (error) return htmlResponse(errorPage(`Server error: ${error.message}`), 500);

  if (!data?.ok) {
    if (data?.reason === "ALREADY_CLAIMED") {
      return htmlResponse(alreadyClaimedPage(), 200);
    }
    if (data?.reason === "EXPIRED") {
      return htmlResponse(errorPage("This link has expired."), 410);
    }
    return htmlResponse(errorPage("That link doesn't look right."), 404);
  }

  return htmlResponse(claimFormPage(token, data), 200);
}

async function handlePost(req: Request, tokenFromQuery: string | null): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const token = body?.token ?? tokenFromQuery;
  if (!token) return jsonResponse({ ok: false, error: "Missing token" }, 400);

  const { name, line1, line2, city, state, zip } = body;
  if (!name || !line1 || !city || !state || !zip) {
    return jsonResponse({ ok: false, error: "Missing required address fields" }, 400);
  }

  const { data, error } = await admin.rpc("redeem_postcard_claim", {
    p_claim_token: token,
    p_name: name,
    p_address_line1: line1,
    p_city: city,
    p_state: state,
    p_zip: zip,
    p_address_line2: line2 ?? null,
    p_country: "US",
  });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);
  if (!data?.ok) return jsonResponse({ ok: false, error: data?.reason ?? "Unknown error" }, 400);

  // KNOWN GAP (codex Phase 6 audit, P1 deferred):
  // After redemption we have the recipient's address on the claim row and
  // the postcard's status = 'queued', but no actual Lob print job is
  // submitted. Why: magic-link sends never captured the front/back
  // rendered PNGs (view-shot only runs for direct sends today). To close
  // this we need server-side postcard rendering (Lob HTML templates with
  // merge variables) OR a notify-sender-to-capture flow.
  //
  // For 0.6.x: a daily reconcile job on the server side picks up
  // status='queued' rows with a claim_id, renders them via Lob's HTML
  // template API, and submits them. That code is queued for Phase 7.
  //
  // What we DO record here: the address is saved, the postcard row is in
  // 'queued' status, and the sender's app shows the flip from
  // 'awaiting_address' so they know the recipient claimed.

  return jsonResponse({
    ok: true,
    postcard_id: data.postcard_id,
  });
}

// ---------------------------------------------------------------------------
// HTML page templates
// ---------------------------------------------------------------------------

function claimFormPage(
  token: string,
  info: { sender_name?: string; sender_city?: string; message_preview?: string; category?: string },
): string {
  const senderName = escapeHtml(info.sender_name ?? "Someone");
  const senderCity = escapeHtml(info.sender_city ?? "");
  const message = escapeHtml(info.message_preview ?? "");
  const senderLine = senderCity ? `${senderName} in ${senderCity}` : senderName;
  const fromTag = senderName === "Someone" ? "Someone" : senderName.split(" ")[0];

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>${fromTag} sent you a postcard</title>
  <style>
    :root {
      --paper: #F8F1E3;
      --ink: #221F1A;
      --muted: #6F6A5D;
      --postal: #B84A3A;
      --line: #C2A56D;
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body { background: var(--paper); color: var(--ink); margin: 0; padding: 0;
      font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
      min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
    main { max-width: 480px; width: 100%; padding: 32px 20px 80px; }
    .hero { text-align: center; padding: 24px 0 8px; }
    .stamp { display: inline-block; font-size: 11px; letter-spacing: 2px;
      color: var(--postal); font-weight: 700; padding: 4px 10px;
      border: 1px solid var(--postal); border-radius: 2px;
      margin-bottom: 16px; transform: rotate(-2deg); }
    .h1 { font-family: "Cormorant Garamond", "Times New Roman", serif;
      font-size: 32px; line-height: 1.15; font-weight: 600;
      margin: 0 0 8px; color: var(--ink); }
    .sub { font-family: "Cormorant Garamond", serif; font-style: italic;
      color: var(--muted); margin: 0 0 24px; font-size: 17px; }
    .preview { background: white; border: 1px solid var(--line);
      border-radius: 3px; padding: 22px 18px;
      font-family: "Caveat", "Bradley Hand", cursive;
      font-size: 19px; line-height: 1.45; color: var(--ink);
      margin: 0 0 28px; min-height: 80px;
      transform: rotate(-0.5deg); box-shadow: 2px 2px 8px rgba(0,0,0,0.08); }
    form { background: white; border-radius: 10px; padding: 22px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
    label { display: block; font-family: -apple-system; font-size: 11px;
      letter-spacing: 1px; color: var(--muted); font-weight: 700;
      margin: 14px 0 6px; }
    input { width: 100%; font-size: 16px; padding: 12px 14px;
      border: 1px solid #DDD5C2; border-radius: 8px;
      background: #FAFAF8; color: var(--ink);
      font-family: -apple-system; }
    input:focus { outline: none; border-color: var(--postal); background: white; }
    .row { display: flex; gap: 10px; }
    .row > div { flex: 1; }
    button { width: 100%; margin-top: 22px; padding: 16px;
      background: var(--ink); color: white; border: none;
      border-radius: 8px; font-size: 16px; font-weight: 600;
      font-family: -apple-system; letter-spacing: 0.2px;
      cursor: pointer; transition: opacity 0.15s; }
    button:disabled { opacity: 0.5; }
    .privacy { color: var(--muted); font-size: 12px; line-height: 1.5;
      margin: 18px 4px 0; font-family: "Cormorant Garamond", serif;
      font-style: italic; text-align: center; }
    .footer { color: var(--muted); font-size: 11px; text-align: center;
      margin-top: 32px; font-family: -apple-system; letter-spacing: 0.5px; }
    .success { text-align: center; padding: 60px 20px; }
    .success h2 { font-family: "Cormorant Garamond", serif; font-size: 28px;
      font-weight: 600; margin: 0 0 12px; }
    .success p { color: var(--muted); font-family: "Cormorant Garamond", serif;
      font-style: italic; font-size: 17px; }
    .error { color: var(--postal); font-size: 13px; margin-top: 8px;
      font-family: -apple-system; }
  </style>
</head>
<body>
  <main>
    <div class="hero">
      <div class="stamp">✉ MAILROOM</div>
      <h1 class="h1">${fromTag} wants to send you a postcard.</h1>
      <p class="sub">From ${senderLine}</p>
    </div>

    ${message ? `<div class="preview">${message}</div>` : ""}

    <p class="sub" style="text-align:center; font-size:15px;">
      Tell us where to send it. Your address stays private to Mailroom — ${fromTag} will never see it.
    </p>

    <form id="form">
      <label>Your name</label>
      <input id="name" type="text" autocomplete="name" required />

      <label>Street address</label>
      <input id="line1" type="text" autocomplete="address-line1" required />

      <label>Apt / suite (optional)</label>
      <input id="line2" type="text" autocomplete="address-line2" />

      <div class="row">
        <div>
          <label>City</label>
          <input id="city" type="text" autocomplete="address-level2" required />
        </div>
        <div>
          <label>State</label>
          <input id="state" type="text" autocomplete="address-level1" required maxlength="2" style="text-transform:uppercase" />
        </div>
      </div>

      <label>ZIP</label>
      <input id="zip" type="text" autocomplete="postal-code" inputmode="numeric" required maxlength="10" />

      <button type="submit" id="submit">Send my postcard →</button>
      <p class="error" id="error" style="display:none"></p>
    </form>

    <p class="privacy">
      Mailroom prints &amp; mails real paper postcards via USPS. Your address is used once to ship this card. It's never shared with the sender or used for marketing.
    </p>
    <p class="footer">MAILROOM · REAL MAIL · 2026</p>
  </main>

  <script>
    const TOKEN = ${JSON.stringify(token)};
    const form = document.getElementById('form');
    const submit = document.getElementById('submit');
    const errorEl = document.getElementById('error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      submit.disabled = true;
      submit.textContent = 'Sending…';
      const payload = {
        token: TOKEN,
        name: document.getElementById('name').value.trim(),
        line1: document.getElementById('line1').value.trim(),
        line2: document.getElementById('line2').value.trim() || null,
        city: document.getElementById('city').value.trim(),
        state: document.getElementById('state').value.trim().toUpperCase(),
        zip: document.getElementById('zip').value.trim(),
      };
      try {
        const r = await fetch(window.location.pathname + window.location.search, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await r.json();
        if (json.ok) {
          document.querySelector('main').innerHTML = \`
            <div class="success">
              <div class="stamp" style="display:inline-block;font-size:11px;letter-spacing:2px;color:var(--postal);font-weight:700;padding:4px 10px;border:1px solid var(--postal);border-radius:2px;margin-bottom:24px;transform:rotate(-2deg);">✉ MAILROOM</div>
              <h2>On its way.</h2>
              <p>Your postcard from \${${JSON.stringify(fromTag)}} is queued for printing. Expect it in your mailbox in 5-8 business days.</p>
            </div>
          \`;
        } else {
          errorEl.textContent = json.error || 'Something went wrong. Try again.';
          errorEl.style.display = 'block';
          submit.disabled = false;
          submit.textContent = 'Send my postcard →';
        }
      } catch (err) {
        errorEl.textContent = 'Network error. Check your connection and try again.';
        errorEl.style.display = 'block';
        submit.disabled = false;
        submit.textContent = 'Send my postcard →';
      }
    });
  </script>
</body>
</html>`;
}

function alreadyClaimedPage(): string {
  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Already claimed</title>
  <style>
    body { background: #F8F1E3; font-family: -apple-system, system-ui, sans-serif;
      color: #221F1A; text-align: center; padding: 80px 20px;
      min-height: 100vh; margin: 0; }
    h1 { font-family: "Cormorant Garamond", serif; font-size: 28px; }
    p { color: #6F6A5D; font-family: "Cormorant Garamond", serif; font-style: italic; }
  </style>
</head>
<body>
  <h1>This card's already on its way.</h1>
  <p>You only need to claim a Mailroom link once. If you're expecting another one, ask the sender for a fresh link.</p>
</body>
</html>`;
}

function errorPage(msg: string): string {
  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mailroom</title>
  <style>
    body { background: #F8F1E3; font-family: -apple-system, system-ui, sans-serif;
      color: #221F1A; text-align: center; padding: 80px 20px;
      min-height: 100vh; margin: 0; }
    h1 { font-family: "Cormorant Garamond", serif; font-size: 28px; }
    p { color: #6F6A5D; font-family: "Cormorant Garamond", serif; font-style: italic; }
  </style>
</head>
<body>
  <h1>Hmm.</h1>
  <p>${escapeHtml(msg)}</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
