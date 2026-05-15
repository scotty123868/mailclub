# App Clips Setup — Mailroom Claim Flow

**Current status (build 40):**
- Vercel site: AASA + claim page + content-type rewrite — **DONE, LIVE.**
- iOS app: claim URLs minted against `mailroomclub.vercel.app/claim` — **DONE in build 40.**
- iOS Associated Domains entitlement: drafted in file, **DISABLED** until step 1 below.
- App Clip Xcode target: **NOT YET ADDED.** Files staged in `ios/MailroomClip/`.
- App Clip activation: **BLOCKED** on steps 1, 2, 4, 5 below (manual, user must do).

## What works in build 40 today

Recipients on Android, desktop, iOS pre-14, or iOS without Universal
Link routing get the **static HTML web fallback**:
- Tap claim link from iMessage/Mail → Safari opens
  `https://mailroomclub.vercel.app/claim?t=TOKEN`
- Fill the form → submit → existing Supabase `/claim` Edge Function
  redeems token → postcard ships
- Verified live: `https://mailroomclub.vercel.app/.well-known/apple-app-site-association` returns 200 + `application/json`

That's a complete claim flow. App Clips and Universal Links are UX
upgrades, not blockers — the product works without them.

## To enable Universal Links into the full Mailroom app

**~5 minutes of clicks.** After this, iPhone users with Mailroom
installed tap a claim link → app opens directly (instead of bouncing
through Safari).

### Step 1 — Apple Developer portal: enable Associated Domains cap

1. https://developer.apple.com/account → Identifiers
2. Tap `com.mailrooms.app` (Mailroom main App ID)
3. Scroll to Capabilities → check **Associated Domains**
4. Save (Apple regenerates the App ID configuration)

### Step 2 — Uncomment + rebuild

In `ios/Mailroom/Mailroom.entitlements`, uncomment the
`com.apple.developer.associated-domains` array (it's already drafted,
just wrapped in `<!-- -->`). Then:

```bash
cd ~/Downloads/mailclub-app
# Bump build number in app.json + ios/Mailroom/Info.plist (40 → 41)
xcodebuild -workspace ios/Mailroom.xcworkspace -scheme Mailroom \
  -configuration Release \
  -archivePath ios/build/Mailroom.xcarchive \
  -destination "generic/platform=iOS" archive
xcodebuild -exportArchive \
  -archivePath ios/build/Mailroom.xcarchive \
  -exportPath ios/build/export \
  -exportOptionsPlist ios/ExportOptions.plist
```

Test: tap a claim link in iMessage on a device with build 41. Should
open Mailroom directly instead of Safari.

## To add the App Clip (no install required for recipients)

**~30-45 minutes total.** Apple's biggest UX win for share-link
flows — recipients enter their address in a tiny native UI without
ever installing Mailroom.

### Step 3 — Apple Developer portal: register Clip bundle ID

1. https://developer.apple.com/account → Identifiers → +
2. App Clip → Continue
3. Bundle ID: `com.mailrooms.app.Clip`
4. Description: "Mailroom App Clip"
5. Capabilities: check **Associated Domains**
6. Register
7. Confirm `com.mailrooms.app.Clip` appears in the identifier list

### Step 4 — Xcode: add the App Clip target

1. Open `ios/Mailroom.xcworkspace` in Xcode
2. File → New → Target → App Clip → Next
3. Product Name: `MailroomClip`
4. Bundle Identifier: `com.mailrooms.app.Clip`
5. Team: `824QVPJ3B5` (Las Olas VC, same as main app)
6. Interface: SwiftUI
7. Embed in Application: `Mailroom`
8. Finish

Then in the new `MailroomClip` group inside Xcode:
- Delete Xcode's auto-generated `MailroomClipApp.swift`, `ContentView.swift`,
  `Info.plist`, `MailroomClip.entitlements`
- Right-click the group → "Add Files to Mailroom..." → navigate to
  `ios/MailroomClip/` in this repo → select the four files
  (`MailroomClipApp.swift`, `ContentView.swift`, `Info.plist`,
  `MailroomClip.entitlements`) → Add to target: **MailroomClip only**

Confirm in the MailroomClip target's Signing & Capabilities tab:
- Bundle Identifier: `com.mailrooms.app.Clip`
- Team: 824QVPJ3B5
- "Associated Domains" capability present with both
  `applinks:mailroomclub.vercel.app` and `appclips:mailroomclub.vercel.app`

### Step 5 — App Store Connect: App Clip experience

1. https://appstoreconnect.apple.com → Mailroom → App Information
2. Scroll to "App Clip Experiences" → add new
3. URL prefix: `https://mailroomclub.vercel.app/claim`
4. Card metadata:
   - Title: "Receive a postcard"
   - Subtitle: "Enter your address — we mail it"
   - Action: "Open" (default)
   - Card image: 1200x600 PNG (TODO — design needed; placeholder OK for first test)
5. Save

### Step 6 — Build + test

```bash
# Bump build number 40 → 42 (or whatever's next)
xcodebuild ... archive
xcodebuild -exportArchive ...
```

Test on a real device (App Clips don't run in simulator):
- TestFlight install of the new build
- Send a postcard to yourself via the link flow
- Tap the resulting link from iMessage on a different device that
  does NOT have Mailroom installed
- App Clip card should appear → tap → SwiftUI form → submit
- Postcard ships

## Files in this repo

| Path | Purpose |
|---|---|
| `ios/MailroomClip/MailroomClipApp.swift` | SwiftUI `@main` entry, captures invocation URL |
| `ios/MailroomClip/ContentView.swift` | Single-screen address form (cream paper, serif headlines) |
| `ios/MailroomClip/Info.plist` | App Clip metadata (NSAppClip dict, portrait only) |
| `ios/MailroomClip/MailroomClip.entitlements` | Associated Domains + parent app id |
| `vercel-staging/.well-known/apple-app-site-association` | Source-of-truth copy (deployed to Vercel) |
| `vercel-staging/vercel.json` | Source-of-truth copy (deployed to Vercel) |
| `vercel-staging/app/claim/page.tsx` | Next.js TSX version (not used — Vercel site is static HTML) |

## What's live on Vercel right now

Pushed to `github.com/scotty123868/mail` → Vercel auto-deployed.

| URL | Status |
|---|---|
| `https://mailroomclub.vercel.app/.well-known/apple-app-site-association` | 200, `application/json`, JSON body intact |
| `https://mailroomclub.vercel.app/claim?t=ANY_TOKEN` | 200, renders the address form HTML |
| `https://mailroomclub.vercel.app/` | Existing marketing site, unchanged |

## Open items deferred to a future build

- **Card image** (1200x600 PNG): design needed.
- **Custom domain** (e.g. `claim.mailroom.app`): Vercel subdomain works
  but a real domain is more professional.
- **AASA caching**: Apple's swcd refreshes the AASA on a schedule
  (sometimes 24-48h). After deploying changes, force a refresh on
  test devices by deleting + reinstalling the main Mailroom app —
  fresh installs always re-fetch the AASA.

## Quick reference — full URL flow

| Recipient state | What happens when they tap a claim link |
|---|---|
| iOS 14+, Mailroom installed, Associated Domains enabled | Universal Link → Mailroom app opens via expo-router `/claim?t=X` |
| iOS 14+, NO Mailroom, App Clip target shipped | App Clip card → SwiftUI form → submit → postcard ships |
| Android | Web fallback at `mailroomclub.vercel.app/claim` → form → submit → postcard ships |
| iOS pre-14 | Web fallback (same as Android) |
| iMessage Preview shows the link | App Clip card preview shown automatically on iOS 14+ |
