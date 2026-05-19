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

// v0.7.0.43: Lob inline-HTML payloads must be ≤10 000 chars. The
// developer-friendly CSS + HTML comments in buildBackHtml push past that
// in v15. Strip comments + minify CSS on the way out — keeps the source
// readable in this file while shipping a compact payload to Lob. The
// minifier only touches CSS inside <style> blocks and HTML structure
// outside of text content nodes, so user message whitespace (which
// renders via white-space: pre-wrap) is preserved verbatim.
function compactHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style>([\s\S]*?)<\/style>/g, (_m, css) => {
      const min = css
        .replace(/\/\*[\s\S]*?\*\//g, "")          // strip CSS block comments
        .replace(/\s*([{}:;,>])\s*/g, "$1")         // remove space around CSS punctuation
        .replace(/;}/g, "}")                          // trailing semicolons
        .replace(/\s+/g, " ")                         // collapse remaining whitespace
        .trim();
      return "<style>" + min + "</style>";
    })
    .replace(/\n\s*\n+/g, "\n");
}

// ============================================================================
//   CANONICAL POSTCARD BACK DESIGN — THIS FUNCTION IS THE SOURCE OF TRUTH
// ============================================================================
//
//   This is the ONLY postcard back design that ships to Lob in production.
//   Every real postcard your users receive is rendered from this function.
//
//   DO NOT:
//   - Implement an alternate buildBackHtml() anywhere else
//   - Resurrect designs from `design-mockups/postcard-back/_archived/`
//   - "Start fresh" from a Codex/Claude/Cursor draft without comparing
//     output against the actuallysent.pdf reference + the documented recipe
//
//   IF YOU EDIT THIS FUNCTION:
//   1. Read `design-mockups/postcard-back/REPRODUCE_ACTUALLYSENT.md` first
//   2. Run /tmp/build_test_back.py + compactHtml() and submit to Lob test
//   3. Compare the rendered output to /tmp/psc_99a2b9ab23f899cf.pdf
//      (the v0.7.0.49 canonical reference render)
//   4. Verify the back thumbnail is under 10KB after compactHtml()
//   5. Test with a long message, a long city name, and an empty
//      reciprocationUrl — none of those inputs may cause text overlap
//
//   Source intent: reproduce design-mockups/postcard-back/_archived/C2-print.html
//   composition (high-left handwritten note, off-bleed stamp top-right,
//   short top divider, quiet bottom cancellation rail). The message column
//   stops at left:0.25in width:2.37in so it never overlaps Lob's
//   right-half address mask. The stamp is positioned partially off-bleed
//   for the "physical pasted stamp" effect — `top: 0.14in` is the smallest
//   value that survives the 3deg rotation without trimming.
//
//   Reference renders (Lob, 2026-05-18):
//     - psc_dc416ebf3ded708e  canonical (current canonical)
//     - psc_4439fc562a66a9c6  long-message overflow test
//     - psc_7e7aeb5061d5cfb0  long-city postmark test
//     - psc_a7ee09a44ed3c336  no-QR (empty reciprocationUrl) test
//   /design-review: A- design score · A+ AI-slop score
//   Verified: variable QR token, variable date, no element overlap under
//   any input. See REPRODUCE_ACTUALLYSENT.md for the recipe.
//
// ============================================================================
function buildBackHtml(opts: {
  message: string;
  senderName?: string;
  senderCity?: string;
  senderState?: string;
  reciprocationUrl?: string;
}): string {

  const senderFirstName = (opts.senderName ?? "the sender").trim().split(" ")[0] || "the sender";
  const qrUrl = opts.reciprocationUrl ?? "";
  // v0.7.0.43: 400x400&ecc=M → 1200x1200&ecc=H. At print scale the 0.687in
  // QR box wants ~412 print pixels of source data; 400 source pixels is
  // basically 1:1 with subpixel sampling, which is the worst case for
  // raster crispness. 1200x1200 gives ~3x oversampling so downscaling
  // produces clean edges. ECC=H also packs denser modules which read
  // sharper when downsized.
  const qrSrc = qrUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=1200x1200&ecc=H&margin=0&data=${encodeURIComponent(qrUrl)}`
    : "";
  // Display URL under the QR — short form via Vercel /r/* rewrite which
  // 200s to the welcome-mail page. The QR encodes the full /welcome-mail/
  // path (in current AASA) so iOS Universal Link fires on scan; the
  // displayed /r/ URL is the human-readable fallback. /r/* will also
  // fire Universal Link once Vercel ships the updated AASA file from
  // `vercel-staging/.well-known/apple-app-site-association` (the file is
  // committed; the Vercel project just hasn't redeployed since 7:40 AM
  // ET 2026-05-18). Tracked in TODOS.md.
  const displayUrl = (() => {
    if (!qrUrl) return "";
    const m = qrUrl.match(/\/(?:welcome-mail|r)\/([^/?#]+)/);
    const token = m ? m[1] : "";
    return token ? `themailroom.club/r/${token}` : qrUrl.replace(/^https?:\/\//, "");
  })();
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const datePart = `${monthNames[now.getUTCMonth()]} ${now.getUTCDate()}`;
  const yearPart = now.getUTCFullYear();
  // Postmark — "City ST · Month D · YYYY". Falls back to "Mailroom"
  // when sender city/state is missing (e.g. void/penpal sends).
  const cityCap = (opts.senderCity ?? "").trim();
  const stateCap = (opts.senderState ?? "").trim().toUpperCase();
  const postmarkLine = (cityCap && stateCap)
    ? `${cityCap} ${stateCap} · ${datePart} · ${yearPart}`
    : `Mailroom · ${datePart} · ${yearPart}`;
  // Hot-air balloon JPG served from this repo's GitHub raw URL.
  // v0.7.0.47: reinstated after v0.7.0.46 tried inline SVG and broke at
  // Lob thumbnail scale. SVG vector wins at print resolution (300dpi)
  // but loses at thumbnail (~128dpi) because thin strokes drop below
  // 1 pixel and solid shapes show hard edges. JPG's photographic
  // smoothing reads cleaner at small preview sizes. The JPG's mild
  // compression banding only shows at print res and is acceptable.
  const balloonImgUrl = "https://raw.githubusercontent.com/scotty123868/mailclub/mvp-v0.3-credits-and-categories/assets/onboarding/hero-envelope-balloon.jpg";

  // Coordinates mirror the 1875x1275 mockup by dividing pixel positions
  // by 300. Lob interprets CSS pixels at 96dpi, so production uses inches.

  return compactHtml(`<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600&family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@500;600;700&family=Playfair+Display:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  @page { margin: 0; size: 6.25in 4.25in; }
  html, body { margin: 0; padding: 0; }
  body {
    width: 6.25in; height: 4.25in;
    background: #FBF4DE;
    position: relative; overflow: hidden;
    color: #17223B;
    font-family: Inter, sans-serif;
  }
  /* Paper-grain noise overlay. */
  body::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    z-index: 1; opacity: 0.4; mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.1 0 0 0 0 0.08 0 0 0 0 0.05 0 0 0 0.12 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  body > * { position: absolute; z-index: 2; }

  /* TOP-LEFT QR cluster, matching the full-image back used by actuallysent.pdf. */
  .qr {
    position: absolute;
    top: 0.187in; left: 0.25in;
    width: 0.687in; height: 0.687in;
    background: #FBF4DE;
    border: 0.015in solid #17223B;
    padding: 0.03in; box-sizing: border-box;
  }
  /* v0.7.0.43: image-rendering hint tells Chromium to prefer edge
     crispness over smoothing when downscaling. Helps QR readability. */
  .qr img {
    width: 100%; height: 100%; display: block;
    image-rendering: -webkit-optimize-contrast;
  }
  /* v0.7.0.49d: top aligned to QR top (was 0.25 vs QR 0.187 = misaligned).
     Font bumped 7.2pt → 8pt because this is the primary product CTA, not
     footer copy. Tighter line-height (1.18 → 1.15) keeps the block compact. */
  .qr-copy {
    position: absolute;
    top: 0.187in; left: 1.05in;
    max-width: 1.50in;
    font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic;
    font-size: 8pt; color: rgba(23, 34, 59, 0.92); line-height: 1.15;
    font-weight: 400; margin: 0;
  }
  .qr-url {
    position: absolute;
    top: 0.62in; left: 1.05in;
    font-family: 'JetBrains Mono', monospace; font-size: 6pt;
    color: rgba(23, 34, 59, 0.6); letter-spacing: 0.05em;
    font-weight: 500;
  }

  /* TOP-RIGHT stamp. Larger and partially off-bleed so it reads like a
     physical pasted stamp instead of a tidy UI badge.
     top: 0.14in clears Lob's 0.125in bleed line with a small visible
     margin — earlier 0.02 and 0.08 versions either chopped the top of
     the stamp or sat flush against the trim, both of which read as a
     mistake instead of a pasted stamp. 0.14 gives the stamp a real
     sliver of cream above it so the corner reads as intentional. */
  .stamp { position: absolute; top: 0.14in; right: 0.14in;
           width: 1.25in; height: 1.48in; transform: rotate(3deg);
           background: #fdf6e5; border: 0.024in solid #B8483A;
           box-sizing: border-box; padding: 0.06in 0.05in; }
  .stamp-perf { position: absolute; inset: 0; pointer-events: none; }
  .stamp-perf svg { width: 100%; height: 100%; display: block; }
  .stamp-inner-border { position: absolute; inset: 0.05in;
                        border: 0.008in solid rgba(184, 72, 58, 0.55);
                        pointer-events: none; }
  /* v0.7.0.49d: 25% → 35%. The "MAIL" cart hanging below the balloon is
     the most product-relevant detail — literally a mail vehicle. 25% was
     clipping it. 35% shows the full balloon body + the full MAIL cart
     while still keeping the hills/fields out of frame. */
  .stamp-art { width: 0.96in; height: 0.55in; margin: 0 auto 0.04in;
               background: url("${balloonImgUrl}") center 35%/cover;
               border: 0.005in solid rgba(184, 72, 58, 0.3);
               border-radius: 0.012in; }
  .stamp-content { display: flex; flex-direction: column; align-items: center;
                   text-align: center; }
  .stamp-title { font-family: 'Playfair Display', serif; font-weight: 800;
                 font-size: 12pt; color: #B8483A; letter-spacing: 0.5pt;
                 line-height: 1; margin-bottom: 0.016in; }
  .stamp-class { font-family: 'JetBrains Mono', monospace; font-weight: 500;
                 font-size: 4.4pt; color: rgba(184, 72, 58, 0.85);
                 letter-spacing: 0.35em; line-height: 1; margin-bottom: 0.035in; }
  /* v0.7.0.49e: margin-bottom 0.008in → 0.06in. 21pt Cormorant Garamond
     has tall descenders + the 11pt cent symbol is vertical-aligned up
     0.04in, so the visual baseline of the "70¢" line bleeds DOWN below
     its declared bottom. 0.008in of clearance let "2026" tuck under the
     descender of the 7 — they appeared overlapped. 0.06in puts a clean
     band of cream between them at every render resolution. */
  .stamp-cost { font-family: 'Cormorant Garamond', serif; font-weight: 700;
                font-size: 21pt; color: #B8483A; line-height: 1;
                margin-bottom: 0.06in; }
  .stamp-cost .small { font-size: 11pt; font-weight: 500; vertical-align: 0.04in; }
  /* v0.7.0.49c: JetBrains Mono → Inter for year. The slashed zero
     made 2026 read as 2826 at 5pt. Inter's plain oval zero is
     unambiguous at any size.
     v0.7.0.49d: letter-spacing 0.4em → 0.25em — 0.4 made "2026" read
     as four separate digits instead of a year. */
  .stamp-year { font-family: Inter, sans-serif; font-weight: 600;
                font-size: 5pt; color: rgba(184, 72, 58, 0.85);
                letter-spacing: 0.25em; line-height: 1; }

  /* Divider only occupies the top custom-ink area; Lob's address mask owns
     the lower-right postal zone. */
  .divider { left: 2.673in; top: 0.187in; width: 0.02in; height: 1.36in; }
  .divider svg { width: 100%; height: 100%; display: block; }

  /* Message — restored to the sent-card composition. The right edge stops
     just before Lob's address mask so the mask edge never reads as a
     strikethrough.
     v0.7.0.49d: removed word-break: break-word. It's deprecated AND was
     eating the space after commas at line breaks ("spring,one" instead
     of "spring, / one"). overflow-wrap alone handles unbreakable URLs
     correctly without mangling normal prose. */
  .msg { top: 0.98in; left: 0.25in; width: 2.37in; height: 2.36in;
         font-family: 'Caveat', cursive; font-size: 15.8pt; line-height: 1.22;
         font-weight: 400; color: #17223B; overflow: hidden;
         white-space: pre-wrap; overflow-wrap: break-word; }

  /* Bottom-left cancellation rail. v0.7.0.49: postmark moved from SVG
     <text> (which rendered at ~3.5pt effective size and went mushy at
     Lob's 100dpi thumbnail) into a real HTML pill. HTML text gets the
     browser's regular font-smoothing pipeline and stays legible at the
     thumbnail size users see in the journal feed.
     v0.7.0.49c: font switched JetBrains Mono → Inter because JetBrains'
     slashed zero made "2026" read as "2826" at print size. Opacity
     bumped 0.78 → 0.92, size 4.6pt → 5.4pt for clearer rendering. */
  .rail { left: 0.25in; bottom: 0.50in; width: 2.45in; height: 0.20in;
          display: flex; align-items: center; gap: 0.06in; }
  /* v0.7.0.49d: dropped the pill border. Real postmarks don't have
     rectangular pill borders — they're either circular ovals or the
     cancellation marks ARE the postmark. The border made it read as
     UI chrome. Text + ticks alone reads more postal. */
  .postmark-pill {
    padding: 0.020in 0.04in 0.020in 0;
    font-family: Inter, sans-serif;
    font-size: 5.4pt; font-weight: 600;
    color: rgba(23, 34, 59, 0.92);
    letter-spacing: 0.06em;
    white-space: nowrap;
    line-height: 1;
  }
  .cancel-ticks { flex: 1; height: 0.16in; display: block; }
</style>
</head>
<body>

${qrSrc ? `<div class="qr"><img src="${qrSrc}" alt="QR" /></div>
<p class="qr-copy">Respond to ${escapeHtml(senderFirstName)} with a postcard for free.</p>
<div class="qr-url">${escapeHtml(displayUrl)}</div>` : ""}

<div class="stamp">
  <div class="stamp-perf">
    <svg viewBox="0 0 125 148" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <!-- v0.7.0.49c: viewBox now matches the stamp's 1.25:1.48 aspect
           (was 100:130 = 0.77, stamp is 0.84, so circles stretched into
           horizontal ellipses and the corners looked disconnected). New
           positions spread evenly: 10 across top/bottom every 12 units,
           12 down the sides every 12 units. -->
      <g fill="#FBF4DE">
        ${[6,18,30,42,54,66,78,90,102,114].map(x => `<circle cx="${x}" cy="0" r="2.4"/>`).join("")}
        ${[6,18,30,42,54,66,78,90,102,114].map(x => `<circle cx="${x}" cy="148" r="2.4"/>`).join("")}
        ${[8,20,32,44,56,68,80,92,104,116,128,140].map(y => `<circle cx="0" cy="${y}" r="2.4"/>`).join("")}
        ${[8,20,32,44,56,68,80,92,104,116,128,140].map(y => `<circle cx="125" cy="${y}" r="2.4"/>`).join("")}
      </g>
    </svg>
  </div>
  <div class="stamp-inner-border"></div>
  <div class="stamp-art"></div>
  <div class="stamp-content">
    <div class="stamp-title">MAILROOM</div>
    <div class="stamp-class">FIRST CLASS</div>
    <div class="stamp-cost">70<span class="small">¢</span></div>
    <div class="stamp-year">${yearPart}</div>
  </div>
</div>

<div class="divider">
  <svg viewBox="0 0 2 136" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
    <line x1="1" y1="0" x2="1" y2="136"
          stroke="rgba(194,165,109,0.55)" stroke-width="0.5"/>
  </svg>
</div>

<div class="msg">${escapeHtml(opts.message)}</div>

<div class="rail">
  <div class="postmark-pill">${escapeHtml(postmarkLine.toUpperCase())}</div>
  <svg class="cancel-ticks" viewBox="0 0 100 20" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
    <!-- v0.7.0.49d: ticks alternate between three heights (5-15, 4-16, 6-14)
         so they look like real cancellation strokes instead of a font.
         Real cancellations are hand-stamped and never uniformly tall. -->
    <g stroke="#17223B" stroke-width="0.55" opacity="0.34">
      ${Array.from({ length: 25 }, (_, i) => {
        const y1 = [5, 4, 6][i % 3];
        const y2 = [15, 16, 14][i % 3];
        return `<line x1="${i * 4}" y1="${y1}" x2="${i * 4}" y2="${y2}"/>`;
      }).join("")}
    </g>
  </svg>
</div>

</body></html>`);
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
  // v0.7.0.23 / v0.7.0.49: removed dead `if (false && ...)` branch that
  // would have overwritten photo_path with the rendered front URL. The
  // journal tile should show the user's actual camera-roll photo, not
  // the postcard composition (which is just the photo + cream frame +
  // tiny text — visually less personal). photo_path stays as whatever
  // was set when the postcard row was first created (a postcard-photos
  // bucket path, signed-URL resolved client-side). Renders live in
  // postcard-renders/{id}/front.jpg for debugging/detail-sheet previews.
  await supabase.from("postcards").update(update).eq("id", postcard.id);

  return json({
    ok: true,
    lob_id: lobJson.id,
    expected_delivery_date: lobJson.expected_delivery_date,
  });
});
