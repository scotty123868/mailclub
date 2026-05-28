# App Store Connect. create the new Mailroom app record

You need to create a brand-new App Store Connect record for **Mailroom** with bundle ID `com.mailrooms.app`. (Note the trailing `s`. `com.mailroom.app` was taken globally, so we use `com.mailrooms.app`.)

> **Time:** ~15 minutes total, plus Apple Developer Console steps.
> **Prerequisites:** active Apple Developer Program membership ($99/yr). Not enrolled yet? Start at <https://developer.apple.com/programs/enroll/>.

---

## 0. We sell physical goods. We use STRIPE, not Apple IAP.

Mailroom credits are redeemed for postcards mailed via USPS. Apple Guideline **3.1.5(a)** requires non-IAP for physical goods. The 2024 update to 3.1.1 explicitly carves out physical gift cards. Precedent: TouchNote, Felt, Postagram all on App Store using Stripe.

**Translation:** skip every "In-App Purchase" step in earlier drafts. Use Stripe. see `STRIPE_SETUP.md` for the full wiring.

---

## 1. Register the new Bundle ID in Apple Developer Console (5 min)

**Direct link:** <https://developer.apple.com/account/resources/identifiers/list>

1. Sign in with your Apple Developer Apple ID
2. Click **`+`** → **App IDs** → Continue
3. Type: **App** → Continue
4. **Description:** `Mailroom`
5. **Bundle ID:** select **Explicit** → enter `com.mailrooms.app`
6. **Capabilities**. check:
   - [x] **Push Notifications** (for "card delivered" + "reply received" alerts)
   - [x] **Sign in with Apple** → **CRITICAL:** when prompted, select **"Enable as a primary App ID"** (NOT "Group with an existing primary"). If you group it, your sign-in flow inherits the other app's name/icon on Apple's consent dialog. See the note below if you've already done this wrong.
   - [x] **Apple Pay Payment Processing** (Stripe wraps Apple Pay; this capability is needed for the wrapper to work)
   - Leave In-App Purchase **off**. we're not using it.
7. **Continue** → **Register**

### If you accidentally grouped Sign in with Apple:

Symptom: in the Services ID config, the only Primary App ID option is some other app of yours.

Fix:
1. Open the App ID for `com.mailrooms.app`
2. Scroll to Capabilities → Sign in with Apple → click **Edit**
3. Look for a radio button at the TOP of the modal:
   - ○ Enable as a primary App ID
   - ● Group with an existing primary App ID
4. Switch to "Enable as a primary App ID"
5. Save the capability, then save the App ID

If the radio isn't visible:
1. Uncheck Sign in with Apple entirely
2. Save the App ID
3. Re-check Sign in with Apple
4. NOW the radio appears
5. Pick "Enable as a primary"
6. Save

---

## 2. Configure Sign in with Apple (10 min. needed before App Store submission, NOT for TestFlight)

You can skip this for the TestFlight beta. Sign in with Apple is only required at App Store submission (Guideline 4.8).

### 2a. Create a Services ID (for Supabase OAuth)

**Direct link:** <https://developer.apple.com/account/resources/identifiers/list/serviceId>

1. Click **`+`** → **Services IDs** → Continue
2. **Description:** `Mailroom Sign in with Apple`
3. **Identifier:** `com.mailrooms.app.auth`
4. **Continue** → **Register**
5. Click into the new Services ID → check **Sign in with Apple** → click **Configure**
6. **Primary App ID:** select `com.mailrooms.app` (only available if step 1 was done correctly. see "If you accidentally grouped" above)
7. **Domains:** `nlwnmgwylmmnaemdnzlq.supabase.co`
8. **Return URLs:** `https://nlwnmgwylmmnaemdnzlq.supabase.co/auth/v1/callback`
9. **Save** → **Continue** → **Save**

### 2b. Create the Sign in with Apple key (.p8)

**Direct link:** <https://developer.apple.com/account/resources/authkeys/list>

1. Click **`+`** to add a new key
2. **Key Name:** `Mailroom Sign in with Apple key`
3. Check **Sign in with Apple** → click **Configure**
4. **Primary App ID:** `com.mailrooms.app`
5. **Save** → **Continue** → **Register**
6. **DOWNLOAD THE .P8 FILE**. single chance. Treat it like a password.
7. Note the **Key ID** (10 chars, like `85YFCWRNYB`)

### 2c. Find your Team ID

**Direct link:** <https://developer.apple.com/account>

Top-right corner shows your Team ID (10 chars).

### 2d. Configure Supabase Apple OAuth

**Direct link:** <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/auth/providers>

1. Find **Apple** → toggle **Enabled**
2. Paste:
   - **Services ID:** `com.mailrooms.app.auth`
   - **Team ID:** from step 2c
   - **Key ID:** from step 2b
   - **Private key (.p8):** open the .p8 in TextEdit → cmd+A → cmd+C → paste. Include the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines.
3. **Save**

Apple Sign-in in the app now works end-to-end. The .p8 is no longer needed after Supabase has it. move it out of Downloads to `~/Documents/keys/` (do NOT commit to git; `.gitignore` already excludes `*.p8`).

---

## 3. Create the App Store Connect record (5 min)

**Direct link:** <https://appstoreconnect.apple.com/apps>

1. Click **`+`** (top-left) → **New App**
2. Fill out:
   - **Platforms:** ☑ iOS only
   - **Name:** `Mailroom`
   - **Primary Language:** `English (U.S.)`
   - **Bundle ID:** select `com.mailrooms.app` (this is why we registered it in step 1)
   - **SKU:** `mailroom-001` (internal only)
   - **User Access:** `Full Access`
3. Click **Create**

> **Important:** Once this record exists, the bundle ID `com.mailrooms.app` is reserved for 12 months even if you delete the record. Don't experiment.

---

## 4. Set up basic App Information (10 min)

Click into the app record → **App Information**.

### Localizable information (English for now)
- **Subtitle (30 chars):** `Send real postcards to friends`
- **Privacy Policy URL:** `https://<github-username>.github.io/mailroom/privacy.html`. **Required**. Apple rejects without it.

### General information
- **Category:** Primary = `Lifestyle`. Secondary = `Social Networking`
- **Content Rights:** "Does your app contain, show, or access third-party content?" → **No**
- **Age Rating:** click Edit → walk through:
  - "User generated content?" → **Yes, infrequent/mild** → results in 17+ rating because postcard messages are unmoderated. Reduce by adding moderation later.
- **Bundle ID:** auto-filled to `com.mailrooms.app`

Click **Save**.

---

## 5. Pricing & Availability (2 min)

Left sidebar → **Pricing and Availability**.

- **Price:** $0.00 (Free). The app is free; credits sold via **Stripe in-app** (not IAP).
- **Availability:** for TestFlight, "Available in all countries" is fine. For App Store launch later, consider starting with just US/CA/UK.

Click **Save**.

---

## 6. NO in-app purchases (skip this entire section in older drafts)

We are NOT using Apple IAP. Mailroom credit packs are sold via Stripe. see `STRIPE_SETUP.md` for the full wiring.

You do NOT need to:
- Create IAP products in App Store Connect
- Sign the Paid Apps Agreement
- Fill out W-9 / banking forms (Stripe handles payouts directly to your bank)

> **App Review note:** In the "App Review Information" section (step 9), explicitly mention that purchases are processed by Stripe for physical goods compliance with Guideline 3.1.5(a). Reviewers see this all the time for postcard apps. TouchNote, Felt, Postagram. Include 1 sentence: *"Mailroom sells credit packs that are redeemed for physical postcards mailed via USPS. Per Guideline 3.1.5(a), purchases use Stripe."*

---

## 7. App Privacy questionnaire (10 min)

Left sidebar → **App Privacy** → **Get Started**.

### Does this app collect data?
**Yes**

### Declare each data type Mailroom collects:

**Contact Info → Email Address:**
- Linked to identity: **Yes**
- Tracking: **No**
- Purposes: **App Functionality**, **Account Management**

**Contact Info → Name:**
- Linked: **Yes**
- Tracking: **No**
- Purposes: **App Functionality**

**Contact Info → Physical Address:**
- Linked: **Yes**
- Tracking: **No**
- Purposes: **App Functionality** (for shipping postcards via Lob)

**User Content → Photos:**
- Linked: **Yes**
- Tracking: **No**
- Purposes: **App Functionality**

**User Content → Other User Content** (postcard messages):
- Linked: **Yes**
- Tracking: **No**
- Purposes: **App Functionality**

**Identifiers → User ID:**
- Linked: **Yes**
- Tracking: **No**
- Purposes: **App Functionality**

**Purchases → Purchase History:**
- Linked: **Yes**
- Tracking: **No**
- Purposes: **App Functionality** (credit balance tracking)

**Financial Info → Payment Info:**
- This goes through Stripe. they collect it, you don't. Do NOT declare. Stripe maintains its own privacy attestations.

### Do NOT declare:
- Location (we never collect)
- Browsing history
- Health, financial info, sensitive info
- Identifiers used for tracking

Click **Save** → **Publish**. Produces the Privacy Nutrition Label.

---

## 8. Ship to TestFlight

Everything above is one-time setup. Build + ship:

```bash
cd /Users/scottylefkowitz/Downloads/mailclub-app
eas build --platform ios --profile production
eas submit --platform ios --latest
```

After ~10-30 min the build appears in:
**Direct link:** <https://appstoreconnect.apple.com/apps> → Mailroom → TestFlight tab

In TestFlight:
1. Click the build under iOS Builds
2. Answer **Missing Compliance** → "Does your app use encryption?" → **No** (we set `ITSAppUsesNonExemptEncryption: false` in app.json)
3. Add **Internal Testers** group → invite by Apple ID email
4. Testers install via the TestFlight iOS app

No App Store review needed for internal testers (up to 100). External testing (>100 or unfamiliar people) gets a quick beta review (~24-48h).

---

## 9. Submit for App Store Review (whenever you're ready for public launch)

Left sidebar → **iOS App** → **Prepare for Submission**.

Required:
- ✅ App Information (step 4)
- ✅ Pricing & Availability (step 5)
- ✅ App Privacy (step 7)
- ✅ Build attached
- ⚠️ Screenshots. minimum **iPhone 6.7" (1290 × 2796 px)**. 3-5 tells a story; 1 isn't enough.
- ⚠️ Description (up to 4000 chars)
- ⚠️ Keywords (100 chars: `postcard,mail,handwritten,friends,letter,real mail,stationery,greeting card,connection,pen pal`)
- ⚠️ Support URL: `https://<github-username>.github.io/mailroom/support.html`
- ⚠️ Marketing URL (optional)
- ⚠️ Promotional Text (170 chars, optional): `Real postcards. Real handwriting. Real friends. Sign up free and get 5 cards on us.`

### App Review Information (CRITICAL for Stripe acceptance)

In the **Notes** field at the bottom of submission, paste:

> Mailroom is a postcard-sending app. Users buy credit packs (5/10/25/50 credits) and redeem them for real physical postcards mailed via USPS through our printing partner Lob (lob.com).
>
> Per App Store Review Guideline 3.1.5(a) ("Physical Goods and Services Outside of the App"), purchases use Stripe rather than In-App Purchase. This is the same approach used by TouchNote (App ID 308955085), Felt (App ID 1188856465), and Postagram (App ID 410985556). all approved postcard apps with the identical business model.
>
> Demo account for testing:
> - Email: review@mailroom.app
> - Password: <provide>
> - Pre-loaded with 25 credits
> - Test postcards send to Lob in test mode (no physical mail produced)

Click **Submit for Review**. Apple reviews in 24h-7 days.

Common rejection reasons to head off:
- **Stripe + physical goods not clearly disclosed** → the notes above prevent this
- **Privacy policy URL 404s** → test in a private browser window before submitting
- **Demo account doesn't work** → log in as the review account yourself before submitting

---

## Useful links

- App Store Connect: <https://appstoreconnect.apple.com>
- Apple Developer Console: <https://developer.apple.com/account>
- Identifiers list: <https://developer.apple.com/account/resources/identifiers/list>
- Services IDs: <https://developer.apple.com/account/resources/identifiers/list/serviceId>
- Sign in with Apple Keys: <https://developer.apple.com/account/resources/authkeys/list>
- App Review Guidelines: <https://developer.apple.com/app-store/review/guidelines/>
- Companion docs in this repo:
  - `STRIPE_SETUP.md`. the payments wiring (replaces what would have been IAP)
  - `LOB_QUICKSTART.md`. the printing partner setup
  - `IMPLEMENTATION_LOG.md`. high-level state of what's wired
