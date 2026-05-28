# Postcard design spec. front, back, and Lob requirements

This is the source of truth for **what gets printed**. When you tap Send, two images get generated (one for the front, one for the back) and POST'd to Lob, who prints + mails the physical card. This doc describes what those two images look like and the constraints they have to satisfy.

---

## Format

We're targeting **Lob 4×6 postcards** for v1. Specs:

| Dimension | Value |
|---|---|
| Physical size | 4.25 × 6.25 inches (with bleed) |
| Trim size (final card) | 4 × 6 inches |
| Resolution | 300 DPI |
| Render size (per side) | **1275 × 1875 pixels** (with bleed) |
| Safe area | 1.875 × 5.875 inches inside the trim (so important content stays clear of the cut) |
| Color profile | CMYK on Lob's side; we render in sRGB and Lob converts |
| File format | PNG (preferred for line art + photo mix) or JPG (for photo-heavy fronts) |
| Max file size | 5 MB per side |

Lob accepts the image as either a public URL (we'll generate signed Supabase Storage URLs) or as HTML (Lob renders the HTML server-side). **We're going with PNG URLs**. fewer surprises, easier to debug.

---

## Front. the photo side

```
┌──────────────────────────────────────────────────────┐
│                                                      │  ← bleed (1/8")
│   ┌──────────────────────────────────────────────┐   │
│   │                                              │   │
│   │                                              │   │
│   │                                              │   │
│   │              [ FULL-BLEED PHOTO ]            │   │
│   │                                              │   │
│   │                                              │   │
│   │                                              │   │
│   │  ┌────────────────────────────────────────┐  │   │
│   │  │ caption text, optional, 1-2 lines      │  │   │
│   │  └────────────────────────────────────────┘  │   │
│   │                                MAILROOM →   │   │  ← brand mark
│   └──────────────────────────────────────────────┘   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Rules:**
- **The photo bleeds to all four edges.** Lob trims about 1/16" off each side; nothing important should sit within 1/8" of the edge.
- **Aspect ratio: 1.5:1 landscape** (matches 6×4). If the user uploads a portrait photo, we display it center-cropped to 1.5:1. If we offer "fit instead of crop" later, we add a paper-colored background behind it.
- **Caption is optional.** When present, it sits in the bottom 12% of the card with a dark gradient scrim for legibility. Max 2 lines. Serif semi-bold, white.
- **Mailroom mark** is bottom-right, 80% white opacity, 2-letter spaced sans-bold. Tiny but readable. Brand insurance. friends who get a card know where it came from.

**Categories that produce a "Front":**
- **Photo card**. user-supplied photo, full-bleed
- **Place card**. a stylized template (city skyline / landmark illustration), no user photo
- **Custom card**. same as Photo for now
- **Handwritten note**. no photo; front is a paper-textured background with a stamp + postmark cluster (Lob still requires a front image; we serve a templated one)

---

## Back. the message side

USPS-style layout: vertical divider down the middle, message on the left, stamp + postmark + address on the right.

```
┌──────────────────────────────────────────────────────┐
│  FROM: SCOTTY, DENVER CO          ╱╲              │   │  ← top: return + stamp
│                                  STAMP            │   │
│                                                   │   │
│                                              ⊙    │   │  ← postmark
│  Thinking of you. I went                          │   │
│  back to that coffee shop                         │   │
│  we found in Brooklyn. it's                      │   │
│  still terrible.                                  │   │
│                                  Maya Ramirez     │   │  ← address block
│  Love,                           123 Main Street  │   │
│  Scotty                          Brooklyn NY      │   │
│                                  11201            │   │
│                                                   │   │
│                                  ──────────       │   │  ← USPS address lines
│                                  ──────────       │   │
│                                  ──────────       │   │
└──────────────────────────────────────────────────────┘
            ↑ divider down the middle
```

**Rules:**
- **Vertical divider** at exactly 50% width. Hairline gray. USPS sorts cards optically using this divider; ours has to be there.
- **Message (left half):** handwritten font (Caveat 700), ink color, ~14pt at 300 DPI = 58px line height. Left-aligned. Max ~140 characters (so it stays legible).
- **Return address (left, top):** small uppercase sans-bold, muted. Single line: "FROM: NAME, CITY ST".
- **Stamp (right, top-right corner):** 28% width of half, slight rotation, postal-red dove motif "1¢" for handwritten, "2¢" for photo/place, "5¢" for custom. Real postage gets applied as an indicia by Lob; our drawn stamp is decorative.
- **Postmark (right, top, slightly overlapping stamp):** circular postmark, 40% opacity, current year.
- **Address block (right, middle):**
  - Line 1: Recipient name (semi-bold serif, slightly larger)
  - Line 2-3: Street address (serif)
  - Line 4: City, ST + ZIP
  - Right-aligned to a fixed grid (Lob's OCR reads this).
- **Address guide lines** (right, bottom): 5 horizontal hairlines for the OCR layout. Decorative, but part of postcard convention.

**Lob-specific addressing rules:**
- The address must be inside Lob's "address area". the right half, lower 2/3. Our layout already accounts for this.
- Address must be readable to OCR. use a sans or simple serif at ≥10pt. We use Cormorant Garamond at 11pt which is borderline; if Lob's OCR rejects it during their preflight check, swap to Inter Bold for the address only.
- The barcode is added by Lob's pipeline. we don't draw it ourselves.

---

## How the components map to Lob

We have two React Native components in `src/components/PostcardPreview.tsx`:

| Component | Renders | Used for in-app | Used for Lob |
|---|---|---|---|
| `PostcardFrontPreview` | The photo side | Send-flow preview, history sheet | Source for the `front` image POST'd to Lob |
| `PostcardBackPreview` | The message side | Send-flow preview, history sheet | Source for the `back` image POST'd to Lob |

For Lob we don't render the RN component directly. we'd need to either:
1. **Server-render via HTML**: re-implement the components as React DOM in the Edge Function, render to PNG via `puppeteer` or `@sparticuz/chromium` running in Deno. ~4 hrs setup.
2. **Render-then-upload from the app**: use `react-native-view-shot` to capture the live RN component to a PNG, upload to Supabase Storage, pass the signed URL to Lob. ~1 hr setup. **Faster path.**

**Recommendation: option 2 for v1.** Wire `react-native-view-shot` into the Send action. Capture both sides at 1275×1875, upload, then call `send_postcard` RPC which kicks off Lob.

Tradeoff: the user's device renders the final print image. If they're on a small phone with a weird display profile, colors could drift slightly. For a beta with friends, fine. For scale, switch to option 1.

---

## Color profile drift

Lob converts our sRGB PNGs to CMYK for press. Common surprises:
- **Bright cyans** lose saturation (8–15% darker on press)
- **Pure blacks** print as rich black (CMYK 60-40-40-100). fine, but solid #000000 backgrounds can look heavier than expected
- **Postal red (#B84A3A)** is well inside CMYK gamut; reproduces close to screen
- **Paper white (#F8F1E3)** is achieved with the paper itself, not ink. **Cards print on bright white stock by default.** Lob has a "kraft" paper option for $0.05 extra that matches our app's paper color better. worth testing.

Once we send the first 5 test cards, look at actual color reproduction and tune if anything's off.

---

## What's not in v1

- Hand-drawn front templates per category (we use the user's photo or a fallback paper texture)
- AI-generated illustrations on the front (the "Custom" tier promises this but defers fulfillment)
- Per-friend custom postage stamps (cute, but adds complexity)
- Variable card sizes. 6×9 and 6×11 are bigger and look great, but pricing tier complexity is real. Defer until 4×6 has shipped.
- Double-sided photo cards (photo on both sides). Some users will want this. Defer.

---

## Open design questions

These will surface once you see the first 5 test prints:

1. **Is Caveat legible on the back at 4×6?** Handwritten fonts at small sizes can blur. May need to bump to a slightly heavier hand font like Patrick Hand.
2. **Does the stamp + postmark cluster crowd the address?** Right half is tight at 4×6. Bump to 6×9?
3. **Caption typography on the front:** white serif over photo gradient. does it photograph well? Or do we need a solid plate?
4. **Bleed and crop:** when Lob trims, do we lose anything important? Move all critical content 1/8" further inside the safe area.

Answer these by ordering five test cards (use your own address). Each test card costs ~$0.65 in Lob test mode, but **test mode doesn't actually print**. To get a physical card with real ink, you need a Live key. minimum cost to see real output is one card at ~$0.65 plus the price tier you pick.

---

## Useful links

- Lob postcard print specs: <https://lob.com/products/postcards>
- Lob design templates (Adobe / Figma): <https://lob.com/resources/postcard-templates>
- USPS automation compatibility: <https://pe.usps.com/text/dmm300/202.htm> (yes, USPS publishes a manual)
- Bleed / safe area diagrams: <https://docs.lob.com/#tag/Templates>
