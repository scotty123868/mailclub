# Mailroom

Real mail for real friends.

Mailroom is a private postcard club prototype built with Expo React Native, TypeScript, and Expo Router. This **v0.3 MVP** is designed to run in Expo Go and be buildable with EAS for iOS/TestFlight.

## What's in v0.3 (MVP)

**Tabs. all five fully working, every tile/row/button clickable:**

- **My Mail Card**. identity + credits balance + tappable About Me + First Card Ideas (each tile seeds Send) + Constellation / Map previews + settings gear.
- **Send**. four card categories with per-category compose UI, AI imagine, occasion grid, recipient picker, void mode, and a Buy-more-credits CTA when balance is short.
- **Friends**. rolodex layout (no more tap-to-connect), QR Mail Card share modal, friend detail sheets, add-friend form.
- **Map**. segmented control + route detail sheet on every route row.
- **Constellation**. filter chips + tappable insight cards (Warmest Thread, New Spark, Sleeping Stars).

**Four card categories with credit pricing:**

| Category | Cost | What it is |
|---|---|---|
| Handwritten note | 1 credit | Your words, printed in handwriting font. |
| Photo postcard | 2 credits | A photo + a short note, mailed. |
| Place postcard | 2 credits | "Greetings from Florida" style. photo + place. |
| Custom art card | 5 credits | You describe + add reference photos. A real designer + AI delivers 2 drafts in 48h (v0.1 queue is manual). |

**Credits system:**

- 1 credit = $1 USD.
- New users get **5 free credits** to start.
- "Buy credits" sheet with packs of 5/10/25/50.
- IAP is stubbed for v0.3. purchase grants demo credits with a clear Apple-IAP-coming-soon notice.

## Backend (Supabase)

v0.5 ships a real backend. Project ref `nlwnmgwylmmnaemdnzlq`, region `us-east-1`.

**What's there:**

| Table | Purpose | RLS |
|---|---|---|
| `profiles` | One row per user. identity, credits, prefs | Read/update own row |
| `friends` | Rolodex | Full CRUD on own rows |
| `postcards` | Every send | Read own; writes via RPC only |
| `void_replies` | Inbox for stranger replies | Read own; server writes |
| `credit_transactions` | Audit ledger | Read own; writes via RPC only |

**RPCs (server-authoritative):**
- `complete_signup(name, city, state)`. populates the profile, derives initials, marks intro seen
- `send_postcard(to_kind, to_friend_id, category, message, photo_uri, place_name, custom_description, custom_tone, reference_photo_uris)`. looks up server-side cost map, deducts credits atomically, inserts postcard, bumps friend stats, logs the transaction
- `purchase_credits(pack_id)`. placeholder until Apple IAP receipt validation lands

**Storage:** bucket `postcard-photos`, folder-scoped per user (`{userId}/{filename}`). RLS policies prevent users from reading each other's photos.

**Auth:** email + password with autoconfirm enabled (no email-link click required for MVP). 7-day JWT expiry. Sessions persist via AsyncStorage on the client.

**Migrations:** SQL is in `supabase/migrations/*.sql` (commit history is the source of truth). To re-apply on a fresh project:

```bash
# Set your access token first
export SUPABASE_ACCESS_TOKEN=sbp_...
# Or use the dashboard SQL editor; the files run in alphabetical order
```

The anon URL + key are baked into `app.json` under `expo.extra`. They're **public** by design. RLS is what protects user data. Treat the personal access token (`sbp_...`) and the `service_role` JWT as secrets. those don't go in the repo.

## TestFlight. what you have to do yourself

The app builds clean for Release and adhoc-signs for the iOS Simulator. **TestFlight upload requires your Apple credentials**, which I don't have access to. Run these steps from your machine:

```bash
# 1) Make sure eas-cli is installed and logged in
npm install -g eas-cli
eas login

# 2) First-time only: register the bundle ID in App Store Connect at
#    https://appstoreconnect.apple.com/apps  →  + → New App
#    Bundle ID: com.mailroom.app
#    Primary language: English (US)
#    SKU: mailroom-001 (or anything unique to you)

# 3) Configure EAS Build
eas build:configure
# Pick "iOS" only when prompted. Accept the generated eas.json.

# 4) Build the production binary (this triggers Apple's signing dance)
eas build --platform ios --profile production
# You'll be asked to:
#   - Log into Apple Developer (2FA code from your trusted device)
#   - Let EAS create + install certificates and provisioning profiles
#   - Wait ~15-20 min for the cloud build

# 5) Submit to TestFlight
eas submit --platform ios --latest
# Apple processing takes ~10-15 min. You'll get an email when ready.

# 6) Add internal testers in App Store Connect → TestFlight tab
```

**What you still need before App Review:**
- Real StoreKit IAP (the credit Buy flow is intentionally gated off. Apple Guideline 3.1.1 would reject demo credits). When you wire IAP, register 4 consumable products in App Store Connect with IDs `mailroom.credits.{5,10,25,50}` at tiers `$5/$10/$20/$35`.
- Real QR encoding (currently a decorative grid. swap to `react-native-qrcode-svg`).
- An App Privacy answers questionnaire in App Store Connect (no data collected → declare that).
- Marketing screenshots in the required sizes.

The build for TestFlight will succeed; the App Store *Review* won't pass until IAP + real fulfillment ship. TestFlight builds can ship to internal testers (you + invitees) without Apple Review.

## What changed in v0.4 (post-codex pre-TestFlight pass)

Codex review (run via an independent reviewer model since OpenAI's CLI was account-gated) found 9 P1 blockers and 13 P2 issues against v0.3.1. All P1s and the actionable P2s are now fixed. **192/192 tests green across 27 suites.**

### Critical (would have failed App Review or shipped broken)

- **IAP Buy flow gated.** No more "Apple IAP not connected → Grant demo credits" alert. The credit packs are visible as a teaser with a "Coming soon" CTA. Selling consumable currency without StoreKit violates Apple Guideline 3.1.1. we don't even pretend to charge.
- **Welcome flash fixed.** Added a `hydrated` flag to `MailClubContext`. WelcomeGate now waits for AsyncStorage to resolve before rendering the sheet. Returning users no longer see the welcome modal flicker on every cold launch.
- **signOut clears completely.** Resets to empty arrays, blank user identity, and AsyncStorage gone. not back to the Tatiana/Maya/etc. mock fixtures. New sign-ins start fresh.
- **No fake void replies.** Sending into the void used to immediately fabricate a stranger reply via `Math.random()` against `VOID_REPLY_AUTHORS`. Apple Guideline 4.0 / 5.6.1 (misleading content) would catch this. Now the send queues the postcard with no auto-reply.
- **KeyboardAvoidingView** in WelcomeSheet, AddFriendSheet, EditAboutMeSheet. Bottom inputs are no longer hidden under the keyboard on iPhone SE/mini.
- **Version + buildNumber.** `app.json` bumped to `0.3.0` with `buildNumber: "1"`. `ITSAppUsesNonExemptEncryption: false` so Apple skips the export compliance questionnaire.
- **`NSPhotoLibraryUsageDescription`** rewritten. no more "demo postcard" copy.
- **Avatar fixed for real users.** New `IdentityAvatar` picks the illustrated portrait for known mock IDs and an initials disc for everyone else. Brand new signups no longer see a Scotty portrait labeled as themselves.
- **`since` year derived from current year** at signup time. No more frozen "POSTCARD FRIENDS SINCE 2026" for users who join in 2027.

### Bigger structural changes

- **Constellation derives insights from real state.** Warmest Thread + New Spark are computed from actual friend stats. Sleeping Stars counts friends untouched for 60+ days. Empty state with an "Add a friend" CTA when `friends.length === 0`. Goodbye hardcoded "Tatiana 12 cards".
- **Map routes derived from postcards.** Routes are no longer static mock data with fake people names ("Scotty & Jamie"). They're computed by grouping postcards on `(fromCity → toCity)` pairs. Mile counts are pseudo-distances (real geo ships with the backend). Empty state when no postcards sent yet.
- **MailHistorySheet `initialTab` properly tracked.** Resets to the tab the caller requested on every reopen.
- **AddFriendSheet draft state clears on close.** Stale form data doesn't reappear when the user dismisses by swipe.
- **Photo permission UX.** `CategoryCompose` + `CustomRequestForm` now call `requestMediaLibraryPermissionsAsync` first; on deny they show an Alert with an "Open Settings" deep link instead of silently doing nothing.

### Copy cleanup

- Stripped all user-facing "v0.1" / "v0.3" strings. About sheet, Settings footer, AddFriend subtitle, Send success modal all use "beta" or descriptive language instead.

## What changed in v0.3.1

A thorough functional pass on top of the v0.3 MVP. Every settings row now leads somewhere real, every empty state is intentional, every metric is honest. Bugs caught in the pre-QA audit are fixed.

- **First-launch sign-up.** `WelcomeSheet` captures name + city + state on first open, saves to your Mail Card, and dismisses for good. Skippable if you just want to look around.
- **Sign out works.** Settings → Sign out clears your local state and returns you to the welcome screen.
- **Mail history.** A `MailHistorySheet` shows everything you've sent and every reply from the void. tap the **Sent** or **Replies** metric on My Card. Previously, void replies were stored but never surfaced.
- **Real metrics.** Friends / Sent / Replies / Cities are now derived from your actual state. No more hardcoded "42 friends" demo numbers.
- **Send won't crash empty.** If you remove all friends, Send shows a polite empty state with an "Add" button instead of crashing.
- **Settings is now a real settings screen.** Notifications (3 toggles), Privacy (3 audience options), About/Terms/Help, Address book (jumps to /friends), Sign out. No more stub alerts.
- **Send screen seed**. Tapping "Send a postcard" from a friend's detail sheet now pre-selects that friend on Send.
- **About Me empty fallback.** Cleared fields now show "Not set yet. tap to add." instead of a blank space.

## Run locally

```bash
npm install
npx expo start
```

Open the project in Expo Go, or press `i` from the Expo CLI to launch the iOS simulator.

## Build with EAS

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios
```

The app config uses the placeholder bundle identifier `com.mailroom.app`. Replace it with the real Apple Developer Bundle ID before submitting to TestFlight.

## Tests

```bash
npm test
```

Current status: **165 tests across 20 suites**, all green. Covers:

- State context (sendPostcard for all 4 categories, credits purchase, free credits, add/remove friend, persistence, hydration)
- Per-component tests for CategoryPicker, CategoryCompose, PlacePicker, CustomRequestForm, CreditsBalance, CreditsSheet, OnboardingFreeCreditsBanner, EditAboutMeSheet, SettingsSheet, RolodexCard / FriendDetailSheet / QRCodeModal / AddFriendSheet, RouteDetailSheet
- Screen smoke tests for all 5 tabs covering rendering, navigation, and interactivity

## What is mocked in v0.3

- No backend or authentication.
- No real payments. credit purchases stub Apple IAP (demo grants credits locally).
- No real postcard fulfillment.
- No real Custom card designer pipeline. request is captured locally as a draft postcard.
- Friends, routes, milestones, and My Mail Card data are mock data.
- Sending a postcard deducts local demo credits and saves mock postcard history in AsyncStorage.
- Add Friend stores the friend on-device only.
- Photo selection uses `expo-image-picker` for the postcard preview only.
- QR code is decoratively rendered. real QR encoding ships in the next release.

## Architecture notes

- **State**: `src/state/MailClubContext.tsx`. AsyncStorage key `mailroom-v0-3-credits-state`. Clean break from v0.2.
- **Types**: `src/types/mail.ts`. `CardCategory = "handwritten" | "photo" | "place" | "custom"`. Postcard has `category`, `creditCost`, plus optional `placeName`, `photoUri`, `customDescription`, `customTone`, `referencePhotoUris`.
- **Constants**: `src/data/credits.ts`. `CARD_COSTS`, `FREE_CREDITS`, `CREDIT_PACKS`, category labels/blurbs.
- **send.tsx** reads a `?occasion=` URL param to seed the compose state when navigated from My Card idea pills.
- **IAP service**: `src/services/iap.ts` defines the `IapService` interface that real StoreKit code will conform to. v0.3 ships a `DemoIapService` that mimics the connect/loadProducts/purchase flow. App Store Connect product IDs follow the `mailroom.credits.{N}` convention. CreditsSheet calls the active service via `getIap()`. swap-in for a real implementation is a one-file change.
- **Privacy manifest**: `ios/MailClub/PrivacyInfo.xcprivacy` declares the four standard Apple-required-reason API categories (UserDefaults, FileTimestamp, DiskSpace, SystemBootTime) needed for AsyncStorage + RN. `NSPrivacyCollectedDataTypes` is empty since v0.3 collects nothing.

## App Store checklist

Pre-launch must-haves:

- Apple Developer account + real Bundle ID.
- App Store icon + splash, plus screenshots for supported iPhone sizes.
- Privacy Policy URL + App Privacy answers in App Store Connect.
- TestFlight build.
- **Real StoreKit IAP** wired for credit packs. Apple Review will reject "buy credits" without IAP. Interface scaffold is in `src/services/iap.ts` ready for swap-in. Requires installing `react-native-iap` (or successor) + creating the 4 consumable products in App Store Connect with IDs `mailroom.credits.{5,10,25,50}` and tier prices `$5/$10/$20/$35`.
- iOS 17+ privacy manifest. scaffold present at `ios/MailClub/PrivacyInfo.xcprivacy`; add `NSPrivacyCollectedDataTypes` entries when real IAP + backend ship.
- Postcard fulfillment vendor integration (Lob, PostGrid, etc.).
- Address vault encryption once real addresses ship.
- Account deletion flow.
- Real QR encoding + claim flow.
- Custom card designer queue + delivery pipeline.
- Push notifications for card-delivered + reply-received events.

## Launch copy constraint

UI uses "demo send" and "designer queue is manual" language where fulfillment would otherwise be implied. For a public App Store release, integrate real postcard fulfillment + IAP first, or clearly position the app as early access/waitlist.
