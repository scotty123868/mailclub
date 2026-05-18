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

// v0.7.0.45: Roman numeral helper for the publisher cartouche. Real
// vintage postcards used Roman numerals for the year in their publisher
// imprints (Curt Teich, A. Mainzer, etc.). Authentic small touch.
function toRomanNumeral(n: number): string {
  const map: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let result = "";
  for (const [val, sym] of map) {
    while (n >= val) { result += sym; n -= val; }
  }
  return result;
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

function buildBackHtml(opts: {
  message: string;
  senderName?: string;
  senderCity?: string;
  senderState?: string;
  reciprocationUrl?: string;
}): string {
  // v0.7.0.34 — EXACT C2 vintage-purist v2 (print-ready) layout, lifted
  // verbatim from design-mockups/postcard-back/C2-print.html. Earlier
  // versions either (a) drifted into a simplification that lost the
  // brand voice [build 14] or (b) re-invented a near-miss approximation
  // [v0.7.0.33]. This commit pins to the saved mockup as the source of
  // truth.
  //
  // Source: design-mockups/postcard-back/C2-print.html (1875×1275 px,
  // 300dpi for Lob's 4×6). Templates only the dynamic data
  // (senderFirstName, sender city/state, message, QR/URL, year).
  //
  // Assets:
  //   - Hot-air balloon JPG: served from the public GitHub raw URL of
  //     the assets/onboarding/hero-envelope-balloon.jpg in this repo.
  //     Lob's renderer fetches it at render time. Cached by GitHub for
  //     5 min on raw.githubusercontent.com.
  //   - Fonts: loaded via Google Fonts CDN @import. Caveat (message),
  //     Cormorant Garamond (italic copy), Playfair Display (display
  //     numerals + MAILROOM wordmark), JetBrains Mono (URL + postmark
  //     + stamp-class).
  //   - QR: rendered server-side by api.qrserver.com with the actual
  //     reciprocation URL. Replaces the CSS-gradient placeholder used
  //     in the static mockup.
  //
  // Lob zones honored: address ink-free zone is right-half y=1.625"
  // and below (which here in 1875×1275 pixels = 488 px). Our designer
  // chrome (QR, stamp, message, postmark) all fit in the left + top
  // 1875×488 region with the divider at x=808px (=2.69in).

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
  // Display URL under the QR: short form using the /r/:token Vercel
  // rewrite which resolves to /welcome-mail/:token.
  const displayUrl = (() => {
    if (!qrUrl) return "";
    const m = qrUrl.match(/\/(?:welcome-mail|r)\/([^/?#]+)/);
    const token = m ? m[1] : "";
    return token ? `themailroom.club/r/${token}` : qrUrl.replace(/^https?:\/\//, "");
  })();
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthNamesUpper = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const now = new Date();
  const datePart = `${monthNames[now.getUTCMonth()]} ${now.getUTCDate()}`;
  const yearPart = now.getUTCFullYear();
  // v0.7.0.43: vintage cancellation date format. e.g. "MAY-18-2026".
  // Mimics real USPS hand-cancel stamps from the linen-postcard era.
  const dateCancel = `${monthNamesUpper[now.getUTCMonth()]}-${String(now.getUTCDate()).padStart(2, "0")}-${yearPart}`;
  // Postmark — "City ST · Month D · YYYY". Falls back to "Mailroom"
  // when sender city/state is missing (e.g. void/penpal sends).
  const cityCap = (opts.senderCity ?? "").trim();
  const stateCap = (opts.senderState ?? "").trim().toUpperCase();
  const postmarkLine = (cityCap && stateCap)
    ? `${cityCap} ${stateCap} · ${datePart} · ${yearPart}`
    : `Mailroom · ${datePart} · ${yearPart}`;
  // v0.7.0.43: combined city+state for the new two-line postmark layout.
  const cityStateLine = (cityCap && stateCap)
    ? `${cityCap.toUpperCase()} ${stateCap}`
    : "MAILROOM";
  // v0.7.0.45: publisher cartouche year in Roman numerals (real vintage
  // postcards used Roman year stamps in publisher imprints).
  const romanYear = toRomanNumeral(yearPart);

  // Hot-air balloon JPG served from this repo's GitHub raw URL.
  // v0.7.0.47: reinstated after v0.7.0.46 tried inline SVG and broke at
  // Lob thumbnail scale. SVG vector wins at print resolution (300dpi)
  // but loses at thumbnail (~128dpi) because thin strokes drop below
  // 1 pixel and solid shapes show hard edges. JPG's photographic
  // smoothing reads cleaner at small preview sizes. The JPG's mild
  // compression banding only shows at print res and is acceptable.
  const balloonImgUrl = "https://raw.githubusercontent.com/scotty123868/mailclub/mvp-v0.3-credits-and-categories/assets/onboarding/hero-envelope-balloon.jpg";

  // v0.7.0.35 — same C2-print VISUAL design as v0.7.0.34 but with
  // INCH-based positions instead of pixel. The mockup was sized in
  // 1875×1275 pixels for a Chromium --window-size screenshot; Lob's
  // HTML renderer interprets those pixels at CSS's 96dpi instead of
  // print 300dpi, so the body overflowed the 6.25×4.25 page and Lob
  // clipped it (no stamp, message at wrong y, etc.).
  //
  // Coordinates converted px → inches by ÷ 300 (the original mockup
  // was designed at 300dpi). Visual details (perforated mask, oval
  // postmark ring, paper grain, balloon JPG, Google Fonts) preserved.

  return compactHtml(`<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@500;600;700&family=Playfair+Display:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
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

  /* v0.7.0.44: outer hairline frame + corner fleurons. Drawn as a single
     SVG to guarantee alignment in Lob's renderer (multi-element absolute
     positioning has bitten us before — see postmark, stamp). Inset 0.12in
     from page edge, stroke + fleurons sized for visibility in Lob's
     thumbnail preview (the thumbnail downsamples aggressively, so thin
     hairlines that look right at print resolution disappear). v15 had
     stroke 0.6 and fleurons r5 — invisible in thumbnail. */
  .frame { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
  .frame svg { width: 100%; height: 100%; display: block; }

  /* TOP-LEFT QR cluster. v0.7.0.38c: flex container was stacking
     vertically in Lob's renderer (same bug as the postmark). Switched
     to absolute positioning for each child so they're guaranteed to
     sit side-by-side. */
  .qr {
    position: absolute;
    top: 0.30in; left: 0.30in;
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
  .qr-copy {
    position: absolute;
    top: 0.38in; left: 1.05in;
    max-width: 1.50in;
    font-family: 'Cormorant Garamond', serif; font-style: italic;
    font-size: 9pt; color: #17223B; line-height: 1.25;
    font-weight: 500; margin: 0;
  }
  .qr-url {
    position: absolute;
    top: 0.77in; left: 1.05in;
    font-family: 'JetBrains Mono', monospace; font-size: 6pt;
    color: rgba(23, 34, 59, 0.6); letter-spacing: 0.05em;
    font-weight: 500;
  }

  /* TOP-RIGHT vintage stamp. v0.7.0.41: 10/10 design pass.
     - Removed the dot-line-dot flourish (was rendering as "/"
       glyph in Lob's renderer, made "FIRST CLASS" read as "/IRST CLASS")
     - Larger balloon (0.80×0.50 from 0.72×0.44) for visual weight
     - Bigger MAILROOM (10pt → 11pt), proper FIRST CLASS spacing
     - More confident 70¢ (18pt → 20pt) */
  /* v0.7.0.42: pulled inward — was clipping the "M" of MAILROOM
     because the 3° rotation extended the top-right corner past
     the 6.25in page edge. Right margin 0.30 → 0.38, width back
     to 0.98 from 1.05. Cleared the rotation overhang. */
  /* v0.7.0.44: nudged top 0.13 → 0.16in and right 0.38 → 0.40in so the
     stamp clears the bolder v16 outer border (was right on top of it). */
  .stamp { position: absolute; top: 0.16in; right: 0.40in;
           width: 0.98in; height: 1.30in; transform: rotate(3deg);
           background: #fdf6e5; border: 0.024in solid #B8483A;
           box-sizing: border-box; padding: 0.06in 0.05in; }
  .stamp-perf { position: absolute; inset: 0; pointer-events: none; }
  .stamp-perf svg { width: 100%; height: 100%; display: block; }
  .stamp-inner-border { position: absolute; inset: 0.05in;
                        border: 0.008in solid rgba(184, 72, 58, 0.55);
                        pointer-events: none; }
  /* v0.7.0.47: back to the JPG. Lob's thumbnail is the lossy preview
     surface real users see; vector strokes <1 thumbnail pixel just
     vanish at that scale, while a photo's smoothing reads as soft
     rather than broken. */
  .stamp-art { width: 0.75in; height: 0.46in; margin: 0 auto 0.035in;
               background: url("${balloonImgUrl}") center/cover;
               border: 0.005in solid rgba(184, 72, 58, 0.3);
               border-radius: 0.012in; }
  .stamp-content { display: flex; flex-direction: column; align-items: center;
                   text-align: center; }
  .stamp-title { font-family: 'Playfair Display', serif; font-weight: 800;
                 font-size: 10pt; color: #B8483A; letter-spacing: 0.5pt;
                 line-height: 1; margin-bottom: 0.016in; }
  .stamp-class { font-family: 'JetBrains Mono', monospace; font-weight: 500;
                 font-size: 4.2pt; color: rgba(184, 72, 58, 0.85);
                 letter-spacing: 0.35em; line-height: 1; margin-bottom: 0.035in; }
  .stamp-cost { font-family: 'Cormorant Garamond', serif; font-weight: 700;
                font-size: 19pt; color: #B8483A; line-height: 1;
                margin-bottom: 0.008in; }
  .stamp-cost .small { font-size: 11pt; font-weight: 500; vertical-align: 0.04in; }
  .stamp-year { font-family: 'JetBrains Mono', monospace; font-weight: 500;
                font-size: 5pt; color: rgba(184, 72, 58, 0.75);
                letter-spacing: 0.45em; line-height: 1; }

  /* v0.7.0.43: divider is now a positioned SVG so the dot terminators
     align perfectly with the rule (CSS pseudo-elements proved flaky in
     Lob's renderer in earlier iterations). 0.04in wide × 3.20in tall. */
  .divider { left: 2.673in; top: 0.40in; width: 0.04in; height: 3.20in; }
  .divider svg { width: 100%; height: 100%; display: block; }

  /* Message — v0.7.0.47: swapped Caveat → Patrick Hand. Caveat's
     dense midline (where loops cluster horizontally) created visible
     banding artifacts in Lob's 100dpi thumbnail. Patrick Hand has
     cleaner upright letterforms that downsample without that effect.
     Same handwritten-note vibe, much better thumbnail fidelity.
     Keeping at 13pt — Patrick Hand glyphs are wider than Caveat at
     the same point size, so 14pt was overflowing the 7-line capacity. */
  .msg { top: 1.25in; left: 0.30in; width: 2.35in; height: 1.85in;
         font-family: 'Patrick Hand', cursive; font-size: 13pt; line-height: 1.35;
         color: #17223B; overflow: hidden;
         white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word; }

  /* Postmark — v0.7.0.46: moved up (bottom 0.40 → 0.32, height 0.65 →
     0.55) to make room for the taller message. Circle scales down
     slightly but stays legible. */
  .postmark { position: absolute;
              left: 0.30in; bottom: 0.32in;
              width: 2.50in; height: 0.55in; }
  .postmark svg { width: 100%; height: 100%; display: block; }

  /* v0.7.0.45: publisher cartouche — one element replacing the 4 corner
     stars from v16. Sits at the bottom of the card, centered. Reads as
     an authentic vintage publisher imprint (like "Made by Curt Teich
     & Co., Chicago, U.S.A." on real linen postcards). Cormorant Garamond
     italic, small, low opacity so it functions as a print-mark not
     active text. Year in Roman numerals because that's what real vintage
     publisher imprints did. */
  .cartouche {
    position: absolute;
    bottom: 0.18in; left: 50%;
    transform: translateX(-50%);
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 500;
    font-size: 5.5pt;
    letter-spacing: 0.08em;
    color: rgba(23, 34, 59, 0.55);
    white-space: nowrap;
  }
  /* Postmark waves moved INTO the .postmark SVG above. No separate
     .postmark-waves class anymore. */
</style>
</head>
<body>

<!-- v0.7.0.45: outer frame only. Dropped the 4 corner fleurons from v16
     — real vintage postcards put a single publisher cartouche at the
     bottom (Curt Teich's "Made by Curt Teich & Co., Chicago, U.S.A.")
     not symmetric corner ornaments. The cartouche is added below as
     <div class="cartouche">. -->
<div class="frame">
  <svg viewBox="0 0 625 425" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
    <rect x="12" y="12" width="601" height="401" fill="none"
          stroke="rgba(23,34,59,0.55)" stroke-width="2"/>
  </svg>
</div>

${qrSrc ? `<div class="qr"><img src="${qrSrc}" alt="QR" /></div>
<p class="qr-copy">Respond to ${escapeHtml(senderFirstName)} with a postcard for free.</p>
<div class="qr-url">${escapeHtml(displayUrl)}</div>` : ""}

<div class="stamp">
  <div class="stamp-perf">
    <svg viewBox="0 0 100 130" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Cream perforation cutouts cutting into the stamp's outer border -->
      <g fill="#FBF4DE">
        ${[5,15,25,35,45,55,65,75,85,95].map(x => `<circle cx="${x}" cy="0" r="2.5"/>`).join("")}
        ${[5,15,25,35,45,55,65,75,85,95].map(x => `<circle cx="${x}" cy="130" r="2.5"/>`).join("")}
        ${[10,20,30,40,50,60,70,80,90,100,110,120].map(y => `<circle cx="0" cy="${y}" r="2.5"/>`).join("")}
        ${[10,20,30,40,50,60,70,80,90,100,110,120].map(y => `<circle cx="100" cy="${y}" r="2.5"/>`).join("")}
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

<!-- v0.7.0.43: divider as single SVG. ViewBox 4×320 (each unit 0.01in
     after scaling to 0.04in × 3.20in via CSS). Hairline rule with a
     small dot terminator at each end — the divider now feels punctuated
     rather than ending in nothing. -->
<div class="divider">
  <svg viewBox="0 0 4 320" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
    <line x1="2" y1="6" x2="2" y2="314"
          stroke="rgba(194,165,109,0.55)" stroke-width="0.5"/>
    <circle cx="2" cy="3" r="2" fill="rgba(194,165,109,0.85)"/>
    <circle cx="2" cy="317" r="2" fill="rgba(194,165,109,0.85)"/>
  </svg>
</div>

<div class="msg">${escapeHtml(opts.message)}</div>

<!-- v0.7.0.43: postmark restructured to a classic two-line cancellation
     stamp: CITY ST on top, MAY-18-2026 in the middle (no third line).
     Cleaner, more vintage, less calendar-app feel. -->
<div class="postmark">
  <svg viewBox="0 0 280 85" xmlns="http://www.w3.org/2000/svg">
    <!-- Outer ring -->
    <circle cx="42" cy="42" r="38" fill="none" stroke="#17223B" stroke-width="2" opacity="0.6"/>
    <!-- Inner double-stroke ring for authentic depth -->
    <circle cx="42" cy="42" r="33" fill="none" stroke="#17223B" stroke-width="0.7" opacity="0.4"/>
    <!-- City + state on top line -->
    <text x="42" y="36" text-anchor="middle" font-family="'JetBrains Mono', monospace"
          font-weight="600" font-size="6" fill="#17223B" opacity="0.85" letter-spacing="0.5">${escapeHtml(cityStateLine)}</text>
    <!-- Subtle horizontal rule between city and date -->
    <line x1="14" y1="42" x2="70" y2="42" stroke="#17223B" stroke-width="0.4" opacity="0.35"/>
    <!-- Hyphenated cancellation date in the middle -->
    <text x="42" y="55" text-anchor="middle" font-family="'JetBrains Mono', monospace"
          font-weight="700" font-size="8.5" fill="#17223B" opacity="0.9" letter-spacing="0.3">${dateCancel}</text>
    <!-- v0.7.0.46: cancellation bars lightened + narrowed.
         Was 8w × 32h × opacity 0.6 (heavy, parking-ticket feel).
         Now 5w × 28h × opacity 0.4 (elegant, real hand-cancel feel). -->
    <g fill="#17223B" opacity="0.4">
      <rect x="88"  y="28" width="5" height="28"/>
      <rect x="102" y="28" width="5" height="28"/>
      <rect x="116" y="28" width="5" height="28"/>
      <rect x="130" y="28" width="5" height="28"/>
      <rect x="144" y="28" width="5" height="28"/>
      <rect x="158" y="28" width="5" height="28"/>
      <rect x="172" y="28" width="5" height="28"/>
      <rect x="186" y="28" width="5" height="28"/>
      <rect x="200" y="28" width="5" height="28"/>
      <rect x="214" y="28" width="5" height="28"/>
      <rect x="228" y="28" width="5" height="28"/>
      <rect x="242" y="28" width="5" height="28"/>
      <rect x="256" y="28" width="5" height="28"/>
      <rect x="270" y="28" width="5" height="28"/>
    </g>
  </svg>
</div>

<!-- v0.7.0.45: publisher cartouche. Real vintage postcards always had
     a publisher imprint somewhere on the back identifying who made the
     card. The classic Curt Teich version was "Made by Curt Teich & Co.,
     Inc., Chicago, U.S.A." in tiny italic. This is Mailroom's. -->
<div class="cartouche">The Mailroom Postcard Company &nbsp;❦&nbsp; ${romanYear}</div>

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
