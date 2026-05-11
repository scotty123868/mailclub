# Mail Club

Real mail for real friends.

Mail Club is a private postcard club prototype built with Expo React Native, TypeScript, and Expo Router. This **v0.3 MVP** is designed to run in Expo Go and be buildable with EAS for iOS/TestFlight.

## What's in v0.3 (MVP)

**Tabs — all five fully working, every tile/row/button clickable:**

- **My Mail Card** — identity + credits balance + tappable About Me + First Card Ideas (each tile seeds Send) + Constellation / Map previews + settings gear.
- **Send** — four card categories with per-category compose UI, AI imagine, occasion grid, recipient picker, void mode, and a Buy-more-credits CTA when balance is short.
- **Friends** — rolodex layout (no more tap-to-connect), QR Mail Card share modal, friend detail sheets, add-friend form.
- **Map** — segmented control + route detail sheet on every route row.
- **Constellation** — filter chips + tappable insight cards (Warmest Thread, New Spark, Sleeping Stars).

**Four card categories with credit pricing:**

| Category | Cost | What it is |
|---|---|---|
| Handwritten note | 1 credit | Your words, printed in handwriting font. |
| Photo postcard | 2 credits | A photo + a short note, mailed. |
| Place postcard | 2 credits | "Greetings from Florida" style — photo + place. |
| Custom art card | 5 credits | You describe + add reference photos. A real designer + AI delivers 2 drafts in 48h (v0.1 queue is manual). |

**Credits system:**

- 1 credit = $1 USD.
- New users get **5 free credits** to start.
- "Buy credits" sheet with packs of 5/10/25/50.
- IAP is stubbed for v0.3 — purchase grants demo credits with a clear Apple-IAP-coming-soon notice.

## What changed in v0.3.1

A thorough functional pass on top of the v0.3 MVP. Every settings row now leads somewhere real, every empty state is intentional, every metric is honest. Bugs caught in the pre-QA audit are fixed.

- **First-launch sign-up.** `WelcomeSheet` captures name + city + state on first open, saves to your Mail Card, and dismisses for good. Skippable if you just want to look around.
- **Sign out works.** Settings → Sign out clears your local state and returns you to the welcome screen.
- **Mail history.** A `MailHistorySheet` shows everything you've sent and every reply from the void — tap the **Sent** or **Replies** metric on My Card. Previously, void replies were stored but never surfaced.
- **Real metrics.** Friends / Sent / Replies / Cities are now derived from your actual state. No more hardcoded "42 friends" demo numbers.
- **Send won't crash empty.** If you remove all friends, Send shows a polite empty state with an "Add" button instead of crashing.
- **Settings is now a real settings screen.** Notifications (3 toggles), Privacy (3 audience options), About/Terms/Help, Address book (jumps to /friends), Sign out. No more stub alerts.
- **Send screen seed**. Tapping "Send a postcard" from a friend's detail sheet now pre-selects that friend on Send.
- **About Me empty fallback.** Cleared fields now show "Not set yet — tap to add." instead of a blank space.

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

The app config uses the placeholder bundle identifier `com.mailclub.app`. Replace it with the real Apple Developer Bundle ID before submitting to TestFlight.

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
- No real payments — credit purchases stub Apple IAP (demo grants credits locally).
- No real postcard fulfillment.
- No real Custom card designer pipeline — request is captured locally as a draft postcard.
- Friends, routes, milestones, and My Mail Card data are mock data.
- Sending a postcard deducts local demo credits and saves mock postcard history in AsyncStorage.
- Add Friend stores the friend on-device only.
- Photo selection uses `expo-image-picker` for the postcard preview only.
- QR code is decoratively rendered — real QR encoding ships in the next release.

## Architecture notes

- **State**: `src/state/MailClubContext.tsx`. AsyncStorage key `mail-club-v0-3-credits-state`. Clean break from v0.2.
- **Types**: `src/types/mail.ts`. `CardCategory = "handwritten" | "photo" | "place" | "custom"`. Postcard has `category`, `creditCost`, plus optional `placeName`, `photoUri`, `customDescription`, `customTone`, `referencePhotoUris`.
- **Constants**: `src/data/credits.ts` — `CARD_COSTS`, `FREE_CREDITS`, `CREDIT_PACKS`, category labels/blurbs.
- **send.tsx** reads a `?occasion=` URL param to seed the compose state when navigated from My Card idea pills.
- **IAP service**: `src/services/iap.ts` defines the `IapService` interface that real StoreKit code will conform to. v0.3 ships a `DemoIapService` that mimics the connect/loadProducts/purchase flow. App Store Connect product IDs follow the `mailclub.credits.{N}` convention. CreditsSheet calls the active service via `getIap()` — swap-in for a real implementation is a one-file change.
- **Privacy manifest**: `ios/MailClub/PrivacyInfo.xcprivacy` declares the four standard Apple-required-reason API categories (UserDefaults, FileTimestamp, DiskSpace, SystemBootTime) needed for AsyncStorage + RN. `NSPrivacyCollectedDataTypes` is empty since v0.3 collects nothing.

## App Store checklist

Pre-launch must-haves:

- Apple Developer account + real Bundle ID.
- App Store icon + splash, plus screenshots for supported iPhone sizes.
- Privacy Policy URL + App Privacy answers in App Store Connect.
- TestFlight build.
- **Real StoreKit IAP** wired for credit packs — Apple Review will reject "buy credits" without IAP. Interface scaffold is in `src/services/iap.ts` ready for swap-in. Requires installing `react-native-iap` (or successor) + creating the 4 consumable products in App Store Connect with IDs `mailclub.credits.{5,10,25,50}` and tier prices `$4.99/$9.99/$24.99/$49.99`.
- iOS 17+ privacy manifest — scaffold present at `ios/MailClub/PrivacyInfo.xcprivacy`; add `NSPrivacyCollectedDataTypes` entries when real IAP + backend ship.
- Postcard fulfillment vendor integration (Lob, PostGrid, etc.).
- Address vault encryption once real addresses ship.
- Account deletion flow.
- Real QR encoding + claim flow.
- Custom card designer queue + delivery pipeline.
- Push notifications for card-delivered + reply-received events.

## Launch copy constraint

UI uses "demo send" and "designer queue is manual" language where fulfillment would otherwise be implied. For a public App Store release, integrate real postcard fulfillment + IAP first, or clearly position the app as early access/waitlist.
