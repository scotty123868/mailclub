# Lob. printing & mailing real postcards

This doc walks you through wiring **Mailroom** to [Lob](https://lob.com) so that tapping **Send** in the app produces a real, physical postcard in someone's mailbox a few days later. The screenshot you sent (the "Available Promotions" page) is one tab inside Lob's dashboard. it's not where we'll spend most of our time. We'll start at the top.

> **TestFlight scope:** For TestFlight (your current target), we **don't actually need to mail anything yet**. Beta testers will see the success modal that says "sits in the queue until our printing partner is live." This doc is the path to flip that switch when you're ready. You can do steps 0-3 (account + sandbox) in 30 minutes and that's enough to dev/test the integration end to end without spending money or mailing real cards.

---

## 0. Lob pricing & how the product works

Before you sign up, the shape of the deal:

- **Pricing model:** per-card, no monthly minimum on the lowest tier. Postcards run **~$0.65–$1.10** depending on size and quantity (4×6, 6×9, 6×11). USPS postage is included in that price.
- **You pay Lob.** Lob handles the print, the postage, the actual mailing. You don't deal with the post office.
- **Sandbox vs Live mode.** Lob gives you two sets of API keys. Sandbox keys → fake "mailed" responses, no real postcards, no cost. Live keys → real cards, real money. We'll keep the app pinned to **sandbox** until you're ready.
- **Delivery:** 4–8 business days domestic, USPS First-Class.

The "Available Promotions" tab you screenshotted is for opt-in marketing programs (Informed Delivery campaigns, sustainable-paper certifications, tactile-engagement programs). **Ignore it for now.** We're using Lob's plain Postcards API.

---

## 1. Create the Lob account

1. Go to <https://dashboard.lob.com/signup>
2. Sign up with your email. They'll send a verification link.
3. After verification, you land in the dashboard. Lob defaults you into **Test mode**. the toggle is in the top-right of the dashboard. Leave it on Test for now. (Live mode is gated until you add a payment method.)

---

## 2. Grab the API keys

1. Dashboard sidebar → **API Requests** → **API Keys** (or directly: <https://dashboard.lob.com/settings/api-keys>)
2. You'll see two pairs:
   - **Test Publishable Key**. starts with `test_pub_`
   - **Test Secret Key**. starts with `test_`
   - **Live Publishable Key**. starts with `live_pub_`
   - **Live Secret Key**. starts with `live_` (only after you add billing)
3. Copy the **Test Secret Key**. This is what our server-side code will use.

> **Never commit Lob secret keys.** Put them in Supabase Edge Function environment variables, not in `app.json`.

---

## 3. Where Lob plugs into our existing architecture

Mailroom already has the right shape for this. Here's what's there:

```
[App: send.tsx]
    ↓ tapSend()
[MailClubContext.sendPostcard()]
    ↓ optimistic update + Supabase RPC call
[Supabase RPC: send_postcard(...)]
    ↓ writes postcards row, deducts credits server-side
    ↓ returns { ok: true, postcard_id }
[?? gap ??]                          ← Lob goes here
    ↓ (eventually)
[Lob Postcards API]
    ↓
[USPS]
    ↓
[Friend's mailbox]
```

The gap is the Lob call. We have **two** good places to put it:

### Option A. Supabase Edge Function (recommended)

After `send_postcard` writes the row, a Postgres trigger or queue job invokes a Supabase Edge Function. The function reads the postcard row, calls Lob, stores the returned Lob ID + status on the postcard row. This is the right long-term shape because:
- Secrets stay server-side. The app never sees the Lob key.
- We can retry on failure without involving the client.
- We can rate-limit, debounce, sanity-check addresses.

### Option B. Direct from the app

The app calls Lob's API directly. Faster to wire, simpler to debug. But:
- Lob key has to ship to the device (security risk if extracted).
- Failures don't retry without user action.
- We'd need to handle idempotency client-side.

**Verdict:** go with A. It's not that much harder and it's the only path that survives App Store review for the Live mode keys.

---

## 4. The Lob API call we need

This is the actual HTTP request our Edge Function will make. Lob expects multipart form data for image-carrying requests, or JSON when both sides are URL references.

```bash
curl -X POST https://api.lob.com/v1/postcards \
  -u "test_xxxxxxxxxxxxxxxxx:" \
  -d "description=Mailroom card abc-123" \
  -d "to[name]=Maya Ramirez" \
  -d "to[address_line1]=123 Main St" \
  -d "to[address_city]=Brooklyn" \
  -d "to[address_state]=NY" \
  -d "to[address_zip]=11201" \
  -d "to[address_country]=US" \
  -d "from[name]=Scotty Lefkowitz" \
  -d "from[address_line1]=456 Oak Ave" \
  -d "from[address_city]=Denver" \
  -d "from[address_state]=CO" \
  -d "from[address_zip]=80202" \
  -d "from[address_country]=US" \
  -d "front=https://your-public-url/front-abc-123.png" \
  -d "back=https://your-public-url/back-abc-123.png" \
  -d "size=4x6"
```

A few notes:
- `front` and `back` can be public URLs (PNG/JPG/PDF) OR HTML strings OR file uploads. Public URLs is the easiest path. we already have signed Supabase Storage URLs.
- `size`: `4x6` (small, ~$0.65), `6x9` (medium), `6x11` (large). Start with `4x6`.
- The response includes `id` (Lob's postcard ID) and `expected_delivery_date`.

---

## 5. The plumbing changes we need

Here's the diff you'd make to ship this, in order:

### 5.1 Add a Lob ID column on `postcards`

```sql
-- supabase/migrations/2026051204_lob_integration.sql
alter table public.postcards
  add column lob_id text,
  add column lob_status text check (lob_status in ('queued','rendered','in_transit','delivered','failed')),
  add column lob_expected_delivery date,
  add column lob_error text;

create index on public.postcards (lob_status);
```

### 5.2 Create the Edge Function

```bash
cd /Users/scottylefkowitz/Downloads/mailroom-app/supabase
supabase functions new lob-send-postcard
```

That scaffolds `supabase/functions/lob-send-postcard/index.ts`. The function:
1. Authenticates via the service-role JWT.
2. Reads the postcard row by ID.
3. Resolves friend's mailing address from `friends` table.
4. Resolves the user's return address from `profiles`.
5. Calls Lob.
6. Writes `lob_id`, `lob_status='queued'`, `lob_expected_delivery` back to the row.
7. On failure, writes `lob_error` and leaves `lob_status=null` so we can retry.

Skeleton:

```ts
// supabase/functions/lob-send-postcard/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOB_API = "https://api.lob.com/v1/postcards";

serve(async (req) => {
  const { postcard_id } = await req.json();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Load the postcard + recipient + sender
  const { data: postcard } = await supabase
    .from("postcards")
    .select("*, friend:friends(*), sender:profiles!sender_id(*)")
    .eq("id", postcard_id)
    .single();
  if (!postcard) return new Response("not found", { status: 404 });

  // 2. Build front/back image URLs
  const frontUrl = await renderFrontUrl(postcard);  // photo or template
  const backUrl  = await renderBackUrl(postcard);   // handwritten message

  // 3. POST to Lob
  const body = new URLSearchParams({
    description: `Mailroom ${postcard.id}`,
    "to[name]": postcard.friend.name,
    "to[address_line1]": postcard.friend.address_line1,
    "to[address_city]": postcard.friend.address_city,
    "to[address_state]": postcard.friend.address_state,
    "to[address_zip]": postcard.friend.address_zip,
    "to[address_country]": "US",
    "from[name]": postcard.sender.name,
    "from[address_line1]": postcard.sender.address_line1 ?? "",
    "from[address_city]": postcard.sender.address_city ?? "",
    "from[address_state]": postcard.sender.address_state ?? "",
    "from[address_zip]": postcard.sender.address_zip ?? "",
    "from[address_country]": "US",
    front: frontUrl,
    back: backUrl,
    size: "4x6",
  });

  const auth = btoa(Deno.env.get("LOB_API_KEY")! + ":");
  const resp = await fetch(LOB_API, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await resp.json();

  // 4. Persist Lob's response
  if (resp.ok) {
    await supabase.from("postcards").update({
      lob_id: json.id,
      lob_status: "queued",
      lob_expected_delivery: json.expected_delivery_date,
    }).eq("id", postcard.id);
    return new Response(JSON.stringify({ ok: true, lob_id: json.id }), { status: 200 });
  } else {
    await supabase.from("postcards").update({
      lob_error: json.error?.message ?? "unknown",
    }).eq("id", postcard.id);
    return new Response(JSON.stringify({ ok: false, error: json.error }), { status: 500 });
  }
});

async function renderFrontUrl(postcard: any): Promise<string> {
  // For photo cards: return signed Supabase Storage URL.
  // For text-only cards: render an HTML template, or use a static placeholder.
  // ...
  return "https://your-supabase-url/storage/v1/sign/...";
}
async function renderBackUrl(postcard: any): Promise<string> {
  // Render the message as HTML or PNG. Lob accepts HTML strings directly.
  return "https://your-supabase-url/storage/v1/sign/...";
}
```

### 5.3 Configure environment variables

```bash
supabase secrets set LOB_API_KEY=test_xxxxxxxxxxxx
supabase secrets set LOB_LIVE_MODE=false
```

### 5.4 Deploy the function

```bash
supabase functions deploy lob-send-postcard --no-verify-jwt
```

### 5.5 Trigger it from the existing `send_postcard` RPC

The cleanest pattern is a `pg_net` HTTP call from inside the RPC, *after* the insert succeeds, with the postcard ID as the payload. Lob will then async-render and send.

```sql
-- in send_postcard RPC, after the insert:
perform net.http_post(
  url := 'https://<project>.functions.supabase.co/lob-send-postcard',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object('postcard_id', new_postcard_id)
);
```

### 5.6 Add a Lob webhook for status updates

Lob emits events: `postcard.created`, `postcard.rendered_pdf`, `postcard.in_transit`, `postcard.delivered`, `postcard.failed`.

1. Dashboard → **Webhooks** → **Add Endpoint**
2. URL: `https://<project>.functions.supabase.co/lob-webhook`
3. Events: check all postcard events.
4. Create another Edge Function `lob-webhook` that receives the event, looks up the postcard by `lob_id`, and updates `lob_status`.
5. **Verify the webhook signature**. Lob signs each request with HMAC-SHA256 using a secret you can read in the dashboard. Reject any request that doesn't verify.

This is what lets you fire a push notification "Your card to Maya was delivered."

---

## 6. Address verification (highly recommended)

Lob has a separate API for address verification:

```
POST https://api.lob.com/v1/us_verifications
```

You feed it a partial address, it returns a normalized address + a deliverability score. Run this when a friend adds an address in the app, before saving. Catches typos, invalid ZIPs, and undeliverable addresses *before* the user spends a credit.

It's ~$0.10 per verification on the lowest tier. worth it.

---

## 7. Cost modeling (so we know what margin looks like)

| Card type | Lob cost (4×6) | Your IAP price | Gross margin |
|---|---|---|---|
| Note (1 credit) | $0.65 | $1.00 | $0.35 (35%) |
| Photo / Place (2 credits) | $0.65 | $2.00 | $1.35 (68%) |
| Custom (5 credits) | $0.65–$1.10 | $5.00 | $3.90+ (78%) |

Apple takes 30% on small accounts (15% if you stay under $1M/yr small-business program). So real margin after Apple:

- Note: $0.70 net − $0.65 = $0.05 (1 credit)
- Photo: $1.40 net − $0.65 = $0.75
- Custom: $3.50 net − $0.65 = $2.85

**This means the Note tier is roughly break-even.** That's fine for engagement (it gets people into the habit) but the photo/place/custom cards are where the unit economics live.

---

## 8. Pre-flight checklist before flipping Live

When you're ready to actually mail real cards:

- [ ] Live API keys added to `supabase secrets` (replace test keys)
- [ ] Lob account has a payment method on file
- [ ] You've sent yourself **at least 5 test cards** in test mode and verified the rendered PDFs look right (Lob shows the rendered PDF in the dashboard under each postcard)
- [ ] The webhook is firing and updating `lob_status`
- [ ] Address verification is in the add-friend flow
- [ ] Send a real card to yourself first. Wait for it to arrive. **Look at the actual print quality.**
- [ ] Set up Lob billing alerts at $50/$100/$200/$500 thresholds
- [ ] Decide refund policy: what happens if Lob returns `failed`? (Recommend: refund the credit and surface a banner in the app.)

---

## 9. What I'd do tomorrow

If you sat down to start this tomorrow, the order would be:

1. **Sign up at lob.com** (5 min)
2. **Grab the test API key** (1 min)
3. **Run the curl example** above with your own test address. see a fake postcard appear in the Lob dashboard (10 min)
4. **Don't write any app code yet.** Look at the rendered PDF Lob produces. Decide if you like the print spec at 4×6 or want to bump to 6×9.
5. **Then** start the schema migration + Edge Function (1-2 evenings).
6. **Send yourself 10 real cards** before you let anyone else.

The TestFlight build doesn't need any of this. The placeholder "sits in the queue until our printing partner is live" copy in `send.tsx` covers it. When you're ready, flip the env var.

---

## Useful links

- Lob dashboard: <https://dashboard.lob.com>
- API reference: <https://docs.lob.com/#tag/Postcards>
- Postcard sizes & specs: <https://lob.com/products/postcards>
- Webhooks docs: <https://docs.lob.com/#tag/Webhooks>
- Address verification: <https://docs.lob.com/#tag/US-Verifications>
- Supabase Edge Functions: <https://supabase.com/docs/guides/functions>
