# App Clips Setup — Mailroom Claim Flow

**Status: code drafted in build 39. Manual steps required to integrate.**

When a recipient receives a Mailroom claim link (e.g.
`https://mailroomclub.vercel.app/claim?t=ABC123`) and taps it on iOS 14+,
the App Clip launches instead of forcing them through an App Store install.
They enter their mailing address inside a tiny native UI, we redeem the
token via the existing Supabase claim Edge Function, and the postcard
ships. < 10 MB bundle.

## What's already in the repo

**iOS App Clip target source** (`ios/MailroomClip/`)
- `MailroomClipApp.swift` — SwiftUI `@main` entry, captures the
  Universal Link invocation URL.
- `ContentView.swift` — single-screen address form. Cream paper +
  serif headlines, same visual language as the main app.
- `Info.plist` — App Clip metadata (`NSAppClip` dict, portrait only).
- `MailroomClip.entitlements` — Associated Domains
  (`applinks:mailroomclub.vercel.app`, `appclips:mailroomclub.vercel.app`),
  parent-application-identifiers, on-demand-install-capable.

**Vercel marketing-site additions** (`vercel-staging/`)
- `.well-known/apple-app-site-association` — AASA JSON declaring
  the claim URL pattern + the App Clip bundle id.
- `vercel.json` — forces `Content-Type: application/json` on the AASA
  path (Vercel's default content-type detection serves it as octet-stream
  otherwise, which fails Apple's `swcd` validator).
- `app/claim/page.tsx` — Next.js fallback page for Android / desktop /
  any device where Universal Links don't fire. Same form, same Supabase
  endpoint.

## Manual steps to land this in production

These steps require Xcode UI clicks, Apple Developer portal access, and
App Store Connect access — none of which can be safely scripted.
Budget: 30-45 min if everything's set up cleanly.

### 1. Apple Developer portal (5 min)

1. https://developer.apple.com/account → Identifiers → +
2. App Clip → Continue
3. Bundle ID: `com.mailrooms.app.Clip`
4. Description: "Mailroom App Clip"
5. Capabilities: enable Associated Domains.
6. Register.

### 2. Xcode — add the App Clip target (10 min)

1. Open `ios/Mailroom.xcworkspace` in Xcode.
2. File → New → Target → App Clip.
3. Product Name: `MailroomClip`
4. Bundle Identifier: `com.mailrooms.app.Clip`
5. Team: `824QVPJ3B5` (Las Olas VC, same as main app)
6. Interface: SwiftUI
7. Embed in Application: `Mailroom`
8. Finish.

Then:
9. In the new MailroomClip group, delete the generated
   `MailroomClipApp.swift`, `ContentView.swift`, `Info.plist`,
   `MailroomClip.entitlements`.
10. Drag the files from `ios/MailroomClip/` (this repo, already
    drafted) into the Xcode group, choosing "Create groups" and
    "Add to target: MailroomClip" only.
11. In the MailroomClip target → Signing & Capabilities:
    - Add "Associated Domains" capability if not auto-added.
    - Confirm both `applinks:mailroomclub.vercel.app` and
      `appclips:mailroomclub.vercel.app` are present.

### 3. Main app entitlements (2 min)

1. Select the `Mailroom` target → Signing & Capabilities.
2. Add the "Associated Domains" capability if not present.
3. Add `applinks:mailroomclub.vercel.app` to the list.
4. The main app's existing `expo-router` deep-link handler will
   intercept `/claim?t=...` URLs and route to whatever claim screen we
   build into the main app (Phase 2 — for now the main app falls back
   to opening the Universal Link in Safari, which renders the
   Next.js page).

### 4. Vercel deploy (10 min)

In the `mailroomclub.vercel.app` Next.js repo (separate from this
Mailroom iOS repo):

1. Copy `vercel-staging/.well-known/apple-app-site-association` into
   `public/.well-known/apple-app-site-association` (no extension).
2. Copy `vercel-staging/vercel.json` into the project root (merge with
   any existing `vercel.json` — keep both `headers` arrays).
3. Copy `vercel-staging/app/claim/page.tsx` into `app/claim/page.tsx`
   (the Next.js App Router path).
4. Commit + push → Vercel auto-deploys.
5. Validate: `curl -sI https://mailroomclub.vercel.app/.well-known/apple-app-site-association | grep -i content-type`
   should return `application/json`. If not, the Content-Type header
   isn't applying — check that `vercel.json` is at the project root,
   not under `public/`.
6. Validate: `curl -s https://mailroomclub.vercel.app/.well-known/apple-app-site-association | jq`
   should return the JSON intact (not 404, not HTML 200).

### 5. App Store Connect — App Clip experience (10 min)

1. https://appstoreconnect.apple.com → Mailroom → App Information.
2. Scroll to "App Clip Experiences" → add new.
3. URL prefix: `https://mailroomclub.vercel.app/claim`
4. Card metadata:
   - Title: "Receive a postcard"
   - Subtitle: "Enter your address — we mail it"
   - Action: "Open" (the default)
   - Card image: 1200x600 PNG (TODO: design one in build 40)
5. Save.

### 6. Test on a real device (5 min)

App Clips don't run in the simulator. Two ways to test:

**A) From the scheme:**
1. Xcode → MailroomClip scheme → Edit Scheme → Run → Arguments.
2. Set `_XCAppClipURL` env var to
   `https://mailroomclub.vercel.app/claim?t=TEST_TOKEN`.
3. Run on a connected device. The App Clip launches with that URL.

**B) From TestFlight:**
1. Push the build (this is build 39+).
2. On a real device with TestFlight installed, tap the claim link
   from iMessage. iOS shows the App Clip card → tap → form opens.

### 7. (Optional, Phase 2) Switch the claim URL in the iOS app

Currently `src/services/api.ts` mints claim URLs against the Supabase
function domain:
```
https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/claim?t=TOKEN
```

For App Clips to intercept, mint against the AASA-advertised domain
instead:
```
https://mailroomclub.vercel.app/claim?t=TOKEN
```

This switch should happen AFTER step 4 above (AASA file confirmed
serving). Until then, leaving the URL on the Supabase domain means
Universal Links don't intercept and the link opens in Safari, but the
flow still works via the web fallback.

To switch:
- Edit `src/services/api.ts:349` (and 487) — replace `functionsBase`
  with `https://mailroomclub.vercel.app`.
- Ship a new build.

## Why each piece exists

| Piece | Purpose | Why we can't skip |
|---|---|---|
| AASA file | Tells iOS which URLs map to our App Clip | Without it, Universal Links never intercept |
| `Content-Type: application/json` header | Apple's swcd validator rejects octet-stream | Vercel's default sniffing breaks the AASA |
| Parent bundle id entitlement | Links Clip → Full app for install upgrade | Without it, App Clip can't suggest the full app |
| `appclips:` Associated Domain | Tells iOS this domain is App-Clip-capable | `applinks:` alone routes to full app only |
| ASC App Clip Experience | Registers URL pattern → App Clip card | Without it, Apple doesn't know to show the card |

## Open items deferred to a later build

- **Card image** (1200x600 PNG): design needed. Use a Mailroom-branded
  envelope/postcard motif.
- **Card metadata localizations**: English only for v1; add other
  languages once we have demand signal.
- **Universal Link handler inside the main app**: when the full app is
  installed, tapping the claim link should open the app's existing
  postcard receive flow rather than the App Clip. Wire via expo-router
  deep-link handler.
- **Custom domain** (e.g. `claim.mailroom.app`) instead of
  `mailroomclub.vercel.app`. The vercel.app subdomain works but a real
  domain is more professional + lets us avoid potential edge cases
  with Apple's stricter validation on platform subdomains.
- **AASA caching**: Apple's swcd refreshes the AASA on a schedule
  (sometimes 24-48h). After deploys, force a refresh on test devices
  by deleting + reinstalling the main Mailroom app — fresh installs
  always re-fetch the AASA.
