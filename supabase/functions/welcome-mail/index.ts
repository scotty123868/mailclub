// welcome-mail — receiver-facing endpoint for QR scans on printed postcards.
//
// URL: https://<project>.functions.supabase.co/welcome-mail?t=TOKEN
//      (also handles /welcome-mail/TOKEN if hosted under a custom domain)
//
// GET  → If the request comes from iOS Safari with the Mailroom app installed,
//        the iOS Universal Link associated with mailroom.app/r/[token] (or
//        the configured app domain) should open the app directly. If the app
//        isn't installed, this endpoint returns a polished HTML page with
//        the sender's name + postcard preview + a Get Mailroom CTA.
//
// POST → Authenticated app call. Body: { token }. Returns the full receiver
//        payload (sender info, friend_id created, postcard preview) by way
//        of the record_reciprocation_scan RPC. The app uses this to render
//        the welcome hero screen.
//
// PRIVACY: same model as the `claim` function. We only expose the sender's
// public display info (name + city); never their address. Photo URLs are
// signed/short-lived where applicable.
//
// Deploy:
//   supabase functions deploy welcome-mail --no-verify-jwt
//
// Notes:
//   • The HTML page is mobile-first; ~98% of QR scans on a printed postcard
//     happen via iPhone camera, which opens Safari with the URL.
//   • The Universal Link should be hosted at mailroom.app/.well-known/
//     apple-app-site-association — see ios/Mailroom/Mailroom.entitlements
//     and `apple-app-site-association.example.json` in the repo root for
//     the template.

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Service-role client for the lookup_reciprocation RPC (anon-callable but
// run server-side for the GET HTML render). The record-scan RPC requires an
// authenticated user, so we make an authed-user client per-request for POSTs.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  // Accept token from either ?t=, ?token=, or the last path segment so we
  // can host both /welcome-mail?t=ABCD and /r/ABCD via a route rewrite.
  const tokenFromQuery =
    url.searchParams.get("t") ?? url.searchParams.get("token");
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const tokenFromPath = pathSegments[pathSegments.length - 1] ?? "";
  const token = tokenFromQuery ?? tokenFromPath ?? "";

  if (req.method === "GET") {
    return handleGet(token);
  }
  if (req.method === "POST") {
    return handlePost(req, token);
  }
  return new Response("Method not allowed", { status: 405 });
});

// ---------------------------------------------------------------------------
// GET — public HTML page
// ---------------------------------------------------------------------------

async function handleGet(token: string): Promise<Response> {
  if (!token || token.length < 4) {
    return htmlResponse(errorPage("Missing or invalid token in URL."), 400);
  }

  const { data, error } = await admin.rpc("lookup_reciprocation", {
    p_token: token,
  });

  if (error) {
    return htmlResponse(errorPage(`Server error: ${error.message}`), 500);
  }
  if (!data?.ok) {
    if (data?.reason === "EXPIRED") {
      return htmlResponse(
        errorPage("This card's link has expired. Ask the sender to mail you another one!"),
        410,
      );
    }
    return htmlResponse(errorPage("This card link couldn't be found."), 404);
  }

  return htmlResponse(receiverLandingPage(token, data), 200);
}

// ---------------------------------------------------------------------------
// POST — authenticated app call. Returns JSON with the scan result.
// ---------------------------------------------------------------------------

async function handlePost(req: Request, token: string): Promise<Response> {
  if (!token) {
    return jsonResponse({ ok: false, error: "token required" }, 400);
  }

  // The app passes the user's access token in the Authorization header.
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ ok: false, error: "Bearer token required" }, 401);
  }

  // Build a per-request client with the user's JWT so auth.uid() in the RPC
  // returns the right user. The RPC is security definer but uses auth.uid()
  // internally to attribute the scan correctly.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await userClient.rpc("record_reciprocation_scan", {
    p_token: token,
  });

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500);
  }
  if (!data?.ok) {
    return jsonResponse({ ok: false, reason: data?.reason ?? "UNKNOWN" }, 200);
  }

  return jsonResponse(data, 200);
}

// ---------------------------------------------------------------------------
// HTML pages
// ---------------------------------------------------------------------------

function receiverLandingPage(
  token: string,
  payload: {
    sender_name: string;
    sender_city: string;
    message_preview: string;
    category: string;
    // v0.7.0.49: photo_path → has_photo. The HTML web fallback doesn't
    // render the photo today, but the type now matches the RPC response
    // shape so future renders won't be tempted to pull a raw storage key.
    has_photo?: boolean;
    sent_at?: string;
    flavor: string;
  },
): string {
  const senderFirst = (payload.sender_name ?? "Someone")
    .split(" ")[0]
    .replace(/[<>]/g, "");
  const safeName = escapeHtml(payload.sender_name ?? "A Mailroom friend");
  const safeCity = escapeHtml(payload.sender_city ?? "");
  const safeMsg = escapeHtml((payload.message_preview ?? "").slice(0, 200));
  // Universal link the iOS app will intercept if installed; otherwise this
  // 1px iframe makes Safari try the custom scheme then fall back.
  const customScheme = `mailroom://welcome-mail/${encodeURIComponent(token)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${safeName} sent you a postcard</title>
<meta name="theme-color" content="#F8F1E3" />
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: linear-gradient(180deg, #F8F1E3 0%, #F4ECDB 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #1A2A3F;
    min-height: 100vh;
    overflow-x: hidden;
  }
  .wrap { max-width: 480px; margin: 0 auto; padding: 32px 24px 48px; }
  .kicker {
    color: #B5391A;
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-weight: 600;
    margin-bottom: 8px;
  }
  h1 {
    font-family: "Cormorant Garamond", Georgia, serif;
    font-size: 38px;
    line-height: 1.1;
    margin: 0 0 12px;
    color: #0F2542;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .sub {
    color: #475569;
    font-size: 15px;
    line-height: 1.5;
    margin: 0 0 28px;
    font-style: italic;
    font-family: "Cormorant Garamond", Georgia, serif;
  }
  .card {
    background: #FEFAEE;
    border-radius: 6px;
    padding: 24px 22px;
    box-shadow: 0 2px 8px rgba(15,37,66,0.06), 0 24px 48px rgba(15,37,66,0.10);
    margin: 0 0 28px;
    transform: rotate(-1deg);
  }
  .from-line {
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #475569;
    margin-bottom: 12px;
  }
  .from-line strong {
    display: block;
    color: #0F2542;
    font-family: "Cormorant Garamond", Georgia, serif;
    font-style: italic;
    font-size: 16px;
    text-transform: none;
    letter-spacing: 0;
    margin-top: 3px;
  }
  .message {
    font-family: "Caveat", "Brush Script MT", cursive;
    font-size: 22px;
    line-height: 1.35;
    color: #0F2542;
    white-space: pre-wrap;
  }
  .cta-primary {
    display: block;
    background: #B5391A;
    color: #FEFAEE;
    text-decoration: none;
    padding: 16px 22px;
    border-radius: 14px;
    text-align: center;
    font-weight: 600;
    font-size: 17px;
    margin: 0 0 14px;
    box-shadow: 0 6px 18px rgba(181,57,26,0.25);
  }
  .cta-primary:active { transform: translateY(1px); }
  .cta-secondary {
    display: block;
    color: #0F2542;
    text-decoration: underline;
    text-decoration-color: rgba(15,37,66,0.3);
    text-align: center;
    font-size: 14px;
    padding: 8px;
  }
  .small {
    color: #6B7280;
    font-size: 12px;
    line-height: 1.5;
    text-align: center;
    margin-top: 24px;
    font-style: italic;
    font-family: "Cormorant Garamond", Georgia, serif;
  }
  .wordmark {
    font-family: "Brush Script MT", cursive;
    font-size: 28px;
    color: #0F2542;
    text-align: center;
    margin: 0 0 36px;
    line-height: 1;
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="wordmark">Mailroom</div>
  <div class="kicker">You got mail</div>
  <h1>${safeName}<br/>sent you a postcard</h1>
  <p class="sub">${safeCity ? `From ${safeCity} · ` : ""}Mailed via Mailroom.</p>

  <div class="card">
    <div class="from-line">From<strong>${escapeHtml(senderFirst)}${safeCity ? ` · ${safeCity}` : ""}</strong></div>
    <div class="message">${safeMsg || "(message will arrive on the printed card)"}</div>
  </div>

  <a class="cta-primary" href="${customScheme}">Open in Mailroom</a>
  <a class="cta-secondary"
     href="https://apps.apple.com/us/app/mailroom/id6768460855">
    Don't have the app? Get Mailroom →
  </a>

  <p class="small">
    Mailroom is a quiet little app for sending real postcards to real friends.
    Each card costs the price of a stamp. No feed, no algorithm.
  </p>
</div>
<script>
  // Try the deep link automatically on page load. If the app is installed,
  // iOS opens it; if not, Safari just stays here and the user can tap the
  // App Store link below.
  setTimeout(function () {
    window.location.href = "${customScheme}";
  }, 250);
</script>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mailroom</title>
<style>
  body {
    background: #F8F1E3;
    color: #1A2A3F;
    font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    text-align: center;
    padding: 64px 32px;
    margin: 0;
  }
  .wordmark { font-family: "Brush Script MT", cursive; font-size: 32px; color: #0F2542; margin-bottom: 24px; }
  h1 { font-family: "Cormorant Garamond", Georgia, serif; font-size: 28px; color: #0F2542; margin: 0 0 12px; font-weight: 600; }
  p { color: #475569; font-size: 16px; line-height: 1.5; max-width: 360px; margin: 0 auto 24px; }
  a { color: #B5391A; text-decoration: underline; }
</style>
</head>
<body>
<div class="wordmark">Mailroom</div>
<h1>Hmm.</h1>
<p>${escapeHtml(message)}</p>
<p><a href="https://apps.apple.com/us/app/mailroom/id6768460855">Get Mailroom</a> and send a postcard to a friend yourself.</p>
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
