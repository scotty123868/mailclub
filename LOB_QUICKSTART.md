# Lob quickstart. your step-by-step

This is the shortest path from "Mailroom code is wired" to "tapping Send actually puts a postcard in someone's mailbox." Every step has the direct link.

> **Time:** ~25 minutes total for sandbox setup. You can start mailing real postcards another ~5 min after.
>
> **Cost:** $0 for test mode. ~$0.65/card in live mode.

---

## 0. What you have already (no action needed)

- ✅ `react-native-view-shot` installed for capturing postcard PNGs
- ✅ `src/services/lob.ts`. uploads + invokes Edge Function
- ✅ `src/components/PostcardPreview.tsx`. renders front + back at print scale
- ✅ `supabase/functions/lob-send-postcard/index.ts`. Edge Function that calls Lob
- ✅ `supabase/migrations/2026051205_lob_integration.sql`. schema for `lob_id`, `lob_status`, friend address fields
- ✅ `supabase/migrations/2026051206_lob_postcards_trigger.sql`. postgres trigger that auto-fires the Edge Function on insert
- ✅ AddFriendSheet now collects street + apt + city + state + zip when expanded

You just need to: get a Lob key, deploy the function, create the bucket.

---

## 1. Sign up at Lob (5 min)

**Direct link:** <https://dashboard.lob.com/signup>

- Sign up with your email. no credit card needed for sandbox
- Confirm via email
- You land in the Lob dashboard. Top-right corner has a **Test / Live** toggle. **leave it on Test**

---

## 2. Grab your Test API key (1 min)

**Direct link:** <https://dashboard.lob.com/settings/api-keys>

You'll see four keys:
- **Test Publishable** (`test_pub_...`). for client-side JS, we don't use it
- **Test Secret** (`test_...`). **this is the one we need**
- Live keys are greyed out until you add a payment method

Click the eye icon next to **Test Secret** and copy the key. Looks like:
```
test_abc123def456ghi789jklm0nop1qrst
```

---

## 3. Apply the database migrations (2 min)

The Lob schema changes haven't been pushed to your Supabase project yet. Run:

```bash
cd /Users/scottylefkowitz/Downloads/mailclub-app/supabase
supabase login                             # one-time, if not already logged in
supabase link --project-ref nlwnmgwylmmnaemdnzlq
supabase db push
```

This pushes:
- `2026051205_lob_integration.sql`. adds `lob_id`, `lob_status`, `lob_expected_delivery`, `lob_error` columns to `postcards`; adds address columns to `friends`
- `2026051206_lob_postcards_trigger.sql`. adds the auto-submit trigger

Expected output:
```
Connecting to remote database...
Applying migration 2026051205_lob_integration.sql ✓
Applying migration 2026051206_lob_postcards_trigger.sql ✓
```

If you don't have the Supabase CLI:
```bash
brew install supabase/tap/supabase
```

---

## 4. Set up the postgres-trigger settings (2 min)

The trigger needs to know the Functions URL and your service-role key. Run this in the Supabase SQL editor:

**Direct link:** <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/sql/new>

```sql
-- Replace the second line with your actual service_role key
-- (Settings → API → service_role secret)
ALTER DATABASE postgres SET app.settings.functions_url
  = 'https://nlwnmgwylmmnaemdnzlq.functions.supabase.co';
ALTER DATABASE postgres SET app.settings.functions_service_role_key
  = 'YOUR_SERVICE_ROLE_KEY_HERE';
```

To find your service role key:

**Direct link:** <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/settings/api>

Scroll to **Project API keys** → **service_role** → click reveal → copy.

> Why this is fine: this key never leaves your Supabase database. The trigger uses it server-side to authenticate to the Edge Function. It's not exposed to clients.

---

## 5. Create the `postcard-renders` Storage bucket (3 min)

**Direct link:** <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/storage/buckets>

1. Click **New bucket** (top-right)
2. Name: `postcard-renders`
3. Public bucket: **YES** (Lob's servers need to fetch the URLs. see explanation below)
4. File size limit: `10 MB`
5. Allowed MIME types: `image/png, image/jpeg`
6. **Save**

> **Public vs private trade-off:** Lob fetches the front/back PNGs by URL. With a public bucket, any HTTP client can fetch any rendered postcard if they know the URL. The URLs include the user ID + a postcard UUID, so it's not guessable, but it's not cryptographically private either. For TestFlight beta this is fine. For public App Store launch, switch to private bucket + signed URLs with 1-hour TTL (the lob.ts service already supports this. just swap `getPublicUrl` for `createSignedUrl(path, 3600)`).

Then apply the RLS policies. Same SQL editor:

```sql
create policy "users read their own renders"
  on storage.objects for select using (
    bucket_id = 'postcard-renders'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users insert their own renders"
  on storage.objects for insert with check (
    bucket_id = 'postcard-renders'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users update their own renders"
  on storage.objects for update using (
    bucket_id = 'postcard-renders'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

---

## 6. Set the Lob API key as a Supabase secret (1 min)

```bash
cd /Users/scottylefkowitz/Downloads/mailclub-app
supabase secrets set LOB_API_KEY=test_abc123def456ghi789jklm0nop1qrst
```

Verify:
```bash
supabase secrets list
```

You should see `LOB_API_KEY` in the list (value is masked).

---

## 7. Deploy the Edge Function (2 min)

```bash
supabase functions deploy lob-send-postcard --no-verify-jwt
```

The `--no-verify-jwt` flag is because we're calling this from the postgres trigger using the service-role bearer token, not a user JWT. Without that flag, the function rejects.

Expected output:
```
Deploying function lob-send-postcard (project_ref nlwnmgwylmmnaemdnzlq)...
Successfully deployed!
You can invoke it at: https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/lob-send-postcard
```

---

## 8. Test the end-to-end flow (5 min)

This is the moment of truth. does a tap on Send actually produce a postcard in Lob's dashboard?

1. In the Mailroom app, **add yourself as a friend** via Friends → Add. Use your real mailing address.
2. Go to **Send** → pick **Note** category → write any test message → pick yourself as recipient → tap **Send**.
3. Open the Lob dashboard:

**Direct link:** <https://dashboard.lob.com/postcards>

Within ~10 seconds you should see a new postcard appear with:
- Description: `Mailroom postcard <id>`
- To: your name + address
- Status: `processed` (rendered to PDF, not actually mailed in test mode)

Click the postcard to see the rendered PDF preview. **This is what would print in live mode.** Critique the layout, fonts, alignment.

If you see:
- ✅ A postcard with your message + name in the rendered PDF. **the entire pipeline works**
- ❌ "Test card declined: invalid front_url". bucket isn't public or the URL was empty (the trigger fires with empty URLs in v1 because the client renders + uploads first; see Known Limitation below)
- ❌ Nothing appearing in Lob. check Supabase Functions logs: <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/functions>

---

## 9. Set up the Lob webhook for delivery status (3 min)

This lets you push a "Card delivered!" notification when Lob marks the card delivered by USPS.

**Direct link:** <https://dashboard.lob.com/settings/webhooks>

1. Click **Add Endpoint**
2. URL: `https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/lob-webhook`
3. Events: check **all** events under "Postcards" (`postcard.created`, `postcard.rendered_pdf`, `postcard.in_transit`, `postcard.in_local_area`, `postcard.processed_for_delivery`, `postcard.delivered`, `postcard.re_routed`, `postcard.returned_to_sender`, `postcard.failed`)
4. **Save**
5. Copy the **Webhook Signing Secret** that appears. Lob signs every event with it.
6. `supabase secrets set LOB_WEBHOOK_SECRET=<the_secret>`

> Note: the `lob-webhook` Edge Function isn't written yet. I have a stub planned in `LOB_INTEGRATION.md` §5.6. Tell me when you want me to build it (~30 min); it just verifies the HMAC signature and updates `lob_status` on the matching postcard row.

---

## 10. Flip to live mode (when you're ready)

After you've test-mailed yourself 3-5 cards and verified the print quality looks right:

1. **Add a payment method** in the Lob dashboard:

   **Direct link:** <https://dashboard.lob.com/settings/billing>

   Add a credit card. Lob charges per-card (~$0.65 for 4×6 with USPS first-class postage).

2. **Set a budget alert** to catch surprises:

   **Direct link:** <https://dashboard.lob.com/settings/billing/budget>

   Recommended: $50/month budget, alert at 50% and 90%.

3. **Get your Live Secret Key** from the same API Keys page.

4. **Update the Supabase secret:**
   ```bash
   supabase secrets set LOB_API_KEY=live_xxxxxxxx
   ```

5. **Send one real card to yourself first.** Wait 5-8 business days. **Look at the actual physical card.** Don't go further until you've confirmed print quality on real paper.

---

## Known limitation in v1

The postgres trigger fires with **empty `front_url` and `back_url`** because the rendering happens on the client (via `react-native-view-shot`), not server-side. Two options to make end-to-end auto-submit work:

**A) Client-side render-then-trigger (current state):** App captures the preview to PNG → uploads to Storage → invokes the Edge Function with both URLs. The trigger is a no-op safety net for retries.

**B) Server-side render via headless browser:** Move the postcard rendering out of React Native into the Edge Function, using `puppeteer` + the same React components as the in-app preview. ~4 hours of additional work. Better long-term because it works even if the user closes the app mid-send.

For TestFlight beta we ship Option A. The client capture path is already wired in `src/services/lob.ts → submitToLob()`. **What's left to do on my side:** add an off-screen `<View>` in the Send screen that renders the postcard at 1875×1250, captures via `captureRef`, then calls `submitToLob`. About 1 hour. Tell me when you want it.

---

## Useful links

- Lob dashboard home: <https://dashboard.lob.com>
- Lob Postcards API reference: <https://docs.lob.com/#tag/Postcards>
- Lob template gallery: <https://lob.com/resources/postcard-templates>
- Lob status page: <https://status.lob.com>
- Supabase project: <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq>
- Supabase functions: <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/functions>
- Supabase logs: <https://supabase.com/dashboard/project/nlwnmgwylmmnaemdnzlq/logs/explorer>
