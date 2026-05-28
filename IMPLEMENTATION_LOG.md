# Implementation log. May 11, 2026

Three big things shipped today:

1. **Sign in with Apple** wiring (native sheet → Supabase session)
2. **Lob postcard** wiring (capture → Storage → Edge Function → Lob API)
3. **Stripe payments** replacing Apple IAP (Guideline 3.1.5(a) compliance, ~$1+ more margin per pack)

Plus app rename `Mail Club → Mailroom`, bundle ID landed on `com.mailrooms.app` (since `com.mailroom.app` was taken globally).

---

## ✅ What's wired in code (no action needed)

### Stripe payments (replaces Apple IAP)
- **`@stripe/stripe-react-native` 0.39.0** installed
- **`app.json`**. Stripe plugin block + `merchantIdentifier: merchant.com.mailrooms.app` + `extra.stripePublishableKey` placeholder
- **`app/_layout.tsx`**. `<StripeProvider>` wraps the app root
- **`src/services/payments.ts`**. `purchasePack(pack)` opens the Payment Sheet via `initPaymentSheet` + `presentPaymentSheet`. Returns `{ok, paymentIntentId, creditsAdded}` or `{ok:false, reason}`. Includes `isStripeConfigured()` + `STRIPE_PUBLISHABLE_KEY` constant.
- **`src/components/CreditsSheet.tsx`**. rewritten. Real "Buy" buttons that open the Payment Sheet. Spinner on the busy pack. Friendly alerts on cancel/decline. Auto-refreshes profile balance on success.
- **`src/state/MailClubContext.tsx`**. added `refreshProfile()` action so CreditsSheet can pull the new balance after Stripe webhook lands.
- **`supabase/functions/create-payment-intent/index.ts`**. Deno Edge Function. Verifies caller JWT, finds/creates a Stripe Customer for the user (persists `stripe_customer_id` on `profiles`), creates an ephemeral key + PaymentIntent for the pack amount. Server-side pricing allowlist so clients can't tamper.
- **`supabase/functions/stripe-webhook/index.ts`**. Deno Edge Function. Verifies HMAC signature, handles `payment_intent.succeeded` → credits user (idempotent on `stripe_payment_intent_id`), `charge.refunded` → rollback, `payment_intent.payment_failed` → logged no-op.
- **`supabase/migrations/2026051207_stripe_payments.sql`**. adds `profiles.stripe_customer_id` column, creates `credit_purchases` ledger table with `user_id`/`pack_id`/`credits_added`/`amount_cents`/`stripe_payment_intent_id` (unique)/`refunded` columns, plus `apply_stripe_credit_purchase` + `rollback_stripe_credit_purchase` RPCs.
- **`__tests__/payments.test.ts`**. 4 tests covering ok / cancelled / network failure / declined paths.
- **`__tests__/CreditsSheet.test.tsx`**. updated to assert new Buy buttons + Stripe-not-configured banner.
- **`jest.setup.ts`**. mock for `@stripe/stripe-react-native`.
- Old `src/services/iap.ts` + `__tests__/iap.test.ts` deleted.

### Sign in with Apple
- **`expo-apple-authentication` ~8.0.8** installed
- **`app.json` → `ios.usesAppleSignIn: true`**
- **`src/services/apple-auth.ts`**. `signInWithApple()` opens Apple's native sheet, exchanges identity token for a Supabase session, returns `{ ok, email, fullName, isNewUser }`
- **`src/state/MailClubContext.tsx`**. `signInWithApple` action in context
- **`src/components/WelcomeSheet.tsx`**. "Continue with Apple" button at top of account step (mode-aware: SIGN_IN vs CONTINUE), with `OR` divider below. Auto-hides when `isAvailableAsync()` returns false (no iCloud).
- **`jest.setup.ts`**. `expo-apple-authentication` mock

### Lob postcard wiring
- **`react-native-view-shot` 4.0.3** installed
- **`src/services/lob.ts`**. `capturePostcardForPrint(frontRef, backRef)` captures both sides as 1875×1250 PNGs, `submitToLob(input)` uploads to Storage + invokes the Edge Function
- **`supabase/functions/lob-send-postcard/index.ts`**. Deno Edge Function: loads postcard + recipient + sender from DB, POSTs to Lob's `/v1/postcards`, persists `lob_id`/`lob_status`/`lob_expected_delivery`/`lob_error` back
- **`supabase/migrations/2026051205_lob_integration.sql`**. adds Lob columns to postcards + address columns to friends/profiles
- **`supabase/migrations/2026051206_lob_postcards_trigger.sql`**. postgres trigger fires the Edge Function on postcard insert (only when friend has full address)
- **`PostcardFrontPreview` + `PostcardBackPreview`** rewritten: `forwardRef<View>` for capture, drop shadow + paper grain, real perforated stamp with Mailroom dove, postmark at -8° tilt
- **`src/components/AddFriendSheet.tsx`** rewritten with collapsible "Mailing address" section + validation + auto-populate

### Rename Mail Club → Mailroom (and bundle ID fix)
- Bundle ID: `com.mailclub.app` → `com.mailroom.app` → `com.mailrooms.app` (final. `com.mailroom.app` was taken globally on Apple's side)
- Slug, scheme, name in `app.json`
- AsyncStorage cache key
- All visible strings in app

---

## ⚠️ What you need to do manually

### Stripe. for the credit store to actually work

Full walkthrough in **`STRIPE_SETUP.md`**. TL;DR:

1. **Sign up** at <https://dashboard.stripe.com/register> (no card needed for test mode)
2. **Grab keys** from <https://dashboard.stripe.com/test/apikeys>:
   - Publishable key (`pk_test_...`)
   - Secret key (`sk_test_...`)
3. **Drop publishable key into `app.json`** → `extra.stripePublishableKey`
4. **Set Supabase secrets**:
   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_test_xxxxx
   supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
   ```
5. **Push migration** (only adds the new file. others are no-ops):
   ```bash
   supabase db push
   ```
6. **Deploy Edge Functions**:
   ```bash
   supabase functions deploy create-payment-intent
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
7. **Register webhook** at <https://dashboard.stripe.com/test/webhooks/create>:
   - URL: `https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/stripe-webhook`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
   - Copy the signing secret (`whsec_...`):
     ```bash
     supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxx
     ```
8. **Test** with card `4242 4242 4242 4242` (any future expiry, any CVC, any zip)

### Sign in with Apple. for the "Continue with Apple" button to actually work

Full walkthrough in **`ASC_NEW_APP.md` §2**. TL;DR:

1. **Apple Developer Console** ↳ App IDs ↳ `com.mailrooms.app` ↳ check Sign in with Apple capability ↳ **"Enable as a primary App ID"** (critical. don't pick "Group with")
2. **Services ID** `com.mailrooms.app.auth` ↳ Configure ↳ Primary App ID = `com.mailrooms.app` ↳ Domain = `nlwnmgwylmmnaemdnzlq.supabase.co` ↳ Return URL = `https://nlwnmgwylmmnaemdnzlq.supabase.co/auth/v1/callback`
3. **Key** `Mailroom Sign in with Apple key` ↳ pick Primary App ID `com.mailrooms.app` ↳ download .p8 (one chance) ↳ note Key ID
4. **Supabase Dashboard** ↳ Auth ↳ Providers ↳ Apple ↳ paste Services ID + Team ID (top-right of Apple Dev account) + Key ID + .p8 contents

### Lob. for postcards to actually mail

Full walkthrough in **`LOB_QUICKSTART.md`**. TL;DR:

1. **Grab Test Secret Key** at <https://dashboard.lob.com/settings/api-keys> (the row labeled "Test Environment", value starts with `test_`)
2. `supabase secrets set LOB_API_KEY=test_xxxxx`
3. Migrations already pushed. done
4. **Create `postcard-renders` Storage bucket** at <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/storage/buckets> (Public, 10 MB, image/png + image/jpeg). Apply RLS policies from migration comments.
5. **Deploy** `supabase functions deploy lob-send-postcard --no-verify-jwt`
6. **Send test postcard** to yourself in app → verify it appears in <https://dashboard.lob.com/postcards>

---

## 📁 Files added this session

```
src/services/lob.ts                                       (new)
src/services/apple-auth.ts                                (new)
src/services/payments.ts                                  (new. replaces iap.ts)
src/components/PostcardPreview.tsx                        (rewritten)
supabase/functions/lob-send-postcard/index.ts             (new)
supabase/functions/create-payment-intent/index.ts         (new)
supabase/functions/stripe-webhook/index.ts                (new)
supabase/migrations/2026051205_lob_integration.sql        (new)
supabase/migrations/2026051206_lob_postcards_trigger.sql  (new)
supabase/migrations/2026051207_stripe_payments.sql        (new)
__tests__/payments.test.ts                                (new. replaces iap.test.ts)
STRIPE_SETUP.md                                            (new)
ASC_NEW_APP.md                                             (rewritten. was IAP-focused)
LOB_QUICKSTART.md                                          (new)
SEND_FLOW_AUDIT.md                                         (new)
IMPLEMENTATION_LOG.md                                      (this file)
```

## 📁 Files modified

```
app.json                                                  (bundle ID com.mailrooms.app, Stripe plugin, usesAppleSignIn, stripePublishableKey)
package.json                                              (+ @stripe/stripe-react-native, + expo-apple-authentication, + react-native-view-shot)
app/_layout.tsx                                           (+ <StripeProvider> wrapper)
src/state/MailClubContext.tsx                             (+ signInWithApple, + refreshProfile actions)
src/components/WelcomeSheet.tsx                           (+ Continue with Apple button)
src/components/AddFriendSheet.tsx                         (+ collapsible mailing-address section)
src/components/CreditsSheet.tsx                           (rewritten. real Stripe Buy flow)
src/data/credits.ts                                       (pricing: $5/$10/$20/$35)
src/services/api.ts                                       (+ AddFriendInput, address columns on friend rows)
src/types/mail.ts                                         (+ FriendAddressInput type)
jest.setup.ts                                             (+ mocks for Stripe, view-shot, apple-auth)
tsconfig.json                                             (+ exclude supabase/functions from RN typecheck)
```

## 📁 Files deleted

```
src/services/iap.ts                                       (replaced by payments.ts)
__tests__/iap.test.ts                                     (replaced by payments.test.ts)
```

---

## ✅ Validation

- **`npx tsc --noEmit`**. clean
- **`npx jest`**. **216 / 216 passing**
- **Native iOS rebuilt** via `npx expo prebuild --clean` + `pod install`
- **`npm install @stripe/stripe-react-native`**. clean
- **Stripe SDK**. installed at v0.39.0
- **Sign in with Apple button**. auto-hides when `isAvailableAsync()` returns false (sim without iCloud). Correct behavior. verify visually on real device.
- **Stripe Payment Sheet**. gated behind `isStripeConfigured()` check; CreditsSheet shows a "Stripe not configured" banner when `stripePublishableKey` is empty.

---

## 🎯 What to do next

1. **You:** Stripe signup + drop keys in (~10 min, follows STRIPE_SETUP.md)
2. **You:** Fix the Apple App ID Primary-vs-Grouped issue (3 min, see ASC_NEW_APP.md §1)
3. **You:** Paste Apple OAuth fields into Supabase Apple provider (2 min)
4. **You:** Send yourself a test postcard via Lob (5 min, validates the whole pipeline end-to-end)
5. **You:** Send yourself a test Stripe purchase with card `4242 4242 4242 4242` (5 min)
6. **You:** Flip to TestFlight build (`eas build --platform ios --profile production && eas submit`)
7. **Me when you're ready:** lob-webhook Edge Function for "card delivered" notifications, send-screen integration of `submitToLob()` after RPC succeeds, server-side postcard rendering (puppeteer in Edge Function) so the trigger doesn't depend on the client.

---

## Why Stripe, not Apple IAP

Apple Guideline **3.1.5(a)** requires non-IAP for physical goods. The 2024 update to 3.1.1 explicitly carves out physical gift cards. Mailroom credits = redeem for physical postcards mailed via USPS through Lob. That's textbook physical-goods. TouchNote, Felt, Postagram have shipped this exact model on the App Store using Stripe for 10+ years.

Math at $5 pack:
| Path | Net to you |
|------|-----------|
| IAP minus 30% | $3.50 (loses money after Lob $0.65 + USPS $0.27) |
| IAP minus 15% (Small Business Program) | $4.25 (thin) |
| **Stripe minus 2.9% + $0.30** | **$4.555 (workable)** |

Stripe saves $1.05+ per pack and lets us actually run the business.

For App Store review submission, include in the Notes field: *"Mailroom sells credit packs redeemed for physical postcards mailed via USPS through Lob. Per Guideline 3.1.5(a), purchases use Stripe. same approach as TouchNote (308955085), Felt (1188856465), Postagram (410985556)."*
