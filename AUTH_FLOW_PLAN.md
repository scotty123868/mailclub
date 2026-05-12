# Auth flow — simple email + Sign in with Apple

You pointed at <https://github.com/scotty123868/teteapp-main> as the reference architecture. This doc lays out exactly what changes in Mailroom to match that pattern: **one welcome screen, two big choices — "Continue with Apple" or "Continue with email" — and nothing else.**

This replaces the current two-step Welcome flow (identity → email/password) with something closer to what apps like Cash App, Tweet, and teteapp use: identity comes *after* auth, not before.

---

## What teteapp does (the pattern)

From the teteapp-main flow:

1. **Splash → Auth wall.** First screen has the brand and two buttons:
   - **"Continue with Apple"** (uses native Apple Auth Services)
   - **"Continue with email"** (opens an email input)
2. **Apple path:** Apple sheet pops up → user authorizes → app gets a token + email + (optionally) name → posted to backend → session created → app proceeds to onboarding.
3. **Email path:** Type email → magic link OR email + password → in either case, session created → app proceeds to onboarding.
4. **Identity step (post-auth):** Once authed, the app asks "what should we call you?" + city/state. No password ever required again.

The win over our current flow: **fewer fields up front**, and the Apple path skips passwords entirely. Apple does the heavy lifting.

---

## What changes in Mailroom

### Current flow (v0.6)

```
Welcome step 1: name + city + state
        ↓
Welcome step 2: email + password (signup ↔ signin toggle)
        ↓
[home tab]
```

### New flow (v0.7)

```
Welcome auth wall:  [ Continue with Apple ]
                    [ Continue with email ]
                    [ Skip for now ] (local-only mode, dev-friendly)
        ↓
                    (Apple path)             (Email path)
                    Apple sheet              Email input → password (or magic link)
        ↓                                          ↓
Identity step:    "What should we call you?"  →  name + city + state
        ↓
[home tab]
```

The identity step still exists — it's where the user's *display* name and Mail Card details live — but it comes after we have a logged-in session. That means if the user backgrounds the app mid-onboarding, they're already an authenticated user; we just bring them back to "finish your Mail Card" on next launch.

---

## Backend prerequisites (Supabase)

### 1. Enable Sign in with Apple in Supabase Auth

1. <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/auth/providers>
2. Find **Apple** in the list → toggle on
3. Required fields:
   - **Services ID:** `com.mailroom.app.auth` (we'll create this in step 2)
   - **Team ID:** from <https://developer.apple.com/account> → top-right corner
   - **Key ID:** from the .p8 file you'll create in step 2
   - **Private Key (.p8):** paste the contents

Supabase will validate the JWT it gets from Apple against these credentials. If they're wrong, Apple auth silently fails.

### 2. Apple Developer setup for Sign in with Apple

Apple makes you create a separate "Services ID" for native Sign in with Apple, distinct from the app's main bundle ID.

1. <https://developer.apple.com/account/resources/identifiers/list>
2. **App ID** for `com.mailroom.app` → ensure **Sign in with Apple** capability is enabled (you already did this in the App Store Connect doc).
3. Click **`+`** → **Services IDs**
4. Description: `Mailroom Sign in with Apple`
5. Identifier: `com.mailroom.app.auth`
6. Enable **Sign in with Apple** → **Configure**:
   - Primary App ID: `com.mailroom.app`
   - Domains: `nlwnmgwylmmnaemdnzlq.supabase.co`
   - Return URLs: `https://nlwnmgwylmmnaemdnzlq.supabase.co/auth/v1/callback`
7. Save.
8. Create a **Key** for Sign in with Apple:
   - Sidebar → **Keys** → **`+`**
   - Name: `Mailroom Sign in with Apple key`
   - Check **Sign in with Apple** → **Configure** → pick your primary App ID
   - Continue → Register → **Download the .p8 file** (you only get one chance)
   - Note the Key ID shown.

The .p8 contents + the Key ID + your Team ID are what you paste into Supabase in step 1.

### 3. Enable email auth (already done)

The existing `signUpWithEmail` / `signInWithEmail` in `src/services/api.ts` is fine — keep it.

---

## Client install

```bash
cd /Users/scottylefkowitz/Downloads/mailroom-app
npx expo install expo-apple-authentication
```

Then in `app.json`, ensure the plugin is registered:

```json
{
  "expo": {
    "plugins": [
      "expo-apple-authentication"
    ],
    "ios": {
      "usesAppleSignIn": true
    }
  }
}
```

Run `npx expo prebuild --clean` to regenerate the iOS project with the entitlement.

---

## Code changes

### 1. New service: `src/services/apple-auth.ts`

```ts
import * as AppleAuthentication from "expo-apple-authentication";
import { supabase } from "./supabase";

export async function signInWithApple(): Promise<{
  ok: true;
  email: string | null;
  fullName: string | null;
} | { ok: false; error: string }> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      ],
    });

    if (!credential.identityToken) {
      return { ok: false, error: "No identity token from Apple." };
    }

    // Exchange the Apple identity token for a Supabase session.
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
    });

    if (error) return { ok: false, error: error.message };

    // Apple only returns the user's name on the FIRST sign-in. Persist it now.
    const fullName = credential.fullName
      ? [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(" ")
      : null;
    const email = credential.email ?? data.user?.email ?? null;

    return { ok: true, email, fullName };
  } catch (e: any) {
    if (e.code === "ERR_REQUEST_CANCELED") {
      return { ok: false, error: "cancelled" };
    }
    return { ok: false, error: e?.message ?? "Apple sign-in failed." };
  }
}

export async function isAppleSignInAvailable(): Promise<boolean> {
  return await AppleAuthentication.isAvailableAsync();
}
```

### 2. Rewrite `src/components/WelcomeSheet.tsx`

Three steps now: `auth-wall`, `email`, `identity`. Apple path skips the email step entirely.

```ts
type Step = "auth-wall" | "email" | "identity";
```

The auth-wall step has three pressables:
- **Continue with Apple** — black button with Apple logo, only shown if `isAppleSignInAvailable()` is true (iOS 13+ on real device; sim works in iOS 17+).
- **Continue with email** — outlined button → goes to `email` step.
- **Skip for now** — bottom link, goes straight to `identity` step in local-only mode.

The email step is what step 2 currently is (signup ↔ signin toggle + forgot password).

The identity step is what step 1 currently is (name + city + state), BUT the name field auto-fills from Apple's `fullName` if the user came in through Apple. If the user came in through email, we already have `email`; just collect display name + city.

### 3. Wire the Apple path into MailClubContext

Add a method:

```ts
async function signInWithAppleAndProvision(): Promise<{ ok: boolean; error?: string; isNewUser: boolean }> {
  const result = await signInWithApple();
  if (!result.ok) return { ok: false, error: result.error, isNewUser: false };

  // Check if a profile row exists for this user
  const userId = await getCurrentUserId();
  const { data: profile } = await supabase.from("profiles").select("name").eq("id", userId).maybeSingle();
  const isNewUser = !profile || !profile.name;

  // If new, write what Apple gave us. The identity step will fill the rest.
  if (isNewUser && result.fullName) {
    await supabase.from("profiles").update({ name: result.fullName }).eq("id", userId);
  }

  return { ok: true, isNewUser };
}
```

The WelcomeSheet uses the `isNewUser` flag to decide: if true, show the identity step. If false, close the sheet and go to home.

### 4. Visual: the Apple button

Apple has strict HIG rules — black background, white text, the Apple logo, exact font weight. `expo-apple-authentication` ships an `<AppleAuthentication.AppleAuthenticationButton>` component that matches the spec automatically. Use it; don't try to hand-roll the styling.

```tsx
<AppleAuthentication.AppleAuthenticationButton
  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
  cornerRadius={8}
  style={{ width: "100%", height: 48 }}
  onPress={async () => {
    const result = await signInWithAppleAndProvision();
    if (result.ok && result.isNewUser) setStep("identity");
    else if (result.ok) onComplete();
    else setError(result.error ?? "Apple sign-in didn't work.");
  }}
/>
```

---

## Why this is better than what we have

1. **Apple wants this.** Guideline 4.8 says: if you offer third-party login (email-with-password counts), you must also offer Sign in with Apple. We're currently a borderline violation.
2. **Fewer fields up front.** First impression is one screen with two big buttons, not a form. Conversion goes up.
3. **No password to remember.** On Apple's path, the user never types or stores a password. They re-auth with Face ID forever.
4. **Privacy story.** Apple lets users hide their email behind a relay. Some testers love this. Costs us nothing.
5. **Standard pattern.** Cash App, Robinhood, Notion, Threads — every app the user has installed already does this exact layout. Familiarity reduces friction.

---

## Edge cases to handle

- **Apple returns a relay email** (e.g., `xyz123@privaterelay.appleid.com`). Treat this as a real email. Don't try to "fix" it. Some features (like reset password) won't apply because they don't have a password.
- **Apple credential expired after a year of disuse.** Supabase auth refresh handles this; on failure, kick the user back to the auth wall.
- **User cancels the Apple sheet.** The `ERR_REQUEST_CANCELED` code is normal; show no error, do nothing.
- **User signs in with Apple, deletes the account, signs in with Apple again.** Apple's identifier is stable, so they re-link to whatever they had. Make sure our `delete_my_account()` RPC cleans the auth.users row too (it already does — verified in the v0.6 migration).
- **Same person signs in with email once, then Apple another time.** Without account linking, these are two separate users. Out of scope for v0.7; surface as a known limitation in the support docs.

---

## What this is NOT

- **Not magic links.** teteapp uses magic links on the email path; that adds complexity (deep link handling, Supabase email template config, "click this on the same device" UX). Keeping email + password is fine for now.
- **Not Google / GitHub / etc.** Apple is required; everything else is optional. Add later if you see real demand.
- **Not phone / SMS auth.** Twilio integration, OTP UI, SMS costs. Not worth it for the beta.

---

## Order of operations

1. Apple Developer console: create Services ID + Key + .p8 (20 min)
2. Supabase dashboard: enable Apple provider, paste the keys (5 min)
3. `npx expo install expo-apple-authentication` + edit `app.json` + prebuild (10 min)
4. Write `src/services/apple-auth.ts` (the snippet above) — 15 min
5. Rewrite WelcomeSheet from 2-step to 3-step (auth-wall / email / identity) — 1 hr
6. Add `signInWithAppleAndProvision` to MailClubContext — 20 min
7. Update tests: `WelcomeSheet.test.tsx` for the new step machine, mock `expo-apple-authentication` — 30 min
8. Run on sim (Apple sign-in works on iOS 17+ simulators), then on a real device — 20 min
9. Verify a fresh sign-in lands you on identity step, returning sign-in lands on home — 10 min

Total: a focused half-day.

---

## Useful links

- expo-apple-authentication: <https://docs.expo.dev/versions/latest/sdk/apple-authentication/>
- Supabase + Apple guide: <https://supabase.com/docs/guides/auth/social-login/auth-apple>
- Apple HIG for Sign in with Apple: <https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple>
- teteapp reference (your source): <https://github.com/scotty123868/teteapp-main>
