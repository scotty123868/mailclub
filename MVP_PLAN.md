# Mail Club — MVP Action Plan

**Goal:** every tab fully working, every interactive element clickable, looks usable (not stunning). Ship the rolodex Friends paradigm, the four-tier credit-priced card system, and a credits/payments scaffold ready for Apple IAP.

**Scope-defining decisions (locked-in):**
1. Friends tab is a rolodex (no tap-to-connect; QR + Mail Card stay).
2. Four card categories priced in credits: Handwritten 1, Photo 2, Place 2, Custom 5.
3. 1 credit = $1. New users get 5 free credits.
4. "Designer + AI" Custom flow is a queued request — MVP captures intent, doesn't deliver.

**Estimated session breakdown:** ~4.5–5 hours of CC time / ~1 work-week of human time.

---

## Section A — Design Decisions (plan-design-review lens)

### A1. Information Architecture (rated 5 → 9 after fixes)

**Tab purpose, locked:**

| Tab | Primary job | Secondary | Empty state |
|---|---|---|---|
| My Card | Identity + credits balance + send-or-add CTA | Recent activity strip | "Tell people about you — fill in your card" |
| Send | Compose a card in 4 obvious steps | AI imagine + occasion grid | (never empty — always default) |
| Friends | Browse postcard friends as a deck | Add via QR | "No friends yet. Share your Mail Card to get one." |
| Map | Where mail has traveled | Recent routes | "Send your first card to fill in the map." |
| Constellation | Relationship strength view | Filter by city/recency | "Send a card to light up your first star." |

**Send screen step ordering (replaces current 4-step stepper):**
1. **Pick category** (Handwritten / Photo / Place / Custom) — drives every later input
2. **Compose** (inputs vary by category — see A4)
3. **Pick recipient** (or void)
4. **Review + send** (shows credit cost, balance, "Buy more" if short)

### A2. Friends rolodex paradigm

The current Friends screen has three competing heroes (tap-to-connect, share-card, friend list). MVP collapses to two surfaces:

```
+-----------------------------------------------------+
| Header: Friends                          [+ Add]    |
+-----------------------------------------------------+
| YOUR MAIL CARD (compact, ~80pt tall)                |
|  [avatar] Scotty · Denver, CO    [Show QR] button   |
+-----------------------------------------------------+
| ROLODEX — vertical scroll, paper-card stack feel    |
|  +--------------------------------+                 |
|  | Tatiana    Paris, France       |  ← peeled card  |
|  | 7 sent · 5 received            |                 |
|  | Birthday in 3 days  [send →]   |                 |
|  +--------------------------------+                 |
|    +------------------------------+                 |
|    | Alex     Portland, OR        |  ← stacked      |
|    | ...                          |                 |
|    +------------------------------+                 |
+-----------------------------------------------------+
```

**Visual treatment:** each row is a postcard-shaped card with offset vertical stacking (subtle ~6pt offset) so it reads as a deck, not a list. Top card has full opacity, cards behind fade slightly. Tap a card → it animates to top + shows full detail sheet.

**Why a deck, not a list:** lists feel CRM. Decks feel like flipping through a real address book — keeps the postal vocabulary intact.

**Detail sheet contents (modal, 80% screen):** large avatar, name, city, signal pill, last interaction, send history (3 most recent), Send Postcard CTA, Edit Address (stub), Remove Friend (with confirm).

**QR / Mail Card share:** the compact "Mail Card" at top has a [Show QR] button that opens a full-screen modal with a generated QR + the user's display info. This replaces the current bulky "Share Your Mail Card" panel.

### A3. Credits visualization (My Card hero, Send screen, dedicated Credits sheet)

**My Card hero strip — replace current MetricStrip:**
```
+-----------+-----------+-----------+-----------+
|    5      |    12     |     8     |   2,840   |
| credits   |  friends  | sent total|   miles   |
| [+ Buy]   |           |           |           |
+-----------+-----------+-----------+-----------+
```
The Buy button on the credits cell is the entry point to the Credits sheet.

**Welcome state:** if `freeCreditsRemaining > 0`, show a small "5 free credits to start" banner on first visit to Send or Credits. Persist `hasSeenFreeCreditsIntro` so it dismisses.

**Send screen credits indicator:** in the recipient row, replace "5 stamps available" with "5 credits · this card costs N". If balance < cost, swap to red "Buy 3 more credits" inline button.

### A4. Per-category compose UI (Send screen)

Each category gets a distinct compose surface. They share a frame but the inputs differ.

| Category | Inputs | Output preview |
|---|---|---|
| **Handwritten** (1cr) | Message only (Caveat font, 250-char cap, live count) | Single paper card, no photo slot |
| **Photo** (2cr) | Photo picker + message | Postcard layout — photo top, note bottom |
| **Place** (2cr) | Photo picker + place dropdown ("From: Florida ▼") + message | "Greetings from Florida" header band + photo + note |
| **Custom** (5cr) | Description (multiline) + up to 3 reference photos + tone chips (playful, romantic, formal, weird) | "Designer queue" preview — shows "Our designer + AI will draft 2 versions and email you within 48h" |

**Custom MVP behavior:** captures inputs, marks postcard as `status: "draft"` with `customRequest` payload. No real designer is wired. README + Settings explain the queue is manual for v0.1.

**Place picker:** US states + "International" → text field. Hard-coded list, no geocoding.

### A5. State coverage table

| Feature | Loading | Empty | Error | Success |
|---|---|---|---|---|
| Send a card | "Sending…" overlay | n/a | "Not enough credits — buy more" + CTA | SuccessModal + balance update |
| Photo pick | spinner over slot | "Tap to pick a photo" | Alert("Couldn't load that photo") | image renders |
| Buy credits | button → "Processing…" | n/a | "Purchase failed. Try again." | new balance + receipt row |
| Friends rolodex | shimmer cards (3) | "No friends yet — share your Mail Card" | n/a | full deck |
| Show QR | n/a | n/a | n/a | full-screen modal w/ QR |
| Custom request submit | "Queueing your request…" | n/a | network: "Saved locally — we'll send when online" | "Drafts coming in 48h" toast |

### A6. Clickability audit (every interactive element)

**My Card tab:**
- [+ Buy] credits cell → opens Credits sheet
- Each metric cell → tappable, opens placeholder detail (friends → Friends tab; sent → Postcards history sheet; miles → Map tab)
- About Me card → tap to edit (opens Edit Card sheet)
- First Card Ideas tile → seeds Send screen with that occasion + jumps to Send tab
- Constellation preview → jumps to Constellation tab
- Map preview → jumps to Map tab
- Send Mail / Add Friend buttons → navigation (already work)
- Settings gear (header) → Settings sheet (Credits, Address book, Notifications, Privacy, About, Sign out — all stubs except Credits)

**Send tab:**
- Stepper steps → tap to jump (clamped: can't skip past current valid step)
- Photo placeholder → image picker
- Note input → keyboard, dismissable on tap-outside
- AI prompt input + Imagine button → already work
- 4 suggestion chips → already work
- Each occasion tile → already work
- Each format pill (now category) → already work
- Recipient row → tap to cycle OR open Friends-picker sheet (decide: cycle is simpler; keep)
- Recipient avatar → opens friend detail sheet
- Send button → triggers send + modal
- Cancel (in void mode) → exits void

**Friends tab:**
- [+ Add] in header → opens "How to add a friend" sheet (QR scan stub, manual address entry form)
- [Show QR] in compact mail card → full-screen QR modal w/ Done button
- Each rolodex card → expands into detail sheet
- In detail sheet: Send Postcard → Send tab seeded with friend; Edit Address → form; Remove Friend → confirm + remove

**Map tab:**
- Segmented control (Mailed / Received / All) → already works, verify
- Each route row → opens route detail sheet (from/to/date/cards exchanged/miles)
- Recent Routes section header → tappable to expand full history

**Constellation tab:**
- Filter chips → already work
- Each star node → tappable, opens that friend's detail sheet
- 3 Insight cards → tappable to expand more text

**Credits sheet (new):**
- 5 / 10 / 25 / 50 credit packs → "Buy" button per row → IAP stub modal: "Apple IAP coming soon. Demo grants credits."
- Demo "+5 credits" debug button (dev only, behind `__DEV__`)
- "What can I send?" link → cards explaining 4 categories + costs
- Close → dismiss sheet

### A7. Responsive & a11y

- Touch targets: minimum 44pt. Audit chips and stepper circles (currently 46pt, OK).
- Dynamic Type: support up to AX1 for body text. Test by enabling Larger Text in iOS settings.
- Color contrast: verify gold-on-paper passes 4.5:1 for body sizes. The mutedInk (#9A8D76) on paper backgrounds needs verification.
- Screen reader: every Pressable gets `accessibilityLabel`. Decorative SVGs get `accessibilityElementsHidden`.
- Keyboard: TextInput auto-focus where natural; "Done" key dismisses; tap outside dismisses.

### A8. AI-slop avoidance

The current postal aesthetic is the antidote — keep it. Specific bans:
- No purple/indigo gradients.
- No 3-column "feature grid" anywhere (the occasion grid is content, not features — ok).
- No icons-in-colored-circles as section headers — use the postmark/stamp vocabulary instead.
- No floating blob decorations.
- Each new screen should show a stamp, postmark, or paper-grain detail — keeps the brand voice.

---

## Section B — Engineering Decisions (plan-eng-review lens)

### B1. Type + state refactor (foundation, do first)

**File: `src/types/mail.ts`**

```diff
- export type Postcard = {
-   ...
-   type: "note" | "photo" | "keepsake" | "ask-out";
-   stampCost: number;
-   ...
- }
+ export type CardCategory = "handwritten" | "photo" | "place" | "custom";
+ export type Postcard = {
+   ...
+   category: CardCategory;
+   creditCost: number;
+   placeName?: string;        // for "place" category
+   referencePhotoUris?: string[]; // for "custom" category
+   customDescription?: string;     // for "custom" category
+   customTone?: "playful" | "romantic" | "formal" | "weird";
+   ...
+ }
```

**Migration policy:** no backwards-compat shims. AsyncStorage key bumps from `mail-club-v0-2-mail-card-state` → `mail-club-v0-3-credits-state`. Old data (which only exists on dev devices) is dropped. Clean break.

**File: `src/state/MailClubContext.tsx`**

```diff
- stampBalance: number;
+ credits: number;
+ freeCreditsRemaining: number;
+ hasSeenFreeCreditsIntro: boolean;

- sendPostcard(friendId, format: Format, message)
+ sendPostcard(input: SendInput): Promise<{ ok, friendName, creditsRemaining }>

+ purchaseCredits(packId: string): Promise<{ ok }>; // stub for now
+ markFreeCreditsIntroSeen(): Promise<void>;
+ updateAboutMe(patch: Partial<CurrentUser>): Promise<void>;
+ removeFriend(id: string): Promise<void>;
+ addFriendByAddress(input: { name; street; cityLine }): Promise<{ ok; friend? }>;
```

`SendInput` discriminated union:

```ts
type SendInput =
  | { kind: "handwritten"; friendId: string; message: string }
  | { kind: "photo"; friendId: string; photoUri: string; message: string }
  | { kind: "place"; friendId: string; photoUri: string; placeName: string; message: string }
  | { kind: "custom"; friendId: string; description: string; tone?: CustomTone; referencePhotoUris: string[] };
```

**Cost map (single source of truth — export from `src/data/credits.ts`):**

```ts
export const CARD_COSTS: Record<CardCategory, number> = {
  handwritten: 1,
  photo: 2,
  place: 2,
  custom: 5,
};
export const FREE_CREDITS = 5;
export const CREDIT_PACKS = [
  { id: "p5",  credits: 5,  priceUsd: 5 },
  { id: "p10", credits: 10, priceUsd: 10 },
  { id: "p25", credits: 25, priceUsd: 25 },
  { id: "p50", credits: 50, priceUsd: 50 },
];
```

### B2. Occasions → category mapping

`src/data/occasions.ts` currently uses `format: "note" | "photo" | "keepsake" | "ask-out"`. Map cleanly:

| Old format | New category | Notes |
|---|---|---|
| note | handwritten | most "just words" occasions |
| photo | photo | most "send a moment" occasions |
| keepsake | custom | the AI-art occasion is the only keepsake; goes custom |
| ask-out | handwritten | date / new-friend / party — text-driven |

Also: `travel` and `memory` occasions move to `place` category (greetings-from style).

**Result: 12 occasions distributed roughly: 5 handwritten, 4 photo, 2 place, 1 custom.**

### B3. New components to build

| Component | File | Purpose |
|---|---|---|
| `CategoryPicker` | `src/components/CategoryPicker.tsx` | Replaces FormatSelector. 4 large tiles with icon, name, "N credit(s)", short blurb. |
| `CategoryCompose` | `src/components/CategoryCompose.tsx` | Switches input UI per category. |
| `PlacePicker` | `src/components/PlacePicker.tsx` | Modal w/ US states + International text input. |
| `CustomRequestForm` | `src/components/CustomRequestForm.tsx` | Description + photo picker (max 3) + tone chips. |
| `CreditsBalance` | `src/components/CreditsBalance.tsx` | Reusable pill — "5 credits" + optional [+ Buy]. |
| `CreditsSheet` | `src/components/CreditsSheet.tsx` | Bottom sheet with 4 packs + IAP stub. |
| `RolodexCard` | `src/components/RolodexCard.tsx` | Single deck card with offset stacking style. |
| `FriendDetailSheet` | `src/components/FriendDetailSheet.tsx` | Modal with full friend info + actions. |
| `QRCodeModal` | `src/components/QRCodeModal.tsx` | Full-screen QR. Use `react-native-qrcode-svg`. |
| `RouteDetailSheet` | `src/components/RouteDetailSheet.tsx` | Map route detail. |
| `EditAboutMeSheet` | `src/components/EditAboutMeSheet.tsx` | Edit current user fields. |
| `SettingsSheet` | `src/components/SettingsSheet.tsx` | Settings list (mostly stubs). |
| `OnboardingFreeCreditsBanner` | `src/components/OnboardingFreeCreditsBanner.tsx` | First-visit dismissable banner. |

### B4. Components to delete or substantially rewrite

| Component | Action |
|---|---|
| `FormatSelector.tsx` | Delete, replace with CategoryPicker. Update all imports. |
| `PhoneConnectArt` (in `PostalIllustrations.tsx`) | Keep but don't render on Friends tab. Available if Onboarding wants it later. |
| `friends.tsx` (screen) | Rewrite. Most existing markup goes. |
| `FriendRow.tsx` | Replace usage with RolodexCard. Keep file if any test references — but plan: delete after tests update. |

### B5. New dependencies

| Package | Why | Risk |
|---|---|---|
| `react-native-qrcode-svg` | QR generation for Mail Card sharing | small, mature, no native modules beyond SVG |
| `expo-store-review` | (optional) prompt after first send | low |

**No IAP library yet** — keep purchase as a stub modal until App Store readiness pass.

### B6. Routing / navigation additions

Sheets / modals — use `expo-router` modal route group `(modals)`:

```
app/
  (tabs)/
    my-card.tsx
    send.tsx
    friends.tsx
    map.tsx
    constellation.tsx
  (modals)/
    credits.tsx
    settings.tsx
    qr-code.tsx
    friend/[id].tsx
    route/[id].tsx
    edit-about-me.tsx
    add-friend.tsx
  index.tsx
  _layout.tsx
```

This converts modals from local state to URL-addressable, which makes deep linking + screenshot pipeline trivial.

### B7. Test plan

**Existing tests to update (12 files, 103 tests):**
- Rename `stampBalance` → `credits` everywhere (expect search-replace + spot fixes ~20 sites)
- Rename `format` → `category` in send-flow tests
- Update cost expectations: `note→1, photo→3, keepsake→5, ask-out→3` becomes `handwritten→1, photo→2, place→2, custom→5`
- Fix `imagineCard.test.ts` to expect new categories per the mapping in B2
- Update `FormatSelector.test.tsx` → rename file → `CategoryPicker.test.tsx`, update assertions

**New tests to add (target ~30 new tests, ~135 total):**
- `CategoryPicker.test.tsx` — 4 tiles render, prices show, selection state, callback fires (5 tests)
- `CategoryCompose.test.tsx` — each category renders correct inputs; place shows place picker; custom shows ref photos slot (8 tests)
- `CreditsContext.test.tsx` — `purchaseCredits` stub, `freeCreditsRemaining` decrement on first send, intro flag persistence (6 tests)
- `RolodexFriends.test.tsx` — deck renders all friends, tap opens detail sheet, [+ Add] opens add-friend modal, [Show QR] opens QR modal (6 tests)
- `FriendDetailSheet.test.tsx` — sends seed Send tab; remove triggers confirm; edit address opens form (4 tests)
- `Onboarding.test.tsx` — banner shows on first visit; dismisses; doesn't return after `markFreeCreditsIntroSeen` (3 tests)

**Test gates:** if any existing test fails after rename pass, fix in-place — don't skip. Target: 0 skipped, all green before next phase.

### B8. Persistence & data hygiene

- Bump `STORE_KEY` to `mail-club-v0-3-credits-state` (clean break).
- New persisted shape:
```ts
{
  friends: Friend[],
  postcards: Postcard[],
  credits: number,
  freeCreditsRemaining: number,
  hasSeenFreeCreditsIntro: boolean,
  voidReplies: VoidReply[],
  currentUser: CurrentUser,  // now editable
}
```
- Add JSON shape validation on load — if shape mismatch, drop to defaults rather than crash.

### B9. Apple App Store readiness gaps (deferred but flagged)

| Gap | Required for ship | Plan |
|---|---|---|
| Real IAP via StoreKit | YES (App Review will reject "buy credits" without IAP) | Phase 8 — out of MVP scope |
| Privacy manifest | YES (iOS 17+) | Phase 8 |
| Real backend for Custom queue | NO for MVP demo | Phase 9 |
| Real postcard fulfillment (Lob, Postable, etc.) | YES for real users | Phase 10 |
| Address vault encryption | YES once real addresses | Phase 10 |
| Push notifs (card delivered, void reply received) | NO for MVP | Phase 11 |

Add to README App Store checklist.

---

## Section C — Phased Execution Plan

### Phase 1 — Foundation refactor (CC ~30min, human ~1d)
1. Update `src/types/mail.ts` (CardCategory, new Postcard fields)
2. Create `src/data/credits.ts` (CARD_COSTS, FREE_CREDITS, CREDIT_PACKS)
3. Update `src/state/MailClubContext.tsx` (rename + new actions, bump store key)
4. Update `src/data/occasions.ts` (remap formats → categories)
5. Update `src/data/mock.ts` (postcard `type` → `category`, `stampCost` → `creditCost`)
6. Update `src/utils/imagineCard.ts` (match new categories)
7. **Test gate:** rename pass through all tests; expect ~20 break, fix until green.

### Phase 2 — Send screen 4-category flow (CC ~1hr, human ~1.5d)
1. Build `CategoryPicker` (replaces `FormatSelector`)
2. Build `CategoryCompose` (per-category input switcher)
3. Build `PlacePicker`
4. Build `CustomRequestForm`
5. Wire into `app/(tabs)/send.tsx` — replace step 1+2 with new flow
6. Update credits indicator in recipient row
7. **Test gate:** new tests for each component; full send flow integration test (handwritten + photo + place + custom).

### Phase 3 — Credits sheet + onboarding (CC ~30min, human ~4h)
1. Build `CreditsSheet` modal route at `app/(modals)/credits.tsx`
2. Build `CreditsBalance` reusable pill
3. Build `OnboardingFreeCreditsBanner`
4. Wire [+ Buy] entry points (My Card hero + Send screen short-balance state)
5. Stub `purchaseCredits` action (alerts "Apple IAP coming soon — demo grants credits")
6. **Test gate:** purchase stub adds credits; intro banner persists dismiss state.

### Phase 4 — Friends rolodex (CC ~45min, human ~1d)
1. Build `RolodexCard` (postcard-shaped, offset-stacked visual)
2. Build `FriendDetailSheet` modal at `app/(modals)/friend/[id].tsx`
3. Build `QRCodeModal` at `app/(modals)/qr-code.tsx`
4. Build `add-friend.tsx` modal (manual address entry)
5. Rewrite `app/(tabs)/friends.tsx` — compact mail card on top + rolodex below
6. Add `accessibilityLabel` everywhere
7. **Test gate:** deck renders, detail sheet opens, QR modal opens, add-friend form validates, remove flow with confirm.

### Phase 5 — My Card hero + clickability (CC ~30min, human ~1d)
1. Update `MetricStrip` to credits-first with [+ Buy]
2. Build `EditAboutMeSheet` at `app/(modals)/edit-about-me.tsx`
3. Build `SettingsSheet` at `app/(modals)/settings.tsx` (mostly stubs)
4. Wire all preview cards (Constellation, Map) to actually navigate
5. Wire occasion idea tiles to seed Send tab + navigate
6. Add settings gear to Header
7. **Test gate:** every visible button/row has a press handler; no dead taps.

### Phase 6 — Map + Constellation interactivity (CC ~30min, human ~1d)
1. Build `RouteDetailSheet` at `app/(modals)/route/[id].tsx`
2. Wire route rows on Map to open detail sheet
3. Wire constellation star nodes to friend detail sheet
4. Verify segmented controls + filter chips function
5. **Test gate:** sheets open + dismiss, no crashes.

### Phase 7 — Polish + state coverage (CC ~45min, human ~1d)
1. Add empty states for every list (Friends, Postcards, Routes, VoidReplies)
2. Add loading states (Sending overlay, photo pick spinner)
3. Add error states (insufficient credits, bad photo)
4. Audit a11y labels — every Pressable
5. Run on iPhone 17 Pro sim — manual click-through every tab
6. Screenshot pipeline: capture each tab + each major sheet for README

### Phase 8 — App Store readiness (deferred, separate session)
- Real StoreKit IAP
- Privacy manifest
- README final checklist

**Stop point for MVP:** end of Phase 7. Phase 8+ is post-MVP shipping prep.

---

## Section D — Risks & Open Decisions

1. **QR library choice.** `react-native-qrcode-svg` works on Expo but emits no native modules — verify it builds clean on Release config. Fallback: `expo-barcode-generator`. **Decision needed:** confirm before Phase 4.
2. **Custom card flow w/o backend.** v0.1 captures the request but never delivers. Acceptable for demo? Or do we cut Custom from MVP and tease as "coming soon"? **Decision needed:** before Phase 2.
3. **Modal vs sheet routing.** expo-router supports modal presentation but iOS sheet detents need care. Some sheets (Credits, Settings) feel right as full modal; some (FriendDetail) feel right as 80% sheet. **Decision:** start all as modal, refine in Phase 7.
4. **Place dropdown UX.** Long state list is clunky. **Options:** (a) typeahead search, (b) recent + alpha list, (c) "Where are you?" geolocation suggestion. **Decision:** start with alpha list, iterate.
5. **Free credits accounting.** Should free credits be a separate counter or just `credits + 5`? **Decision:** separate counter (`freeCreditsRemaining`) so we can show "3 free credits remain" copy and mark them differently in any future receipt UI.

---

## Section E — Out of Scope (explicit)

- Real photo printing / Lob integration
- Real designer queue / human-in-the-loop pipeline
- Push notifications
- Social features (likes, comments, public friend lists)
- Multi-user accounts (sign in / sign up — single device for MVP)
- Address autocomplete / geocoding
- Cropping / filters on photos beyond Expo's default
- Card preview rendering as actual postcard artwork (the printed result shown in-app)

---

## Section F — Definition of Done (MVP ship gate)

- [ ] All 5 tabs load without crash
- [ ] Every interactive element has a press handler that does something visible
- [ ] Send flow works end-to-end for all 4 categories (with credits decrement)
- [ ] Credits sheet opens; stub purchase grants credits
- [ ] Free 5 credits granted on first launch; intro banner shows + dismisses
- [ ] Friends rolodex shows deck; detail sheet opens; QR modal renders a QR
- [ ] Map route detail opens
- [ ] Constellation node opens friend detail
- [ ] Settings sheet opens (stubs OK)
- [ ] Edit About Me persists to AsyncStorage
- [ ] All ~135 tests passing, 0 skipped
- [ ] Manual smoke test on iPhone 17 Pro sim completes top-to-bottom in <5min
- [ ] README updated with new credits model + IAP-deferred caveat
