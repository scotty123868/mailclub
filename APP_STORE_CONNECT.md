# App Store Connect setup — step by step

This is the exact sequence to get **Mailroom** registered, signed, and ready for TestFlight. Read it top to bottom the first time. Each section calls out which steps need a **paid Apple Developer account** (`$99/yr`) and which are free.

---

## 0. Prerequisites

- [ ] **Apple ID** with a working phone number for 2FA
- [ ] **Apple Developer Program** membership (paid). Sign up: <https://developer.apple.com/programs/enroll/>. Personal account is fine for now. Business takes weeks (D-U-N-S verification).
- [ ] **macOS + Xcode 26** installed (you have these)
- [ ] **EAS account** (`npm install -g eas-cli && eas login`)
- [ ] **Two emails you control** — one for the Apple ID, one for TestFlight invites (can be the same)

---

## 1. Register the Bundle ID

The app's bundle identifier is **`com.mailroom.app`**. It needs to exist in Apple's identifier registry before you can build for distribution.

1. Go to <https://developer.apple.com/account/resources/identifiers/list>
2. Click the **`+`** button → **App IDs** → **App**
3. Description: `Mailroom`
4. Bundle ID: **Explicit** → `com.mailroom.app`
5. Capabilities to enable now:
   - [x] **In-App Purchase** (you'll need this for credit packs)
   - [x] **Push Notifications** (you'll need this for "card delivered" + "reply received")
   - Leave everything else off — Sign in with Apple, iCloud, etc. aren't used.
6. **Continue** → **Register**

You should now see `com.mailroom.app` in the identifiers list.

---

## 2. Create the App Record in App Store Connect

1. Go to <https://appstoreconnect.apple.com/apps>
2. Click **`+`** → **New App**
3. Fill in:
   - **Platforms:** iOS (only — drop tvOS/macOS even if they're checked)
   - **Name:** `Mailroom`
   - **Primary Language:** `English (U.S.)`
   - **Bundle ID:** select `com.mailroom.app` from the dropdown (this is why we did step 1 first)
   - **SKU:** anything unique to you — `mailroom-001` works. This is internal-only, never shown to users.
   - **User Access:** `Full Access` if it's just you. If you have a team, you can restrict.
4. **Create**

This is your "app record". Everything else — TestFlight builds, IAP products, screenshots — lives under this record.

---

## 3. Configure signing for EAS Build

EAS Build needs to push signed binaries to Apple. The first time you run `eas build` for iOS, EAS asks for permission to manage signing certificates + provisioning profiles on your behalf. Say yes.

```bash
cd /Users/scottylefkowitz/Downloads/mailroom-app
eas login                       # one-time
eas build:configure             # one-time per project
# Pick: iOS only
# Accept the default eas.json EAS writes
```

Inspect the generated `eas.json` — should look roughly like:

```json
{
  "build": {
    "production": {
      "ios": { "autoIncrement": "buildNumber" }
    }
  },
  "submit": {
    "production": { "ios": { "ascAppId": "..." } }
  }
}
```

The `ascAppId` is automatically filled by EAS when it reads your App Store Connect listing.

---

## 4. Run the first production build

```bash
eas build --platform ios --profile production
```

What happens:
1. EAS asks for your **Apple ID + password** + a **2FA code** from your trusted device. This is normal — they're authenticating on your behalf to mint a certificate.
2. EAS creates a **Distribution Certificate** + a **Provisioning Profile** for `com.mailroom.app`. They land in your Apple Developer account and you can see them at <https://developer.apple.com/account/resources/certificates/list>.
3. EAS uploads your source to their cloud builder. Build takes ~15-25 min.
4. You get a `.ipa` URL when it's done.

The first build is the longest. Re-builds reuse the certs and finish in ~10 min.

If you get an error like *"Couldn't find a Distribution Certificate that matches..."*, **let EAS create one for you** — answer `yes` at every prompt.

---

## 5. Submit to TestFlight

```bash
eas submit --platform ios --latest
```

This uploads the latest build to App Store Connect. Apple's processing pipeline takes 10-30 minutes after upload — you'll get an email when it's done.

In App Store Connect → **TestFlight** tab, the build will show **Missing Compliance** at first. Apple wants the export compliance question answered.

Click the build → answer **"No, this app does not use encryption"**. (We set `ITSAppUsesNonExemptEncryption: false` in `app.json`, so this should be auto-answered. If it isn't, click through.)

---

## 6. Add internal testers (no review required)

Internal testing skips Apple's review entirely. You can hand the build to up to 100 testers immediately.

1. In App Store Connect → **TestFlight** → **Internal Testing**
2. Click **`+`** next to **Internal Testers**
3. Create a group called `Friends & me`
4. Add testers by their Apple ID email — they need to accept the TestFlight invite + have the TestFlight iOS app installed (<https://apps.apple.com/app/testflight/id899247664>)
5. Attach the build you just uploaded
6. They get a push notification and can install Mailroom from TestFlight

This is the meaningful unlock — your friends can use the app now.

---

## 7. (When you're ready) External testing — needs a review

If you want to invite more than your inner circle, Apple requires a **review** of your build (lighter than the full App Store review, usually 24-48h). Add an **External Testing** group, fill in:

- Beta App Description: "Mailroom is a private postcard club in beta. Send real handwritten notes + photo postcards to friends. Credits system in beta — no real payments yet."
- Email + contact info for beta crash reports
- Demo account (if your app needs login to use): create a test user via the WelcomeSheet flow and use those credentials

Submit for **beta review**. Wait. Once approved you can invite up to 10,000 external testers via public link.

---

## 8. (Before App Store *Review*) — IAP, screenshots, metadata

TestFlight ≠ App Store. Public release needs more:

### 8.1 In-App Purchase products

1. App Store Connect → your app → **Monetization** → **In-App Purchases**
2. Click **`+`** for each pack:

| Reference Name | Product ID | Type | Price Tier |
|---|---|---|---|
| 5 credit pack | `mailroom.credits.5` | Consumable | $5 |
| 10 credit pack | `mailroom.credits.10` | Consumable | $10 |
| 25 credit pack | `mailroom.credits.25` | Consumable | $20 |
| 50 credit pack | `mailroom.credits.50` | Consumable | $35 |

3. Each one needs:
   - Display Name (e.g. "5 credits")
   - Description (1-2 sentences — "Five credits for sending postcards through Mailroom.")
   - Localization (just English for now)
   - At least one screenshot of the purchase screen (Apple uses it during review)
4. **Submit for review** — IAPs get reviewed alongside the next app version.

You also need to:
- Sign the **Paid Apps Agreement** at App Store Connect → **Agreements, Tax, and Banking**
- Add **Tax Forms** (W-9 for US)
- Add **Banking Information** for payouts

Without these signed, your IAPs are stuck in "Waiting for Review" forever.

### 8.2 App Privacy questionnaire

App Store Connect → your app → **App Privacy**

For Mailroom v0.5, the answers are:

- **Does this app collect data from this app?** → **Yes** (email + name)
- Then you'll declare:
  - Contact Info → Email Address → Linked to user, Not used for tracking, Purpose: App Functionality + Account Management
  - User Content → Other User Content → Linked to user, Not used for tracking, Purpose: App Functionality
  - Identifiers → User ID → Linked to user, Not used for tracking, Purpose: App Functionality
- We do **not** collect health, financial, location, contacts, sensitive info, browsing history, or anything trackable.

Save + Publish. This becomes the "Privacy Nutrition Label" on your App Store page.

### 8.3 Required-reasons API declarations

We already declare these in `ios/MailClub/PrivacyInfo.xcprivacy`:
- `NSPrivacyAccessedAPICategoryUserDefaults` (for AsyncStorage)
- `NSPrivacyAccessedAPICategoryFileTimestamp` (RN file ops)
- `NSPrivacyAccessedAPICategoryDiskSpace`
- `NSPrivacyAccessedAPICategorySystemBootTime`

No changes needed — already in the build.

### 8.4 Screenshots

You need screenshots for these device sizes (Apple requires the largest of each family, others are auto-generated):

- **iPhone 6.7"** (iPhone 15 Pro Max / 16 Pro Max) — **required**, 1290 × 2796
- **iPhone 6.5"** (iPhone 11 Pro Max) — **required**, 1242 × 2688

You can capture these from a simulator: `xcrun simctl io booted screenshot screenshot.png` while running on iPhone 15 Pro Max sim.

Marketing tip: a 3-screenshot story works better than 10 disconnected shots. Suggest:
1. Hero My Card screen — your identity, your stamp
2. Send screen — show the 4 category tiles
3. Friends rolodex — the deck of friend cards

### 8.5 Description + keywords + URLs

App Store Connect → your app → **App Information** + **iOS App** sidebar.

Required fields:

- **Subtitle (30 chars):** something like `Send real postcards to friends`
- **Description (4000 chars):** the long pitch. Open with one sentence on what it is, three sentences on why it's different, then a feature list. Mailroom's spec doc has good source material.
- **Keywords (100 chars, comma-separated):** `postcard,letter,mail,handwritten,friends,pen pal,real mail,stationery,greeting card,connection`
- **Support URL:** required, can be a Notion page or Linktree — link to where you'll handle bug reports
- **Marketing URL:** optional
- **Privacy Policy URL:** required. Easy path: put a simple privacy policy on a Notion / GitHub Pages site. Apple will reject if this URL 404s.

### 8.6 Age rating

Walk through the age-rating questionnaire. Mailroom has user-generated content (postcard messages), so you'll get a 17+ if you answer "Yes, infrequent/mild" to "User Generated Content". To stay under 17+, you'd need to add a content moderation policy + reporting flow.

For TestFlight you can ship 17+. For public App Store, consider the moderation work first.

### 8.7 Pricing & availability

App Store Connect → **Pricing and Availability**

- **Price:** Free (the app is free, you sell credits via IAP)
- **Availability:** All countries (or pick — start with just US/CA/UK for a softer launch)

---

## 9. Submit for App Store Review

When everything above is done:

1. App Store Connect → your app → iOS App → **Prepare for Submission**
2. Scroll to **Build** section → add the TestFlight build you want to release
3. **Add for Review** at the bottom
4. Apple reviews in 24h-7days depending on backlog. They're pickier on first submissions — expect 1-2 rejections that you'll iterate through.

Common rejection reasons for an app like Mailroom:
- IAP not properly disclosed in description
- Privacy policy URL broken
- Account deletion missing (we added this in v0.6 — Settings → Delete account)
- Demo account not working for the reviewer
- "Misleading content" if the app promises features it doesn't have yet (we cleaned this up)

---

## Quick reference — the steps in one block

```bash
# (1) Register bundle ID at developer.apple.com (manual)
# (2) Create app record at appstoreconnect.apple.com/apps (manual)

# (3-4) Build
cd /Users/scottylefkowitz/Downloads/mailroom-app
eas login
eas build:configure          # one-time
eas build --platform ios --profile production

# (5) Submit to TestFlight
eas submit --platform ios --latest

# (6) Add internal testers in App Store Connect → TestFlight
#     They can install immediately, no review needed.

# (7-9) For public release, finish IAP + screenshots + privacy + submit for review (manual)
```

That's the whole list. The first time through takes 2-4 hours of focused work, most of it waiting for Apple's email confirmations. After that, every shipment is `eas build && eas submit && wait 30 min`.
