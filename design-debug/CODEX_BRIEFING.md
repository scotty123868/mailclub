# Postcard back design. handing off to Codex

## TL;DR

We're sending postcards through Lob's API. The back of the postcard is
rendered server-side from inline HTML by Lob's headless Chrome, then
printed at ~300dpi onto cardstock. Lob also generates a **600×400 PNG
thumbnail (100dpi)** that we display in-app as a preview before mailing.

The print itself looks great. **The thumbnail does not.** Specifically:

1. Certain lines of the handwritten message render with a visible
   horizontal "strikethrough" band. a font anti-aliasing artifact at
   100dpi where dense lowercase letterforms create a dark pixel row at
   the x-height midline.
2. The postmark cancellation bars (the row of vertical rectangles next
   to the postmark circle) look chunky and pixelated in the thumbnail.

We've iterated 7 times on this (v15 → v21) and the user is rightly
frustrated. The user is the design eye on this project. He's asking for
a second opinion from Codex.

## The source of truth

Production renderer:
**`supabase/functions/lob-send-postcard/index.ts`**. function
`buildBackHtml()` starts around line 110. It builds the back HTML string
and runs it through `compactHtml()` (a minifier. Lob caps inline HTML
at 10 000 chars) before posting to Lob.

Design mockup (the canonical visual reference, in pixel units for
1875×1275 screenshot):
**`design-mockups/postcard-back/C2-print.html`**

Test artifacts in this directory:
- `v21-back-current-readable.html`. current state of the back HTML
  (test data filled in, no minification, readable).
- `v21-back-current.html`. same content, after `compactHtml()`. This
  is exactly what Lob receives (8 793 bytes, under the 10 000 cap).
- `v20-lob-thumbnail-caveat-banding.png`. the actual Lob thumbnail
  from v20 (Caveat font). Multiple message lines show the strikethrough
  banding very clearly. **This is what the user sees in-app.**
- `v20-local-100dpi-caveat.png`. same HTML rendered through local
  headless Chrome at 100dpi. Matches Lob's output dimensions.
- `v21-local-100dpi-patrickhand.png`. v21 with Patrick Hand instead
  of Caveat. Banding much reduced but still present on one line.
- `v18-local-300dpi-print-fidelity.png`. what actually gets printed.
  Crisp and clean. Confirms the issue is purely a thumbnail-scale
  rendering artifact, not a design problem.

## Hard constraints we can't change

1. **Lob inline HTML payload ≤ 10 000 characters** after minification.
   `compactHtml()` strips comments + minifies CSS. We have ~1KB of
   headroom currently.
2. **Lob renders through headless Chrome** but several CSS features
   don't render:
   - `-webkit-mask` → element invisible
   - `repeating-linear-gradient` → no fill
   - SVG `<image href="external-url"/>` → doesn't load
3. **Pixel units in CSS are interpreted at 96dpi** but the print
   output is 300dpi. The C2-print mockup uses pixels at 300dpi (1875×1275
   for a 6.25×4.25in card); `buildBackHtml` uses **inch units** to
   sidestep the dpi mismatch.
4. **Card size: 6.25 × 4.25 inches.** `@page { margin: 0; size: 6.25in 4.25in; }`
5. **Lob prints the recipient address + IMb barcode + indicia in the
   right half of the back**, roughly `x = 2.85in to 6.0in, y = 1.55in to 3.55in`.
   Designer chrome must stay clear of that zone or risk being overprinted.
6. **The thumbnail is 600 × 400 PNG at 100dpi.** Test it locally with:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --headless --disable-gpu --no-sandbox --hide-scrollbars \
     --force-device-scale-factor=1.0 \
     --window-size=600,408 \
     --screenshot=/tmp/test.png \
     "file:///path/to/test-back.html"
   ```

## What we've already tried

Iteration log (most recent first):

| ver | change | result |
|----|---|---|
| v21 | Caveat → Patrick Hand 13pt | Banding reduced from 3 lines to 1 line. Still visible. |
| v20 | Reverted v19 (SVG balloon flopped) back to v18 | Baseline good. Caveat banding still showed. |
| v19 | Replaced JPG stamp with inline SVG balloon illustration | Print-resolution great. Thumbnail worse. tiny vector strokes vanished at 100dpi. **Rolled back.** |
| v18 | Fixed Scotty descender clip + lightened cancellation bars + bolder frame | Improvements, but Caveat banding remained. |
| v17 | Removed 4 corner stars, added publisher cartouche at bottom | Cleaner. Cartouche reads as authentic vintage publisher imprint. |
| v16 | Removed POST·CARD header + CORRESPONDENCE label (user feedback: clutter) | Cleaner. |
| v15 | Added outer hairline border, 4 corner fleurons, POST·CARD header, CORRESPONDENCE label, dotted divider, restructured postmark, Roman year, QR 400→1200 + ECC=H | Too much decoration. |

## Specific things still broken

### 1. Message font banding

Look at `v20-lob-thumbnail-caveat-banding.png` and
`v21-local-100dpi-patrickhand.png`. Caveat had pronounced horizontal
"strikethrough" lines through message lines 4, 5, and 6 in the user's
in-app preview. Switching to Patrick Hand at 13pt reduced it but **one
line still bands**.

Hypothesis: at 100dpi, the x-height midline of dense lowercase
letterforms accumulates dark anti-aliased pixels into a visible row.
Patrick Hand has cleaner verticals so the effect is less pronounced
than Caveat's swashy mid-stroke crossings, but it isn't fully gone.

Constraint: needs to remain a handwritten-feeling font (it's the
emotional core of a personal postcard).

### 2. Postmark cancellation bars look pixelated

The 14 vertical rectangles next to the postmark circle. At 100dpi each
rect is roughly 5 × 28 SVG units, which at the postmark's 2.50 × 0.55in
rendered size = roughly 5 × 18 thumbnail pixels per bar. They look
chunky/blocky.

Source location: search `buildBackHtml` for `<!-- v0.7.0.46: cancellation bars`.

### 3. Overall thumbnail "soft" feel

Inherent to 100dpi rasterization. May be impossible to fully fix without
either (a) Lob serving a higher-res thumbnail, or (b) designing for
much bolder/larger features that survive 100dpi.

## What we'd love Codex to do

1. **Read the current `buildBackHtml`** and the test artifacts in this
   directory. Look at the thumbnail PNGs to see exactly what the user
   sees.
2. **Identify the root cause** of the message-line banding artifact at
   100dpi. We've assumed it's font-related but maybe there's another
   mechanism (some kind of Lob renderer quirk, baseline alignment to
   pixel grid, sub-pixel anti-aliasing strategy, etc.).
3. **Propose a fix that works at 100dpi** specifically. because that's
   the surface the user judges by. Bonus if the fix also doesn't hurt
   print fidelity.
4. **Also look at the postmark cancellation bars**. they look like
   slightly chunky/pixelated rectangles in the thumbnail. Suggest a
   form that reads cleaner at 100dpi while still feeling like a real
   period postal cancellation.
5. **Stay inside the constraints** above. Especially the 10KB inline
   HTML limit and the Lob ink-free zone for the address.

The design north star: an authentic-feeling vintage postcard back
(divider, handwritten message, postmark, stamp top-right, QR top-left,
publisher cartouche at bottom) that reads as crafted and beautiful at
**both** 100dpi (thumbnail surface users see in-app) and 300dpi (the
actual mailed print).

## How to reproduce locally

The test HTML file in this directory is self-contained. To re-render
the thumbnail exactly as Lob would:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=1.0 \
  --window-size=600,408 \
  --screenshot=/tmp/postcard-thumb.png \
  "file://$(pwd)/v21-back-current-readable.html"
```

To re-render at print fidelity (300dpi):

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=3.125 \
  --window-size=600,408 \
  --screenshot=/tmp/postcard-print.png \
  "file://$(pwd)/v21-back-current-readable.html"
```

To submit a test postcard to Lob (test key is in this branch's history,
or ask the user for `LOB_API_KEY` test key):

```bash
LOB_KEY="test_..."
BACK_HTML=$(cat v21-back-current.html)   # the minified one
curl -sS -X POST https://api.lob.com/v1/postcards \
  -u "$LOB_KEY:" \
  --data-urlencode "to[name]=Test" \
  --data-urlencode "to[address_line1]=5209 Dorset Ave" \
  --data-urlencode "to[address_city]=Chevy Chase" \
  --data-urlencode "to[address_state]=MD" \
  --data-urlencode "to[address_zip]=20815" \
  --data-urlencode "from[name]=Test" \
  --data-urlencode "from[address_line1]=5209 Dorset Ave" \
  --data-urlencode "from[address_city]=Chevy Chase" \
  --data-urlencode "from[address_state]=MD" \
  --data-urlencode "from[address_zip]=20815" \
  --data-urlencode "size=4x6" \
  --data-urlencode "front=<minimal front html>" \
  --data-urlencode "back=$BACK_HTML" \
  --data-urlencode "use_type=operational"
```

The response includes `thumbnails[1].large` which is the 600×400 PNG.
That's the surface that matters.
