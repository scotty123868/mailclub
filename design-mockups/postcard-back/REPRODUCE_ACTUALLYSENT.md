# Reproducing the "actuallysent" postcard back

Verified `2026-05-18` against Lob postcard `psc_7ad5383e96a4c31d`. The
current `buildBackHtml()` in `supabase/functions/lob-send-postcard/index.ts`
reproduces the reference design at Lob's renderer with one intentional
difference: the QR URL domain (`themailroom.club/r/` replaces the older
`mailroom.app/r/`).

The point of this doc: when the design drifts again (it will), someone
can run the same flow and know exactly what should come out.

## Three files form the contract

1. `supabase/functions/lob-send-postcard/index.ts` — `buildBackHtml()`,
   currently at git ref `48a58a6`. The whole template literal between
   `return compactHtml(\`` and `</body></html>\`)` is the source of truth.
   Front uses `buildFrontHtml()` in the same file — out of scope here.
2. `/tmp/build_test_back.py` — extracts the template literal, substitutes
   reference data (Hi Tati message, balloon stamp URL, `A8B4F2` token,
   `CHEVY CHASE MD · MAY 18 · 2026` postmark). Expands the perforation
   `.map().join()` patterns and the rail tick `Array.from()` loop into
   static SVG so the output is valid HTML, not a JS string.
3. The `compactHtml()` minifier inside `index.ts` — strips comments,
   collapses whitespace, drops trailing `;}`. Same rules ported to the
   Node one-liner below. Result must stay under Lob's 10KB inline cap.

## Repro recipe

```bash
# 1) Regenerate test HTML from current buildBackHtml + reference data
cd ~/Code/mailclub-app
python3 /tmp/build_test_back.py
# → /tmp/test-back-current.html (~9.5KB)

# 2) Compact using same rules as compactHtml()
node -e "
const html = require('fs').readFileSync('/tmp/test-back-current.html', 'utf8');
const compact = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{};:,>])\s*/g, '\$1')
  .replace(/;\}/g, '}')
  .trim();
require('fs').writeFileSync('/tmp/test-back-current-min.html', compact);
console.log('compacted:', compact.length, 'bytes');
"
# → /tmp/test-back-current-min.html (~8.4KB, well under 10KB cap)

# 3) Submit to Lob (test key — get from supabase secrets list / Lob dashboard)
export LOB_TEST_KEY='test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
curl -s -u "${LOB_TEST_KEY}:" https://api.lob.com/v1/postcards \
  -F "description=mailroom-repro" \
  -F "to[name]=Scotty Lefkowitz" \
  -F "to[address_line1]=861 N Humboldt St Apt B" \
  -F "to[address_city]=Denver" -F "to[address_state]=CO" \
  -F "to[address_zip]=80218" -F "to[address_country]=US" \
  -F "from[name]=Mailroom" \
  -F "from[address_line1]=5209 Dorset Avenue" \
  -F "from[address_city]=Chevy Chase" -F "from[address_state]=MD" \
  -F "from[address_zip]=20815" -F "from[address_country]=US" \
  -F "front=@/tmp/test-front.html" \
  -F "back=@/tmp/test-back-current-min.html" \
  -F "use_type=marketing" -F "size=4x6"

# 4) Wait ~12s for thumbnail rendering, then fetch
sleep 12
curl -s -u "${LOB_TEST_KEY}:" https://api.lob.com/v1/postcards/psc_XXX \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['thumbnails'][1]['large'])"
# Download that URL, view, compare to actuallysent.pdf
```

## Acceptance checklist

When the design is correct, the Lob back render must show:

- [ ] QR code top-left at ~0.7×0.7in. Black on cream background. Token
      embedded as `https://app.themailroom.club/welcome-mail/{TOKEN}`.
- [ ] To the right of QR: "Respond to Scotty with a postcard for free."
      in small sans, then `themailroom.club/r/{TOKEN}` in monospace below.
- [ ] Handwritten message in Caveat 15.8pt left-aligned, starts top:0.98in.
      Wraps inside a 2.37×2.36in box. No clipping at right edge.
- [ ] Stamp top-right corner: balloon JPG (top portion shows balloon +
      clouds + sun, NOT the hills/fields), partially off-bleed at 3° tilt,
      1.25×1.48in. Below the artwork: `MAILROOM` 12pt, `FIRST CLASS` 4.4pt,
      `70¢` 21pt, year 5pt — all in #B8483A red.
- [ ] Lob auto-overlays in the right half (do NOT include in our HTML):
      return address top, POSTAGE INDICIA box, IMB barcode middle,
      delivery address bottom.
- [ ] Bottom-left rail: pill-shaped postmark `CHEVY CHASE STATE · MONTH DAY ·
      YEAR` followed by 25 vertical cancellation tick marks at 4px spacing.

## Lob gotchas that bit us repeatedly

- **10KB inline HTML cap.** The minified back must stay under 10240 bytes
  for the `back` form field. Going over throws a 422 without a clear
  reason. Track size after every CSS edit.
- **CSS at 96dpi.** Lob interprets CSS as 96dpi but renders print at 300dpi.
  Use `in` units everywhere — `px` will scale differently between the
  thumbnail (100dpi) and the printed card.
- **No `repeating-linear-gradient`.** Causes banding artifacts in Lob's
  renderer. Use repeated SVG `<line>` or `<circle>` elements instead
  (the perforation + tick rail expansion in `build_test_back.py`).
- **No `-webkit-mask`.** Silently dropped. Use SVG clip paths or just
  position elements as actual children.
- **`size: "4x6"` not `"6x4"`.** Lob's enum order matters even though the
  card is landscape. (`@page { size: 6.25in 4.25in }` inside CSS is
  separately correct — that's the bleed-inclusive print size.)
- **Test keys do not verify addresses.** `/us_verifications` returns
  "undeliverable" for every address with a test key. Don't infer real
  USPS rejects from a test-key result.
- **Stamp artwork crop.** Balloon JPG is hosted at
  `https://raw.githubusercontent.com/scotty123868/mailclub/mvp-v0.3-credits-and-categories/assets/onboarding/hero-envelope-balloon.jpg`.
  Our CSS uses `object-fit: cover; object-position: 50% 5%` so the top
  portion (balloon + sky) shows, not the bottom (hills + fields). When
  Codex's v2/v3 attempts looked wrong, it was because the stamp had
  drifted to showing the landscape — visible diagnostic.

## Why this was hard

Three failure modes piled on top of each other across the v15-v21 cycle:

1. CSS that worked in browser preview broke in Lob's renderer
   (`-webkit-mask`, `repeating-linear-gradient`, certain `transform-origin`
   combos with `rotate`). The local preview lied.
2. The 10KB cap meant every "improvement" had to be paid for in bytes
   somewhere else. The compactor saved some, but adding a feature
   without removing one would silently push over the limit.
3. Codex's outside reviews kept generating designs that LOOKED nicer in
   isolation but didn't replicate the reference — different stamp art,
   missing cancellation rail, wrong domain. Without a working repro
   command, every iteration started from "is this even right?" again.

The fix was getting back to a known-good state (this doc's recipe) and
then making small targeted edits with the round-trip verified each time.

## Verified renders

- Reference: `~/Downloads/actuallysent.pdf` (originally sent via Lob,
  date approx 2026-05-16 per the postmark)
- Reproduction: Lob postcard `psc_7ad5383e96a4c31d` submitted 2026-05-18,
  back thumbnail downloaded to `/tmp/psc_7ad5_back_large.png`.
- Local preview rendered via headless Chrome at 100dpi
  (`/tmp/back-current-100dpi.png`) — matches Lob output for the LEFT half
  of the card; the right half is filled by Lob's address overlays at
  print time.

## v0.7.0.49 pressure test (2026-05-18)

Four input variants submitted to Lob to verify the design holds up under
real-world variation. All four cleared visual QA with no overlap, no
truncation into the address mask, and no orphaned elements.

| Variant       | Lob postcard ID         | What it stresses                                |
|---------------|-------------------------|-------------------------------------------------|
| canonical     | psc_dc416ebf3ded708e    | Smoke test — the reference data                 |
| long_message  | psc_4439fc562a66a9c6    | Multi-paragraph message overflow (8 lines)      |
| long_city     | psc_7e7aeb5061d5cfb0    | "SAN BUENAVENTURA CA · DEC 31 · 2026" postmark  |
| no_qr         | psc_a7ee09a44ed3c336    | Empty reciprocationUrl — entire QR cluster gone |

How to run the pressure test:

```bash
python3 /tmp/pressure_test_back.py
# Submits all 4 variants. Output includes the Lob psc_ IDs.
# Compacted size for each must be <= 10240 bytes (Lob inline cap).
```

What "passing" looks like:

- **70¢ and the year do not overlap.** Cormorant Garamond at 21pt with
  `vertical-align: 0.04in` on the cent symbol bleeds DOWN below its
  declared bottom edge. v0.7.0.49e bumped `.stamp-cost` margin-bottom
  from 0.008in → 0.06in to give the year a clean band of cream above it.
- **The handwriting box clips at its declared height.** `overflow: hidden`
  on `.msg` means a long message gets visually truncated at 2.36in tall
  rather than spilling into Lob's right-half address mask. The truncation
  is a feature: it bounds the message length the design supports without
  exploding the layout.
- **QR is variable.** The same template renders distinct QR codes for
  every token, and the `displayUrl` line below the QR mirrors the token.
- **Postmark date is variable.** `new Date()` at send time supplies the
  month/day/year, and `senderCity`/`senderState` parameters become the
  city prefix. Falls back to "Mailroom" when those are missing.
- **No-QR fallback is graceful.** When `reciprocationUrl` is empty, the
  entire QR + companion text + URL stripe disappears — no empty box, no
  ghost elements, no shifted layout for the rest of the composition.

If you change `buildBackHtml()` and any of the four variants regresses,
either revert the change or carry the regression with explicit
justification in the commit message.
