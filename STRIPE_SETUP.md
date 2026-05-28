# Stripe setup. step-by-step

This replaces Apple IAP for credit pack purchases. We use Stripe because Mailroom sells physical mail. Apple Guideline 3.1.5(a) requires non-IAP for physical goods; the 2024 update to 3.1.1 explicitly carves out physical gift cards. Precedent: TouchNote, Felt, Postagram do this exact model on the App Store.

> **Time:** ~25 minutes for sandbox setup. ~5 more minutes to flip live.
>
> **Cost in test mode:** $0. **Cost in live mode:** 2.9% + $0.30 per successful transaction. No monthly fee.

---

## 0. What's already wired (no action needed)

- ✅ `@stripe/stripe-react-native` added to package.json
- ✅ `<StripeProvider>` wraps the app root in `app/_layout.tsx`
- ✅ `src/services/payments.ts`. `purchasePack(pack)` opens the Payment Sheet
- ✅ `src/components/CreditsSheet.tsx`. tap a pack → buy → credits refresh
- ✅ `supabase/functions/create-payment-intent/index.ts`. creates the PaymentIntent
- ✅ `supabase/functions/stripe-webhook/index.ts`. handles success + refunds
- ✅ `supabase/migrations/2026051207_stripe_payments.sql`. `credit_purchases` ledger + `apply_stripe_credit_purchase` RPC

You just need to: get Stripe keys, push the migration, deploy 2 Edge Functions, set 2 secrets, register a webhook.

---

## 1. Sign up at Stripe (3 min)

**Direct link:** <https://dashboard.stripe.com/register>

- Sign up with your email. No card required for test mode.
- Skip the "activate your account" prompt for now (that's needed only for live payments).
- You land in the Stripe dashboard. Top-right corner has a **Test mode** toggle. **Leave it on.**

---

## 2. Grab your API keys (1 min)

**Direct link:** <https://dashboard.stripe.com/test/apikeys>

You'll see two keys:
- **Publishable key** (`pk_test_...`). safe to ship in the app bundle
- **Secret key** (`sk_test_...`). server-side only, NEVER ship in the app

Copy both. Note that the secret key is shown once. If you lose it, click "Roll key."

---

## 3. Drop the publishable key into app.json (30 sec)

Open `app.json`, find `extra.stripePublishableKey`, paste:

```json
"extra": {
  "supabaseUrl": "...",
  "supabaseAnonKey": "...",
  "stripePublishableKey": "pk_test_xxxxx"
}
```

Rebuild the app (Expo dev client) so the new env is picked up:

```bash
cd /Users/scottylefkowitz/Downloads/mailclub-app
npx expo prebuild --clean
npx expo run:ios
```

The "Stripe not configured" banner in CreditsSheet will disappear once this is set.

---

## 4. Push the new migration (1 min)

```bash
cd /Users/scottylefkowitz/Downloads/mailclub-app
supabase db push
```

This applies `2026051207_stripe_payments.sql`:
- Adds `stripe_customer_id` to `profiles`
- Creates `credit_purchases` ledger table (one row per successful purchase)
- Adds `apply_stripe_credit_purchase` RPC (idempotent on payment_intent_id)
- Adds `rollback_stripe_credit_purchase` RPC (for refunds)

Expected output:
```
Applying migration 2026051207_stripe_payments.sql ✓
```

---

## 5. Set Stripe secrets on Supabase (1 min)

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxxxx
supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
```

Verify with:
```bash
supabase secrets list
```

You should see both `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` (values masked). The webhook secret comes next in step 7.

---

## 6. Deploy the create-payment-intent Edge Function (1 min)

```bash
supabase functions deploy create-payment-intent
```

(No `--no-verify-jwt` here. the function expects a Supabase Auth JWT in the Authorization header. The mobile app sends it automatically via `supabase.functions.invoke()`.)

Expected:
```
Deploying function create-payment-intent (project_ref nlwnmgwylmmnaemdnzlq)...
Successfully deployed!
You can invoke it at: https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/create-payment-intent
```

---

## 7. Register the Stripe webhook + deploy the handler (5 min)

The webhook is how Stripe tells your server "payment succeeded, credit the user." Without it, the user's credits don't update.

### 7a. Deploy the handler

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

The `--no-verify-jwt` flag is required. Stripe doesn't send a Supabase JWT, it sends a Stripe HMAC signature instead (the function verifies that signature itself).

### 7b. Register the endpoint with Stripe

**Direct link:** <https://dashboard.stripe.com/test/webhooks/create>

1. **Endpoint URL:** `https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/stripe-webhook`
2. **API version:** leave on "Latest API version"
3. **Events to send:** click "Select events" → check:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
4. Click **Add endpoint**

You're shown a **Signing secret** that starts with `whsec_`. Click **Reveal** and copy.

### 7c. Add the webhook secret to Supabase

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

---

## 8. Test the end-to-end flow (5 min)

This is the moment of truth.

1. In the Mailroom app, sign in to your account
2. Open the credits sheet (tap the credit balance somewhere)
3. Tap **Buy** on the $5 pack
4. The Stripe Payment Sheet opens with Apple Pay + card option
5. Use test card: **`4242 4242 4242 4242`** / any future expiry / any CVC / any zip
6. Tap **Pay**
7. Sheet closes → "You're in!" alert → credits balance goes up by 5

Check the data flowed:

**Stripe dashboard:** <https://dashboard.stripe.com/test/payments>
- New payment for $5.00 with description "Mailroom. 5 credits"

**Supabase database:** <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/editor>
- Open the `credit_purchases` table. one new row with your user_id, pack_id=`p5`, credits_added=5, amount_cents=500
- Open `profiles`. your row has `stripe_customer_id` filled in and `credits` bumped by 5

**Stripe webhook logs:** <https://dashboard.stripe.com/test/webhooks>
- Click your endpoint → recent deliveries → 200 OK for `payment_intent.succeeded`

If any of those don't show: see "Debugging" below.

---

## 9. Test failure modes (5 min, optional but recommended)

Real users will hit these. Make sure your app handles them gracefully.

| Test card | What it does |
|-----------|--------------|
| `4000 0000 0000 0002` | Generic decline |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0341` | Card attached to a customer, but charge fails later |
| `4000 0027 6000 3184` | 3D Secure auth required |

Test each one. Each should produce a friendly error in the app, no credits granted, no `credit_purchases` row, the failed PI visible in the Stripe dashboard.

---

## 10. Flip to live mode (when you're ready)

After you've test-purchased 3-5 times and the data lines up:

### 10a. Activate the Stripe account

**Direct link:** <https://dashboard.stripe.com/account/onboarding>

You'll need:
- Business name + address (LLC / sole prop / etc.)
- EIN or SSN
- Bank account for payouts (Stripe payouts arrive in ~2-7 business days, every day after that)

### 10b. Get live keys

**Direct link:** <https://dashboard.stripe.com/apikeys> (note: no `/test/`)

Copy `pk_live_...` and `sk_live_...`.

### 10c. Update everything to live

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxxxx
supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
```

Update `app.json` → `extra.stripePublishableKey = "pk_live_xxxxx"`.

### 10d. Re-register the webhook in live mode

**Direct link:** <https://dashboard.stripe.com/webhooks/create> (no `/test/`)

Same URL, same events. Copy the new `whsec_...` signing secret.

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

### 10e. Send yourself a $5 real purchase to verify

Use a real card. Refund yourself in the Stripe dashboard once you've confirmed the credits landed.

---

## Why Stripe, not Apple IAP

Apple's own guidelines say non-IAP is mandatory for physical goods.

> **3.1.5(a):** "Physical Goods and Services Outside of the App: If your app enables people to purchase goods or services that will be consumed outside of the app, you must use purchase methods other than IAP."

> **3.1.1 (2024 update):** "Physical gift cards that are sold within an app and then mailed to customers may use payment methods other than in-app purchase."

Mailroom sells credit packs that are redeemed for postcards mailed via USPS through Lob. That's textbook physical-goods. Direct precedent: TouchNote, Felt, Postagram have shipped this exact model on the App Store using Stripe (not IAP) for 10+ years.

Math comparison at $5 pack:
- IAP minus 30%: net $3.50 (loses money after Lob's $0.65 print + $0.27 USPS)
- IAP minus 15% (Small Business Program): net $4.25 (thin)
- Stripe minus 2.9% + $0.30: net $4.555 (workable)

Stripe saves $1.05+ per pack and lets us actually run the business.

---

## Debugging

**Edge Function logs:** <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/functions>

Click into `create-payment-intent` or `stripe-webhook` → Logs tab. Every invocation prints request + response + console output.

**Stripe events log:** <https://dashboard.stripe.com/test/events>

Every API call + webhook delivery is here, with full request/response payloads.

**Common issues:**
- `Stripe not configured` banner stays after setting `stripePublishableKey` → you didn't rebuild the native app. Run `npx expo prebuild --clean && npx expo run:ios`.
- 401 on `create-payment-intent` → user isn't signed in, or the auth header isn't being sent. Check `supabase.auth.getSession()` returns a session.
- Webhook returns 400 "Signature verification failed" → wrong `STRIPE_WEBHOOK_SECRET` env var. Re-copy from the Stripe webhook page.
- PaymentIntent succeeds but credits don't update → check the webhook delivery in Stripe dashboard. If 200 OK but credits still wrong, check the `credit_purchases` table. if no row, the RPC errored. Check function logs.

---

## Useful links

- Stripe Dashboard: <https://dashboard.stripe.com>
- Stripe API keys (test): <https://dashboard.stripe.com/test/apikeys>
- Stripe Webhooks (test): <https://dashboard.stripe.com/test/webhooks>
- Stripe Payments log (test): <https://dashboard.stripe.com/test/payments>
- Stripe Events log (test): <https://dashboard.stripe.com/test/events>
- Stripe React Native docs: <https://docs.stripe.com/payments/accept-a-payment?platform=react-native>
- Supabase Functions dashboard: <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/functions>
- Apple Guideline 3.1.5: <https://developer.apple.com/app-store/review/guidelines/#payments>
- TouchNote (precedent): <https://touchnote.com>
