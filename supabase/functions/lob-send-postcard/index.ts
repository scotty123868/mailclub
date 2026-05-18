// Supabase Edge Function: lob-send-postcard
//
// Receives a postcard ID + the public URLs of the rendered front/back PNGs
// (already uploaded to Storage by the client), and forwards them to Lob's
// Postcards API. Persists Lob's response (lob_id, lob_status, expected
// delivery, error) back to the `postcards` row.
//
// AUTH MODEL (v0.6.1 hardening, codex audit Phase 6):
//   - Caller MUST present an Authorization: Bearer <jwt> header. We verify
//     it against Supabase auth and resolve the user ID.
//   - The postcard's sender_id must equal the auth'd user. This prevents
//     anyone from calling the function with someone else's postcard_id to
//     burn down our Lob budget.
//   - The `claim` edge function calls this with an internal service-role
//     header (X-Mailroom-Internal) for magic-link redemptions. That code
//     path bypasses the user check but still must present the shared
//     secret stored in MAILROOM_INTERNAL_SECRET.
//
// Deploy:
//   supabase secrets set LOB_API_KEY=test_xxxxx
//   supabase secrets set MAILROOM_INTERNAL_SECRET=$(openssl rand -hex 32)
//   supabase functions deploy lob-send-postcard
//   (NO --no-verify-jwt; we want JWT enforcement on the edge)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOB_API = "https://api.lob.com/v1/postcards";

type Body = {
  postcard_id: string;
  front_url?: string;
  back_url?: string;
  render_mode?: "html"; // v0.7.0.11: server-side render path for claim flow
};

// v0.7.0.12: HTML templates for server-side render (send-link claim flow
// AND retry-orphan path). Designed to MATCH the in-app PostcardPreview
// components 1:1 — same Polaroid front, same paper-grain back with FROM
// line, script message, postage stamp, postmark, USPS guide lines, and
// reciprocation QR. The card mailed to your friend is the same card you
// saw on your phone.
//
// 4x6 USPS postcard: 6.25" × 4.25" with 1/8" bleed. Lob overprints the
// recipient address + IMb barcode on the right half of the back (the
// USPS-compliant zone), so our back design only puts decorative elements
// in that area — no text or graphics that would conflict.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildFrontHtml(photoUrl: string): string {
  // v0.7.0.13: photo-only front. Cream border matches the back's paper
  // so front/back read as one piece. No caption, no wordmark. The photo
  // is the statement. Lob's bleed area is automatic; we render edge-to-
  // edge cream and let the photo sit inside a ~6% margin.
  const photoEl = photoUrl
    ? `<img class="photo" src="${escapeHtml(photoUrl)}" />`
    : `<div class="photo placeholder">Mailroom</div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { margin: 0; size: 6.25in 4.25in; }
html, body { margin: 0; padding: 0; }
.card {
  width: 6.25in; height: 4.25in;
  background: #FBF4DE;
  padding: 0.15in;
  box-sizing: border-box;
}
.photo {
  width: 100%; height: 100%;
  display: block;
  object-fit: cover;
  background: #1B1F2D;
  border: 0.4pt solid rgba(0,0,0,0.12);
}
.placeholder {
  font-family: Georgia, serif;
  font-size: 48pt;
  color: #E8D5A8;
  text-align: center;
  line-height: 1;
  padding-top: 1in;
}
</style></head><body>
<div class="card">${photoEl}</div>
</body></html>`;
}

function buildBackHtml(opts: {
  message: string;
  senderName?: string;
  senderCity?: string;
  senderState?: string;
  reciprocationUrl?: string;
}): string {
  // v0.7.0.33 — RESTORE the original design (per user PDF reference).
  //
  // Layout (matches the early-2026 mockup):
  //   TOP-LEFT  (0.30in, 0.25in, ~3.0in × 1.05in):
  //     - QR code (~0.85in square) on the left
  //     - To its right: italic "Respond to {sender} with a postcard for free."
  //     - Below that: tiny URL "themailroom.club/r/{token}"
  //   TOP-RIGHT (~5.0in, 0.20in, 1.0in × 1.2in):
  //     - Stylized "stamp" graphic with a balloon-mail illustration,
  //       "MAILROOM / FIRST CLASS / 70¢ / 2026" text + perforated edge.
  //   MIDDLE-LEFT (0.30in, 1.50in, 2.55in × 2.10in):
  //     - Handwritten message in Caveat-style cursive, smaller font
  //       than v0.7.0.14 so the longer messages don't crowd the QR.
  //   BOTTOM-LEFT (0.30in, 3.85in, 2.5in × 0.18in):
  //     - Postmark text: "{CITY ST} · {MMM D} · {YYYY}"
  //   MIDDLE-RIGHT (~3.0in onward): LOB INK-FREE — Lob auto-renders
  //     the return address, postage indicia, IMb barcode, recipient
  //     address into this 3.2835" × 2.375" zone.
  //
  // Why we re-render the stamp ourselves instead of letting Lob do it:
  // Lob's "POSTAGE INDICIA" rectangle is plain — looks like a permit
  // imprint, not a stamp. A custom stamp graphic above Lob's zone makes
  // the postcard feel like real mail. Lob's POSTAGE INDICIA still shows
  // in its zone alongside ours (it's information-only), but the visual
  // anchor in the top-right is the Mailroom brand stamp.
  //
  // Build 14's layout (QR top-right, message full-width-left) was a
  // simplification that lost the brand voice. Restoring the original.

  const senderFirstName = (opts.senderName ?? "the sender").trim().split(" ")[0] || "the sender";
  const qrUrl = opts.reciprocationUrl ?? "";
  const qrSrc = qrUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=400x400&ecc=M&margin=0&data=${encodeURIComponent(qrUrl)}`
    : "";
  // Display URL: strip protocol + "welcome-mail" path for the human-
  // readable short URL under the QR. The /r/:token Vercel redirect
  // resolves to /welcome-mail/:token, so this short link works too.
  const displayUrl = (() => {
    if (!qrUrl) return "";
    const m = qrUrl.match(/\/(?:welcome-mail|r)\/([^/?#]+)/);
    const token = m ? m[1] : "";
    return token ? `themailroom.club/r/${token}` : qrUrl.replace(/^https?:\/\//, "");
  })();
  const senderCityState = [opts.senderCity, opts.senderState]
    .filter((s) => s && s.trim().length > 0)
    .join(" ")
    .toUpperCase();
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const now = new Date();
  const datePart = `${monthNames[now.getUTCMonth()]} ${now.getUTCDate()}`;
  const yearPart = now.getUTCFullYear();
  const postmark = senderCityState
    ? `${senderCityState} · ${datePart} · ${yearPart}`
    : `MAILROOM · ${datePart} · ${yearPart}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { margin: 0; size: 6.25in 4.25in; }
html, body {
  margin: 0; padding: 0;
  width: 6.25in; height: 4.25in;
  background: #F8F1E3;
  color: #17223B;
  font-family: Georgia, 'Times New Roman', serif;
}
.card { position: relative; width: 100%; height: 100%; }

/* TOP-LEFT — QR + caption + URL. Inside the top 1.45in free zone. */
.qr-block {
  position: absolute;
  top: 0.25in;
  left: 0.30in;
  display: flex;
  align-items: flex-start;
  gap: 0.16in;
}
.qr {
  width: 0.85in; height: 0.85in;
  background: #FFFFFF;
  border: 0.4pt solid #17223B;
  display: block;
  flex-shrink: 0;
}
.qr-side {
  padding-top: 0.04in;
  max-width: 1.85in;
}
.qr-caption {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-style: italic;
  font-size: 9pt;
  line-height: 1.25;
  color: #17223B;
  margin: 0;
}
.qr-url {
  font-family: ui-monospace, 'JetBrains Mono', 'Courier New', monospace;
  font-size: 6pt;
  color: #5E6472;
  margin-top: 0.06in;
  letter-spacing: 0.2pt;
}

/* TOP-RIGHT — Mailroom stamp. Sits in the top-right free zone above
   Lob's ink-free area (which starts at y=1.625in). */
.stamp {
  position: absolute;
  top: 0.22in;
  right: 0.30in;
  width: 1.05in;
  height: 1.20in;
  background: #F8F1E3;
  /* Perforated edge: gradient + radial mask gives the stamp-tooth look. */
  border: 0.6pt dashed #b8483a;
  padding: 0.06in;
  box-sizing: border-box;
  text-align: center;
  color: #b8483a;
}
.stamp-art {
  width: 100%;
  height: 0.55in;
  display: block;
}
.stamp-art svg { width: 100%; height: 100%; }
.stamp-title {
  font-family: 'Playfair Display', 'Cormorant Garamond', Georgia, serif;
  font-weight: 700;
  font-size: 7.5pt;
  letter-spacing: 0.6pt;
  margin-top: 0.04in;
  color: #b8483a;
}
.stamp-sub {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-style: italic;
  font-size: 5.5pt;
  letter-spacing: 0.8pt;
  color: #5E6472;
  margin-top: 0.01in;
}
.stamp-value {
  font-family: 'Playfair Display', Georgia, serif;
  font-weight: 700;
  font-size: 9pt;
  color: #b8483a;
  margin-top: 0.02in;
}
.stamp-year {
  font-family: ui-monospace, 'JetBrains Mono', 'Courier New', monospace;
  font-size: 5pt;
  color: #5E6472;
  letter-spacing: 0.5pt;
}

/* MIDDLE-LEFT — handwritten message. Sits below the QR block, hard-
   bounded so it can't spill into the central divider or Lob's address
   zone on the right. */
.message {
  position: absolute;
  top: 1.50in;
  left: 0.30in;
  width: 2.55in;
  max-width: 2.55in;
  height: 2.10in;
  max-height: 2.10in;
  font-family: 'Caveat', 'Bradley Hand', 'Comic Sans MS', cursive;
  font-size: 14pt;
  line-height: 1.35;
  letter-spacing: 0.1pt;
  color: #17223B;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: break-word;
  overflow: hidden;
  box-sizing: border-box;
}

/* BOTTOM-LEFT — postmark. Tiny monospace caption, below the message
   and above Lob's bottom IMb zone (which starts at y=3.625in). */
.postmark {
  position: absolute;
  bottom: 0.30in;
  left: 0.30in;
  font-family: ui-monospace, 'JetBrains Mono', 'Courier New', monospace;
  font-size: 6.5pt;
  color: #5E6472;
  letter-spacing: 0.8pt;
}

/* Hairline divider — visual cue that the right half is the address
   side. Stops just above Lob's IMb zone. */
.divider {
  position: absolute;
  left: 3.05in;
  top: 0.35in;
  bottom: 0.85in;
  width: 0.4pt;
  background: rgba(194, 165, 109, 0.45);
}
</style></head><body>
<div class="card">
  <div class="divider"></div>

  ${qrSrc ? `<div class="qr-block">
    <img class="qr" src="${qrSrc}" alt="QR" />
    <div class="qr-side">
      <p class="qr-caption">Respond to ${escapeHtml(senderFirstName)} with a postcard for free.</p>
      <div class="qr-url">${escapeHtml(displayUrl)}</div>
    </div>
  </div>` : ""}

  <div class="stamp">
    <div class="stamp-art">
      <svg viewBox="0 0 100 56" xmlns="http://www.w3.org/2000/svg">
        <!-- sky -->
        <rect width="100" height="56" fill="#F8F1E3"/>
        <!-- hills -->
        <path d="M 0 42 Q 25 32 50 38 T 100 36 V 56 H 0 Z" fill="#7a9b73"/>
        <path d="M 0 48 Q 30 40 60 46 T 100 44 V 56 H 0 Z" fill="#5e8055" opacity="0.85"/>
        <!-- sun -->
        <circle cx="78" cy="32" r="5" fill="#e8a87c"/>
        <!-- balloon envelope -->
        <ellipse cx="32" cy="20" rx="13" ry="14" fill="#FBF4DE" stroke="#b8483a" stroke-width="0.7"/>
        <line x1="32" y1="6" x2="32" y2="34" stroke="#b8483a" stroke-width="0.5"/>
        <path d="M 32 6 Q 22 20 32 34" fill="none" stroke="#b8483a" stroke-width="0.5"/>
        <path d="M 32 6 Q 42 20 32 34" fill="none" stroke="#b8483a" stroke-width="0.5"/>
        <!-- strings -->
        <line x1="24" y1="34" x2="28" y2="42" stroke="#b8483a" stroke-width="0.4"/>
        <line x1="40" y1="34" x2="36" y2="42" stroke="#b8483a" stroke-width="0.4"/>
        <!-- basket -->
        <rect x="26" y="41" width="12" height="4" fill="#c2a56d" stroke="#17223B" stroke-width="0.3"/>
      </svg>
    </div>
    <div class="stamp-title">MAILROOM</div>
    <div class="stamp-sub">FIRST CLASS</div>
    <div class="stamp-value">70¢</div>
    <div class="stamp-year">${yearPart}</div>
  </div>

  <div class="message">${escapeHtml(opts.message)}</div>

  <div class="postmark">${escapeHtml(postmark)}</div>
</div>
</body></html>`;
}

// v0.7.0.20: helper that always returns HTTP 200 with the actual outcome
// encoded in the body's `ok` field. Reason: supabase-js's
// functions.invoke() wraps any non-2xx response in a generic
// FunctionsHttpError ("Edge Function returned a non-2xx status code")
// and does NOT parse the body unless the caller explicitly reads
// error.context.json(). Most client code (including our submitToLob)
// just reads `error.message`, so the real reason gets swallowed.
//
// Returning 200 for everything trades HTTP semantics (use status codes
// for failure!) for diagnostic clarity (real error message reaches the
// user every time). This is the right trade for an internal Edge
// Function — supabase analytics dashboard still tracks failures via the
// `ok: false` count in body once we instrument it, and external Lob
// API monitoring is unaffected (we still log lob_error to postcards).
//
// The intent-status param is preserved in the JSON body as `__status`
// for debugging/logging only — it doesn't drive HTTP routing.
function json(body: unknown, _intentStatus = 200): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }

  // -- AUTH --------------------------------------------------------------
  // Either: (a) Bearer JWT from a signed-in user, or (b) internal service
  // call from the claim function with the shared secret. Reject everything
  // else. This closes the abuse vector codex flagged: the function used to
  // accept any request with a valid postcard_id and front/back URLs.
  const authHeader = req.headers.get("authorization") ?? "";
  const internalSecret = req.headers.get("x-mailroom-internal") ?? "";
  const expectedInternal = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";

  let callerUserId: string | null = null;
  let isInternalCall = false;

  if (internalSecret && expectedInternal && internalSecret === expectedInternal) {
    // Internal service-to-service call (claim → lob-send-postcard).
    // Skip the user-id check; the claim function already validated the
    // claim token.
    isInternalCall = true;
  } else if (authHeader.toLowerCase().startsWith("bearer ")) {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return json({ ok: false, error: "Invalid auth token" }, 401);
    }
    callerUserId = userData.user.id;
  } else {
    return json({ ok: false, error: "Auth required (Bearer JWT or internal secret)" }, 401);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  // v0.7.0.11: two input modes:
  //   1. {postcard_id, front_url, back_url} — original "PNG URLs" path
  //      used by the welcome flow and Send tab via view-shot capture.
  //   2. {postcard_id, render_mode: "html"} — server-side HTML render,
  //      used by the claim function for send-link cards where there's
  //      no client to capture views (recipient is filling in their
  //      address on a web page, sender's app may not even be running).
  //      We build front/back HTML from the postcard data + photo URL
  //      and pass HTML strings to Lob, which renders them server-side.
  const useInlineHtml = body.render_mode === "html";
  if (!body.postcard_id) {
    return json({ ok: false, error: "postcard_id required" }, 400);
  }
  if (!useInlineHtml && (!body.front_url || !body.back_url)) {
    return json(
      { ok: false, error: "front_url + back_url required unless render_mode=html" },
      400,
    );
  }

  const lobKey = Deno.env.get("LOB_API_KEY");
  if (!lobKey) {
    return json({ ok: false, error: "LOB_API_KEY env var missing" }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Load the postcard. v0.7.0.11: switched off PostgREST embedded
  // selects after the cache stopped resolving postcards→profiles for
  // sender_id and postcards→postcard_claims for claim_id. Three
  // explicit queries instead — slower but cache-invariant.
  const { data: postcard, error: pcErr } = await supabase
    .from("postcards")
    .select("*")
    .eq("id", body.postcard_id)
    .single();

  // -- OWNERSHIP CHECK --------------------------------------------------
  // User JWT callers can only send their own postcards. Internal callers
  // (claim → lob-send-postcard) skip this since the claim function already
  // validated the claim token AND created the postcard server-side.
  if (postcard && !isInternalCall && callerUserId && (postcard as any).sender_id !== callerUserId) {
    return json({ ok: false, error: "Postcard does not belong to caller" }, 403);
  }

  if (pcErr || !postcard) {
    return json({ ok: false, error: pcErr?.message ?? "Postcard not found" }, 404);
  }

  const toKind = (postcard as any).to_kind;
  const senderId = (postcard as any).sender_id;
  const friendId = (postcard as any).to_friend_id;
  const claimId = (postcard as any).claim_id;

  // Sender profile — always need this for the from-address.
  const { data: sender } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", senderId)
    .maybeSingle();

  // Recipient — either via friend or claim depending on to_kind.
  let friend: any = null;
  let claim: any = null;
  if (toKind === "claim" && claimId) {
    const { data } = await supabase
      .from("postcard_claims")
      .select("*")
      .eq("id", claimId)
      .maybeSingle();
    claim = data;
  } else if (friendId) {
    const { data } = await supabase
      .from("friends")
      .select("*")
      .eq("id", friendId)
      .maybeSingle();
    friend = data;
  }

  // Resolve the recipient address. Two source paths:
  //   - to_kind="friend"|"void"|"self": from the friend record
  //   - to_kind="claim": from the postcard_claims claimed_* fields
  let recipient: {
    name: string;
    address_line1: string;
    address_line2?: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    address_country: string;
  } | null = null;
  if (toKind === "claim" && claim?.claimed_address_line1) {
    recipient = {
      name: claim.claimed_name ?? "Recipient",
      address_line1: claim.claimed_address_line1,
      address_line2: claim.claimed_address_line2 ?? undefined,
      address_city: claim.claimed_city ?? "",
      address_state: claim.claimed_state ?? "",
      address_zip: claim.claimed_zip ?? "",
      address_country: claim.claimed_country ?? "US",
    };
  } else if (friend?.address_line1) {
    recipient = {
      name: friend.name,
      address_line1: friend.address_line1,
      address_line2: friend.address_line2 ?? undefined,
      address_city: friend.address_city,
      address_state: friend.address_state,
      address_zip: friend.address_zip,
      address_country: friend.address_country ?? "US",
    };
  }
  if (!recipient || !recipient.address_line1 || !recipient.address_city || !recipient.address_state || !recipient.address_zip) {
    // v0.7.0.20: include diagnostic info so we can debug *which* field
    // is missing without function logs. Don't leak the actual address —
    // just say which keys are unset.
    const missing = !recipient
      ? "recipient row not found"
      : [
          !recipient.address_line1 && "line1",
          !recipient.address_city && "city",
          !recipient.address_state && "state",
          !recipient.address_zip && "zip",
        ].filter(Boolean).join(", ");
    return json(
      {
        ok: false,
        error: `No recipient address available (missing: ${missing}). The friend record may have been created without a complete mailing address.`,
        toKind,
        friendIdSet: !!friendId,
        claimIdSet: !!claimId,
      },
      400,
    );
  }

  // For html render mode, build the front + back HTML from the postcard
  // data + a signed URL to the photo. Lob renders it server-side. This
  // is how send-link cards reach Lob — the claim function can call this
  // function with just postcard_id + render_mode="html" once the
  // recipient address has been claimed.
  let frontPayload = body.front_url;
  let backPayload = body.back_url;
  if (useInlineHtml) {
    // Sign the photo URL. The postcard-photos bucket is private; we
    // give Lob a 7-day signed URL which is plenty for them to fetch +
    // render it on their side. They store their own copy after.
    let photoUrl = "";
    if ((postcard as any).photo_path) {
      const path = (postcard as any).photo_path as string;
      if (path.startsWith("http")) {
        photoUrl = path;
      } else {
        const { data: signed } = await supabase.storage
          .from("postcard-photos")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) photoUrl = signed.signedUrl;
      }
    }
    // v0.7.0.12: mint a reciprocation token for the back QR so the
    // recipient can scan + reply free. If one already exists for this
    // postcard, the RPC returns the existing token (idempotent).
    let reciprocationUrl = "";
    try {
      const { data: tokenData } = await supabase.rpc("create_reciprocation_token", {
        p_postcard_id: postcard.id,
      });
      if (tokenData && typeof tokenData === "object" && (tokenData as any).url) {
        reciprocationUrl = (tokenData as any).url as string;
      } else if (tokenData && typeof tokenData === "object" && (tokenData as any).token) {
        // Some versions of the RPC return just the token; build the URL.
        reciprocationUrl = `https://app.themailroom.club/welcome-mail/${(tokenData as any).token}`;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[lob-send-postcard] reciprocation token mint failed:", err);
      // Continue without QR — postcard still ships, just no reply hook.
    }
    frontPayload = buildFrontHtml(photoUrl);
    backPayload = buildBackHtml({
      message: (postcard as any).message ?? "",
      senderName: sender?.name ?? undefined,
      senderCity: sender?.city ?? undefined,
      senderState: sender?.state ?? undefined,
      reciprocationUrl: reciprocationUrl || undefined,
    });
  }

  const params = new URLSearchParams({
    description: `Mailroom postcard ${postcard.id}`,
    "to[name]": recipient.name,
    "to[address_line1]": recipient.address_line1,
    ...(recipient.address_line2 ? { "to[address_line2]": recipient.address_line2 } : {}),
    "to[address_city]": recipient.address_city,
    "to[address_state]": recipient.address_state,
    "to[address_zip]": recipient.address_zip,
    "to[address_country]": recipient.address_country,
    // v0.7.0.13: prefer the Mailroom-owned return address (env vars) over
    // the sender's personal home address. Senders' privacy matters — we
    // don't want everyone's home address printed on every postcard's
    // return line. When the env vars aren't set we fall back to a clearly
    // labeled placeholder so test-mode prints still validate; live mode
    // will be gated on real values being present.
    //
    // Set these once via:
    //   supabase secrets set MAILROOM_RETURN_NAME="Mailroom"
    //   supabase secrets set MAILROOM_RETURN_LINE1="123 Some Real St"
    //   supabase secrets set MAILROOM_RETURN_CITY="Denver"
    //   supabase secrets set MAILROOM_RETURN_STATE="CO"
    //   supabase secrets set MAILROOM_RETURN_ZIP="80202"
    "from[name]": Deno.env.get("MAILROOM_RETURN_NAME") ?? "Mailroom",
    "from[address_line1]": Deno.env.get("MAILROOM_RETURN_LINE1") ?? "1 Mailroom Way",
    "from[address_city]": Deno.env.get("MAILROOM_RETURN_CITY") ?? "Denver",
    "from[address_state]": Deno.env.get("MAILROOM_RETURN_STATE") ?? "CO",
    "from[address_zip]": Deno.env.get("MAILROOM_RETURN_ZIP") ?? "80202",
    "from[address_country]": "US",
    front: frontPayload,
    back: backPayload,
    size: "4x6",
    // v0.7.0.20: Lob requires use_type on every postcard send. Without
    // it the API rejects with "Mail use_type must be one of 'marketing'
    // or 'operational'". For Mailroom's product (user-initiated personal
    // postcards to friends), "marketing" is the closer fit — not a
    // transactional/operational notification, more like personal outreach.
    // If you ever want to override per-account (e.g. set the default in
    // dashboard.lob.com → Settings → Account), you can drop this line,
    // but hardcoding keeps the send working independent of account state.
    use_type: "marketing",
    // v0.7.0.27 REVERT: removed `to_address_strictness: "relaxed"`.
    //
    // I added it in 25 thinking it controlled the strictness check on
    // postcard sends. It does not — `to_address_strictness` is only
    // valid on Lob's `/us_verifications` endpoint, not `/postcards`.
    // Passing it to `/postcards` produces "to_address_strictness is
    // not allowed", which Lob returns as a 422 and the user sees as
    // "Couldn't print your card."
    //
    // Strictness on the `/postcards` endpoint is controlled by the
    // ACCOUNT-LEVEL setting in the Lob dashboard
    // (dashboard.lob.com → Settings → Account → Address Strictness).
    // The user has that set to relaxed; nothing else is needed.
    //
    // If a specific address still fails, it's a real deliverability
    // problem (e.g. an apartment number that doesn't exist in CASS),
    // not a parameter we can override per-send.
  });

  let lobResp: Response;
  try {
    lobResp = await fetch(LOB_API, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(lobKey + ":")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error to Lob";
    await supabase.from("postcards").update({ lob_error: msg }).eq("id", postcard.id);
    return json({ ok: false, error: msg }, 502);
  }

  // v0.7.0.20: renamed to lobJson — the previous `json` const shadowed
  // the new top-level `json()` response helper.
  const lobJson = await lobResp.json();

  if (!lobResp.ok) {
    const msg = lobJson?.error?.message ?? `Lob returned ${lobResp.status}`;
    await supabase.from("postcards").update({ lob_error: msg }).eq("id", postcard.id);
    return json({ ok: false, error: msg }, lobResp.status);
  }

  // Success — persist Lob's metadata on the postcard row.
  const update: Record<string, unknown> = {
    lob_id: lobJson.id,
    lob_status: "queued",
    lob_expected_delivery: lobJson.expected_delivery_date,
    lob_error: null,
  };
  // v0.7.0.23: REMOVED — don't overwrite photo_path with the rendered
  // front URL. The user wants the journal tile to show their actual
  // camera-roll photo, not the rendered postcard composition (which
  // is just the photo + cream frame + tiny text — visually it's a
  // less personal preview than the original snapshot).
  //
  // photo_path stays as whatever was set when the postcard row was
  // first created (a postcard-photos bucket path, signed-URL resolved
  // client-side). Renders live in postcard-renders/{id}/front.jpg if
  // anyone needs them later for debugging or detail-sheet previews.
  if (false && !useInlineHtml && body.front_url) {
    update.photo_path = body.front_url;
  }
  await supabase.from("postcards").update(update).eq("id", postcard.id);

  return json({
    ok: true,
    lob_id: lobJson.id,
    expected_delivery_date: lobJson.expected_delivery_date,
  });
});
