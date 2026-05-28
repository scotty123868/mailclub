# Send flow. what's responsive, what's static

You asked: "Does every piece of the send mail flow work? Responsive to what text is input?"

Here's the honest map of every interactive element and whether it actually drives state + preview.

---

## TL;DR

**Everything that should be responsive IS responsive.** The preview reflects your typing, photo choice, place name, recipient, and sender info in real time. There are a few things that look like they should respond but are intentionally decorative (the stamp denomination, the postmark text). Those are noted below as "static by design."

---

## Step-by-step

### 1. Category picker (Note / Photo / Place / Custom)

| Element | Responsive | Notes |
|---|---|---|
| Tapping a tile | ✅ | `state.category` updates → composer changes layout per category → credit cost shown updates |
| Credit cost label under each tile (1cr / 2cr / 5cr) | ✅ | Sourced from `CARD_COSTS` map; if you change pricing in `src/data/credits.ts`, this updates |
| Active state (red top bar + bold red title) | ✅ | Drives off `selected === item.id` |

### 2. Compose card (changes based on category)

#### Note / Photo / Place (shared composer)
| Element | Responsive | Notes |
|---|---|---|
| Photo placeholder → tap to choose | ✅ | Photo (or Place) only. Sets `state.imageUri` → flows to preview front |
| Photo replaces placeholder once picked | ✅ | Image rendered immediately, no upload yet |
| "Tonight's photo" placeholder copy | ⚠️ Static | Same text for Photo + Place categories. Could be category-specific ("This place's photo" for Place) |
| Note text area | ✅ | Every keystroke fires `onChange` → `state.message` → preview back updates instantly |
| Postmark + stamp icons in composer | ⚠️ Static by design | Decorative chrome; cents value (`3¢`) hardcoded, not tied to category cost |

#### Place category
| Element | Responsive | Notes |
|---|---|---|
| Place picker chip | ✅ | Opens `<PlacePicker>` modal; selected place flows to `state.placeName` → shows as caption on the front preview |

#### Custom category
| Element | Responsive | Notes |
|---|---|---|
| Description textarea | ✅ | `state.message` (we use the same field as the regular message) |
| Tone chips (playful / romantic / formal / weird) | ✅ | `state.customTone` updates |
| Up to 3 reference photos | ✅ | `state.customPhotos` array, with X button to remove |

### 3. AI prompt card

| Element | Responsive | Notes |
|---|---|---|
| Description input | ✅ | Local input |
| Imagine button | ✅ | Disabled when empty. On tap → seeds `state.message` + `state.category` from a fixed prompt-to-occasion map (so "birthday for mom" sets birthday occasion + warm message). No real AI yet. it's keyword matching. |
| 4 quick suggestions | ✅ | Tap to pre-fill the input |

### 4. Occasion grid (12 tiles)

| Element | Responsive | Notes |
|---|---|---|
| Tapping a tile | ✅ | Seeds `state.message` + `state.category` from that occasion's template |
| "Into the void" tile | ✅ | Enables `voidMode` → recipient row shows "Someone in Mailroom", preview back shows that text |
| Active state highlighting | ✅ | Tile gets red border when active |

### 5. Recipient row

| Element | Responsive | Notes |
|---|---|---|
| With friends: tap to cycle | ✅ | Cycles through `friends[]`; updates `recipientIndex` → preview back's recipient name updates |
| With no friends: "No friends to send to yet" empty state | ✅ | Shown when `friends.length === 0` and not in void mode |
| In void mode: "Someone in Mailroom" | ✅ | Cancel button to exit void mode |
| Credit balance + cost label | ✅ | Shows `5 credits · this card costs 2` style; updates as you change category |
| "Need more" warning + Buy button | ✅ | Appears when `credits < cost` |

### 6. Postcard preview (the big one)

Wired into `<PostcardFrontPreview>` + `<PostcardBackPreview>` (see `src/components/PostcardPreview.tsx`):

#### Front (photo side)
| Element | Responsive | Notes |
|---|---|---|
| Photo | ✅ | Reflects `state.imageUri` immediately on pick |
| Caption banner | ✅ | Only shown for `place` category; shows `state.placeName` |
| Empty state ("Photo goes here · Tap Add photo on the Send screen") | ✅ | Shows when no photo is set |
| MAILROOM mark, bottom-right | ⚠️ Static | Always shows |

#### Back (message side)
| Element | Responsive | Notes |
|---|---|---|
| Handwritten message (left half) | ✅ | Reflects `state.message`; word-wraps; line count adapts to width |
| Return address "FROM: NAME, CITY ST" | ✅ | Pulls from `currentUser` (your Mail Card name + city + state). Updates if you edit your profile. |
| Recipient name (right half) | ✅ | The friend you cycled to, or "Someone in Mailroom" in void mode |
| Recipient address lines | ⚠️ Partially wired | Shows `addressLine1`, `addressLine2`, `city/state/zip` IF the friend has them. For friends added before the address form existed, only city+state show. The 5 USPS guide lines at the bottom always render. |
| Postage stamp graphic | ⚠️ Static by design | Always shows the dove + postal-red. Real postage gets applied by Lob as an indicia, not us. |
| Postmark circle | ⚠️ Static by design | Year is decorative; date stamp varies on real prints |
| Vertical divider | ⚠️ Static | Always shown |

### 7. Send button

| Element | Responsive | Notes |
|---|---|---|
| Button label | ✅ | "Send Postcard" → "Send into the void" → "Queue custom card" → "Sending..." based on state |
| Tap → fires `sendPostcard()` | ✅ | Optimistic credit deduction → API call → success/failure feedback |
| Success modal text | ✅ | Reflects recipient name, category, and current "queue" state (since printing isn't live yet) |

---

## What's intentionally NOT responsive (and why)

These are decorative or static-by-design. not bugs, just product decisions:

| Element | Static | Why |
|---|---|---|
| Stamp denomination ("1¢" / "3¢") | Yes | Could vary by category cost (Note=1¢, Photo=2¢, Custom=5¢), but right now it's the same on every preview. **Easy fix if you want it (~10 min).** |
| Postmark date (current year only) | Yes | Real postmarks have city + date stamped. Lob handles this on print. |
| Stamp rotation | Yes | -4° fixed. Could randomize per card for "hand-stamped" feel. |
| Postcard tilt (-0.5°) | Yes | Same on every preview. Could randomize. |
| 5 USPS guide lines | Yes | These are address-layout guides on real postcards. Always 5. |
| MAILROOM logo on front | Yes | Brand mark. Should always be there. |
| Caveat font for handwritten text | Yes | This is THE Mailroom handwriting font. Doesn't change per user (yet). Future: per-user handwriting selection. |

---

## Gaps I'd fix next

Roughly in priority order:

1. **🚨 Recipient address coverage**. the preview shows the recipient's full mailing address if it exists, but the **app doesn't make the user input it before sending** (the AddFriend mailing-address section is collapsed by default + optional). For real shipping via Lob, we should either:
   - Block Send when the friend has no address
   - Show "We'll prompt your friend to claim their card and add their address" copy
   - Default to "queued until address is on file"

   Right now the failure mode is silent: you tap Send, postcard row saves, Lob trigger fires, trigger sees missing address, no-op. The user thinks the card is queued. **This is the biggest UX gap.** Easy to fix once you decide which path.

2. **Per-category placeholder copy**. composer says "Tonight's photo" for Photo, "Tonight's photo" for Place. Should be "Photo" / "A place" respectively.

3. **Stamp denomination**. match the card's credit cost (1¢ / 2¢ / 5¢). 10 min.

4. **Send button disabled state when invalid**. currently you can tap Send with an empty message and it goes through. Should disable for blank messages.

5. **Photo-only / Place-only preview cleanup**. for Photo category, the front preview shows the photo. For Place without a photo, the front shows the placeholder + place caption. For Note, the front is just a placeholder with no caption. Could make the Note front a more intentional "this is a paper note, no photo needed" design.

6. **Custom category preview**. Custom is supposed to be designer-crafted art. The preview shows the same generic placeholder + handwritten message as Note. Could show a "🎨 Designer queue · your description renders here once we craft it" state.

---

## What you'd want to do next

Tell me which of the 6 gaps above you care about and I'll fix them. The address coverage one (#1) is the most user-visible.
