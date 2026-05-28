# Mailroom. setup checklist

Everything you need to register, configure, and ship Mailroom. Read once, then walk through in order.

The app was renamed from **Mail Club** to **Mailroom** on May 11, 2026. All code, docs, and asset references now use the new name. Bundle ID: `com.mailroom.app`. App scheme: `mailroom://`.

---

## What you actually need

A working Mailroom build that goes live on TestFlight requires accounts/configs in seven places. Some are free, some cost money, some block others. The dependency tree:

```
Apple Developer ($99/yr) ───┬──→ App Store Connect (record)
                            │            │
                            │            └──→ TestFlight builds (free, in ASC)
                            │            └──→ IAP products (free, in ASC)
                            │            └──→ Sign in with Apple Services ID
                            │
                            └──→ EAS Build cert / provisioning (free with Expo)

Supabase project (already done) ───┬──→ Database + Auth + Storage
                                   ├──→ profile-photos bucket (TODO)
                                   ├──→ Apple OAuth provider config (TODO)
                                   ├──→ Email/magic-link template config (TODO)
                                   └──→ Edge Functions (for Lob)

Lob account (free signup) ──→ Test keys (free) → Live keys (when you charge)
                            └──→ Webhook for delivery status

GitHub repo ──→ docs/ enabled as Pages → privacy + support URLs

Domain (optional) ──→ Custom URLs for privacy/support pages

App icon + screenshots (Figma/etc.) → ASC asset uploads
```

You can split this into two phases:

- **Phase 1. TestFlight only** (~3-5 hours focused): items 1, 2, 3, 4, 7, 9, 10. Skips IAP, Lob, public review.
- **Phase 2. Public App Store** (~3-5 hours more, plus Apple review wait): items 5, 6, 8.

For your current goal ("just TestFlight for now"), do Phase 1.

---

## 1. Free up disk space (do this first)

Your Mac is at 99% full. You can't run `expo prebuild`, build the sim, or compile a release without breathing room.

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData
rm -rf ~/Library/Caches/com.apple.dt.Xcode
rm -rf ~/Library/Developer/Xcode/iOS\ DeviceSupport/*
brew cleanup -s  # if you use Homebrew
```

This should reclaim 5-10 GB. Verify with `df -h /`.

---

## 2. Apple Developer Program enrollment ($99/yr)

If you haven't already:

1. Go to <https://developer.apple.com/programs/enroll/>
2. Sign in with your Apple ID.
3. Pick **Individual** (Personal account). Business (Organization) requires a D-U-N-S number and takes weeks; you can upgrade later.
4. Pay the $99 annual fee.
5. Enrollment typically completes within an hour, sometimes minutes.

Once enrolled, you can register App IDs, create signing certs, and access App Store Connect.

---

## 3. Register the new Bundle ID

The old `com.mailclub.app` registration (if you ever made one) doesn't carry over. Apple ties App IDs to a specific bundle string, and we've changed it.

1. Go to <https://developer.apple.com/account/resources/identifiers/list>
2. Click **`+`** → **App IDs** → **App**
3. Description: `Mailroom`
4. Bundle ID: **Explicit** → `com.mailroom.app`
5. Capabilities to check now:
   - [x] **In-App Purchase** (for credit packs)
   - [x] **Push Notifications** (delivery + reply notifications)
   - [x] **Sign in with Apple** (for the Apple auth flow. required by Apple Guideline 4.8 if you offer email/password)
6. **Continue** → **Register**

You should now see `com.mailroom.app` in the identifiers list.

> If you registered `com.mailclub.app` earlier and won't use it, you can leave it dormant. Apple doesn't reclaim unused App IDs.

---

## 4. Create the new App Store Connect record

1. Go to <https://appstoreconnect.apple.com/apps>
2. Click **`+`** → **New App**
3. Fill in:
   - **Platforms:** iOS (only)
   - **Name:** `Mailroom`
   - **Primary Language:** English (U.S.)
   - **Bundle ID:** select `com.mailroom.app` from the dropdown
   - **SKU:** `mailroom-001` (internal-only)
   - **User Access:** Full Access
4. **Create**

This is your app record. All TestFlight builds, IAP configs, screenshots, and review submissions live under it.

> Note: ASC remembers the app forever. If you delete this record, the bundle ID can't be reused for 6 months. Don't delete it casually.

---

## 5. Configure EAS Build for the new bundle ID

EAS Build needs to know to use the new bundle ID. Since we already changed `app.json`, the next build will pick it up. but you'll need fresh signing certs/provisioning profiles for the new bundle.

```bash
cd /Users/scottylefkowitz/Downloads/mailclub-app
eas login              # if not already
eas build:configure    # regenerates eas.json against new bundle ID
eas build --platform ios --profile production
```

EAS will:
1. Ask for your Apple ID + 2FA code.
2. Detect that `com.mailroom.app` doesn't have a Distribution Certificate yet.
3. Offer to create one. Say yes.
4. Create the cert + provisioning profile.
5. Build the .ipa.

First build is the longest (~15-25 min). Re-builds reuse certs (~10 min).

> The old `com.mailclub.app` certs (if any exist) will sit in your Apple Developer account harmlessly. You can manually revoke them later from <https://developer.apple.com/account/resources/certificates/list>.

---

## 6. Regenerate the native iOS project

Right now `ios/MailClub/` directory still has the old name baked into Xcode files (project name, target name, build settings, plist references). Expo rebuilds this from `app.json`:

```bash
cd /Users/scottylefkowitz/Downloads/mailclub-app
npx expo prebuild --clean
```

This will:
- Delete `ios/` and `android/`
- Regenerate `ios/Mailroom/` and the Xcode project from `app.json` + your installed Expo plugins
- Run `pod install`

> **Heads up:** this nukes any manual edits you made to the native projects. If you had custom entitlements, custom info.plist keys, or pod modifications, you need to re-apply them. We have none currently.

Verify after running: `ls ios/` should show `Mailroom/`, `Mailroom.xcworkspace`, `Mailroom.xcodeproj`.

---

## 7. Authentication setup. and the magic link question

You asked: "we need magic link right?"

**Short answer: no, you don't need magic link.** Email + password works for TestFlight. Apple Guideline 4.8 requires Sign in with Apple if you offer any third-party auth, which we're adding (see `AUTH_FLOW_PLAN.md`). Magic link is a third option, not a requirement.

**Long answer. the three auth methods, ranked for Mailroom:**

| Method | UX cost to user | UX cost to dev | When to use |
|---|---|---|---|
| **Sign in with Apple** | one tap, Face ID | medium (Apple Services ID, .p8 key, Supabase config) | Required by App Store Guideline 4.8 if you offer any other auth method. Always include. |
| **Email + password** | type both + remember | trivial (already wired) | Familiar pattern, works without dependencies, ~80% of apps default here. |
| **Magic link** | type email + go check inbox + tap link + come back | medium (deep linking, Supabase email template, sender domain) | Great when passwords are friction (forgotten password = #1 support ticket). Pairs well with Apple. Worse for users who already have 1Password. |

### My recommendation for Mailroom

**Phase 1 (TestFlight):** Apple + Email-password. Two buttons on the welcome screen. Skip magic link.
- Why: simpler, faster to ship, password reset already works via Forgot password link.
- The "ludite" pattern from teteapp-main was Apple + magic link. Magic link is cool but creates a "did the email arrive?" pause that hurts conversion for first-time users.

**Phase 2 (post-launch, if you see lots of password resets):** Add magic link as a third option.

If you really want magic link now (~2 hours extra), here's what's involved:

```ts
// In WelcomeSheet, replace password entry with magic link request:
await supabase.auth.signInWithOtp({
  email: email.trim(),
  options: {
    emailRedirectTo: "mailroom://auth/callback",
  },
});
// User then taps a link in their inbox.
```

You need:
- **Deep link config**. `app.json` already has `"scheme": "mailroom"`. Add `app/auth/callback.tsx` route that calls `supabase.auth.exchangeCodeForSession()`.
- **Supabase email template**. in dashboard → Auth → Email Templates → Magic Link, edit the HTML so the link looks like Mailroom branding (current default is "Supabase").
- **Custom sender**. Supabase's default uses `noreply@mail.app.supabase.io`. To send from `hello@mailroom.app`, configure SMTP in the Supabase dashboard. Costs $0/mo on the Pro plan, requires DNS records.

For TestFlight beta, all three of these are friction. Defer.

### What's required regardless (Sign in with Apple)

Required by Apple if you offer any auth. Full step-by-step is in `AUTH_FLOW_PLAN.md`:

1. Apple Developer → Identifiers → **Services IDs** → create `com.mailroom.app.auth`
2. Same flow → **Keys** → create a Sign in with Apple key, download the .p8 file
3. Supabase Dashboard → Authentication → Providers → enable Apple, paste:
   - Services ID: `com.mailroom.app.auth`
   - Team ID: from Apple Developer (top-right)
   - Key ID: from the .p8 you just downloaded
   - Private key: contents of .p8
4. `npx expo install expo-apple-authentication`
5. Rewrite WelcomeSheet to have an auth-wall step (Continue with Apple / Continue with email)

---

## 8. Supabase setup additions

The Supabase project (`nlwnmgwylmmnaemdnzlq.supabase.co`) is already running. Three things to add:

### 8.1 Create the `profile-photos` Storage bucket

Required for profile photo upload to sync across devices.

1. Supabase dashboard → Storage → **New bucket**
2. Name: `profile-photos`
3. Public bucket: **No** (we'll use folder-scoped RLS)
4. File size limit: 5 MB
5. Allowed MIME types: `image/jpeg, image/png, image/webp, image/heic`
6. Apply RLS policies. copy-paste this in SQL editor:

```sql
create policy "users read all profile photos"
  on storage.objects for select
  using (bucket_id = 'profile-photos');

create policy "users upload to their own folder"
  on storage.objects for insert with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users update their own photo"
  on storage.objects for update using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users delete their own photo"
  on storage.objects for delete using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

### 8.2 Apply pending migrations

```bash
cd /Users/scottylefkowitz/Downloads/mailclub-app/supabase
supabase login                         # one-time
supabase link --project-ref nlwnmgwylmmnaemdnzlq
supabase db push                       # runs all migrations including profile_photo
```

### 8.3 (Phase 2 only) Email/auth template polish

For magic link or password reset emails to look like Mailroom and not Supabase default:

1. Authentication → Email Templates → for each template, edit HTML
2. Authentication → URL Configuration → Site URL: `https://yourdomain.com` (after you have one)
3. Authentication → URL Configuration → Redirect URLs: add `mailroom://auth/reset` and `mailroom://auth/callback`

---

## 9. GitHub Pages for privacy + support URLs

Required for App Store submission. You have the content in `docs/` already.

1. Push the current branch (or merge to `main`)
2. GitHub repo → **Settings → Pages**
3. Source: **Deploy from a branch**
4. Branch: `main`, folder: `/docs`
5. Save

After ~1 minute, your pages will live at:

- `https://<your-github-username>.github.io/<repo-name>/`. landing
- `https://<your-github-username>.github.io/<repo-name>/privacy.html`. privacy policy
- `https://<your-github-username>.github.io/<repo-name>/support.html`. support page

Paste those URLs into App Store Connect → App Information when prompted.

> Optional: register `mailroom.app` ($15/yr at Cloudflare or Namecheap) and point a CNAME to the GitHub Pages URL. Then your URLs become `https://mailroom.app/privacy.html`. Cleaner for App Store reviewers.

---

## 10. Submit to TestFlight

Once Phase 1 items 1-9 are done:

```bash
cd /Users/scottylefkowitz/Downloads/mailclub-app
eas build --platform ios --profile production
# wait ~15-25 min
eas submit --platform ios --latest
# wait ~10-30 min for Apple processing
```

In App Store Connect → **TestFlight** tab:
1. Build will show "Missing Compliance" until you answer the export question. we set `ITSAppUsesNonExemptEncryption: false` so this should auto-resolve. If not, click and answer "No, this app does not use encryption."
2. **Internal Testing** → create a group → add testers by Apple ID email
3. Attach the build to the group
4. Testers get a TestFlight email and can install immediately.

No App Store review for internal testers. Limit: 100 internal testers.

For more than 100 people, **External Testing** is required. adds a ~24-48h beta review by Apple. Lighter than full App Store review.

---

## Phase 2. for public App Store release

When you decide to go beyond TestFlight, this is the additional checklist:

### 11. IAP product setup

App Store Connect → your app → **Monetization → In-App Purchases**:

| Reference Name | Product ID | Type | Price |
|---|---|---|---|
| 5 credit pack | `mailroom.credits.5` | Consumable | $5 |
| 10 credit pack | `mailroom.credits.10` | Consumable | $10 |
| 25 credit pack | `mailroom.credits.25` | Consumable | $20 |
| 50 credit pack | `mailroom.credits.50` | Consumable | $35 |

For each: localized display name + description + a screenshot of the purchase screen.

Also:
- Sign the **Paid Apps Agreement**
- Add **Tax Forms** (W-9 for US)
- Add **Banking Information** for payouts

Until these three are done, your IAPs sit in "Waiting for Review" forever.

### 12. App Privacy questionnaire

App Store Connect → your app → **App Privacy**. Pre-filled answers in `APP_STORE_CONNECT.md`. Submit and publish.

### 13. Screenshots

Minimum required: iPhone 6.7" (1290 × 2796). Capture from the iPhone 17 Pro simulator:

```bash
xcrun simctl io booted screenshot screenshot.png
```

Recommended: a 3-shot story. Hero My Card → Send screen → Friends rolodex.

### 14. Description + keywords + URLs

Full template in `APP_STORE_CONNECT.md`. Keywords (100 chars): `postcard,letter,mail,handwritten,friends,pen pal,real mail,stationery,greeting card,connection`

### 15. Age rating

Walk through the questionnaire. Mailroom is 17+ unless you add content moderation for user-generated postcard messages.

### 16. Lob integration

Real postcards get mailed. Full walkthrough in `LOB_INTEGRATION.md`. Includes:
- Account setup
- Edge Function pattern
- Schema migration for `lob_id` / `lob_status`
- Webhook for delivery events
- Unit economics + margin tables

### 17. Submit for Apple App Store Review

Add screenshots, description, build, IAPs. Click **Add for Review**. Wait 24h-7 days.

Common first-submission rejections:
- IAPs not properly disclosed in description
- Privacy policy URL broken
- Account deletion flow missing (we have it. Settings → Delete account)
- Demo account credentials not working for reviewer
- Misleading content claims

---

## Quick-reference

```bash
# Phase 1. TestFlight only
df -h /                                                  # check disk space, free if <5GB
# (manual) Apple Developer enrollment
# (manual) Register com.mailroom.app App ID
# (manual) Create App Store Connect record for Mailroom

cd /Users/scottylefkowitz/Downloads/mailclub-app
npx expo prebuild --clean                                # regenerate ios/Mailroom/
eas build:configure
eas build --platform ios --profile production
eas submit --platform ios --latest

# (manual) Add internal testers in ASC → TestFlight
# (manual) Enable GitHub Pages: Settings → Pages → main /docs

# Phase 2. for public App Store later
# Configure IAP products
# Fill out App Privacy questionnaire
# Capture screenshots
# Add description + keywords + URLs
# Walk age rating questionnaire
# Wire Lob (see LOB_INTEGRATION.md)
# Submit for review
```

---

## Useful links

- Apple Developer: <https://developer.apple.com/account>
- App Store Connect: <https://appstoreconnect.apple.com>
- Supabase dashboard: <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq>
- Lob dashboard: <https://dashboard.lob.com>
- Expo / EAS: <https://expo.dev/accounts>
- Companion docs in this repo:
  - `APP_STORE_CONNECT.md`. the full ASC walkthrough
  - `AUTH_FLOW_PLAN.md`. Sign in with Apple + email
  - `LOB_INTEGRATION.md`. how to wire Lob for real postcards
  - `POSTCARD_DESIGN_SPEC.md`. 4×6 spec, color profile, USPS rules
