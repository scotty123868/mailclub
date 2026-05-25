# SMS-to-postcard flow — setup guide

Status: **Phase 1 scaffolded** (May 23, 2026)

## Architecture in 30 seconds

```
User texts photo to +1-877-XXXXXXX
   ↓
Twilio MMS webhook (configured to → sms-inbound Edge Function)
   ↓
sms-inbound: download photo → Supabase Storage → create draft → reply with link
   ↓
User taps link → opens app.themailroom.club/compose/<token>
   ↓
[Phase 2] compose page: message → recipient → phone OTP → submit
   ↓
[Phase 2] sms-submit Edge Function → existing send_postcard RPC → lob-send-postcard
   ↓
[Phase 2] Confirmation SMS via sms-send
   ↓
Lob prints + mails the card
```

---

## Phase 1 deliverables (in the repo right now)

| Path | What |
|---|---|
| `supabase/migrations/2026052310_sms_postcard_drafts.sql` | `sms_postcard_drafts` table + `postcards.sms_origin` column + `profiles.phone` + RPCs (`create_sms_draft`, `resolve_sms_draft`, `consume_sms_draft`) |
| `supabase/functions/sms-inbound/index.ts` | Twilio MMS webhook receiver. Verifies signature, downloads media, persists draft, replies with magic link. |
| `supabase/functions/sms-send/index.ts` | Internal-only outbound SMS helper (service-role auth required). Other Edge Functions call this for all outbound SMS so Twilio creds live in one place. |
| `supabase/functions/sms-draft-resolve/index.ts` | Anonymous GET endpoint the compose page calls to load a draft by token. Returns the photo signed URL + safe meta. |
| `mailroom-site/compose/index.html` | Mobile web page scaffold. Renders the photo preview on load. Continue button is a placeholder until Phase 2. |
| `mailroom-site/vercel.json` | Added `/compose/(.*)` rewrite. |

---

## Setup checklist — what YOU need to do

### 1. Twilio account + toll-free number (~10 min)

1. Sign up at https://www.twilio.com if you don't have an account.
2. **Buy a toll-free number**: Console → Phone Numbers → Buy a number → check the "Toll-free" filter → pick something memorable (877/833 area code). Cost: ~$2/mo + per-message.
3. **Register your toll-free verification** (REQUIRED — US carriers block unregistered toll-free traffic): Console → Messaging → Compliance → Toll-Free Verification.
   - Fill out the form (business info, sample messages, opt-in language).
   - Submit. Approval is usually 1-3 business days.
   - **You can test without approval but most messages will fail to deliver to real carriers until you're approved.**

### 2. Supabase Storage bucket — `sms-photos`

In your Supabase project dashboard → Storage → New bucket:
- Name: `sms-photos`
- Public: **No** (private; we mint signed URLs)
- File size limit: 10 MB (MMS photos are typically 1-3 MB; 10 MB gives headroom)

RLS policies (Storage → sms-photos → Policies):
- **No anon or authenticated policies needed.** All access goes through Edge Functions using the service role key. The default deny is correct.

### 3. Set Supabase env secrets

```bash
cd ~/Code/mailclub-app

supabase secrets set TWILIO_ACCOUNT_SID=AC...   # from Twilio Console → Account
supabase secrets set TWILIO_AUTH_TOKEN=...      # from Twilio Console → Account
supabase secrets set TWILIO_FROM_NUMBER=+1877...  # your toll-free in E.164
supabase secrets set COMPOSE_BASE_URL=https://app.themailroom.club/compose
# Optional (for local dev only — leave unset in prod):
# supabase secrets set SMS_INBOUND_SKIP_VERIFY=true
```

### 4. Deploy the migration + Edge Functions

```bash
cd ~/Code/mailclub-app

# DB schema
supabase db push

# Edge Functions (--no-verify-jwt on functions Twilio calls directly)
supabase functions deploy sms-inbound --no-verify-jwt
supabase functions deploy sms-draft-resolve --no-verify-jwt
supabase functions deploy sms-send
```

### 5. Configure Twilio webhook

In Twilio Console → Phone Numbers → your toll-free number:
- **Messaging → A MESSAGE COMES IN**:
  - Webhook
  - URL: `https://nlwnmgwylmmnaemdnzlq.supabase.co/functions/v1/sms-inbound`
  - HTTP POST
- Save.

### 6. Deploy the compose page

The `mailroom-site` repo is at `~/Downloads/mailroom-site` and deploys to Vercel. Just push:

```bash
cd ~/Downloads/mailroom-site
git add compose vercel.json
git commit -m "feat: SMS compose page scaffold (Phase 1)"
git push
```

Vercel auto-deploys on push. The new route is live at `app.themailroom.club/compose/<token>`.

### 7. Smoke test

1. Text a photo from your phone to your Twilio number.
2. **Expected**: SMS reply within 5 seconds containing a link like `https://app.themailroom.club/compose/AbCdEf...`
3. Tap the link.
4. **Expected**: Page loads, shows your photo as the postcard front, "Continue →" button.
5. Tap Continue → see "Phase 2 hooks up the rest" alert. This is correct for Phase 1.

If the SMS reply doesn't come:
- Check Twilio Console → Monitor → Logs → Errors for the inbound message
- Check Supabase Edge Functions → sms-inbound → Logs for our side
- Most common issues:
  - Toll-free verification not approved yet (silent delivery failure to real carriers)
  - Webhook URL typo in Twilio config
  - `SMS_INBOUND_SKIP_VERIFY` not set AND signature mismatch (check `host` header in Edge Function logs)

---

## Phase 2 (next session)

- Full compose UI: message field with live back-of-postcard preview
- Google Places autocomplete for recipient address (key already in app.json's `googlePlacesApiKey`)
- Phone OTP signup at submit (Supabase Auth phone provider — needs Twilio configured as the SMS provider for OTP in Supabase Auth settings)
- `sms-submit` Edge Function that:
  - Resolves token → draft
  - Verifies phone matches the OTP'd user
  - Creates friend via existing flow
  - Calls `send_postcard` RPC
  - Calls existing Lob handoff via `lob-send-postcard`
  - Marks draft consumed
  - Sends confirmation SMS via `sms-send`
- Pricing: Stripe products for $5/4-pack and $10/10-pack (first card always free for new users)

## Phase 3 (polish)

- Lob webhook → SMS the sender on `delivered` status
- "Sent via Mailroom — themailroom.club" tiny mark on the postcard back template (lob-send-postcard reads `sms_origin` flag)
- Account creation polish (link existing Apple Sign In users to their phone if they later text in)
- Edge cases: multiple photos in one MMS, no media attached (already handled in Phase 1), repeat senders without a phone-linked account

---

## Cost model at $5/4-pack and $10/10-pack pricing

Per card cost:
- Lob postcard (4x6 photo, USPS first-class): **$0.55**
- Outbound SMS (link + confirmation): **2 × $0.04 = $0.08**
- Inbound MMS (photo): **$0.0079**
- Stripe fee on a $5 charge: **~$0.45**, on $10: **~$0.59**

| Pack | Price | Cards | Stripe fee | Lob cost | SMS cost | Net |
|---|---|---|---|---|---|---|
| First card free | $0 | 1 | $0 | $0.55 | $0.09 | **−$0.64** loss leader |
| 4-pack | $5 | 4 | $0.45 | $2.20 | $0.32 | **+$2.03** ($0.51/card) |
| 10-pack | $10 | 10 | $0.59 | $5.50 | $0.80 | **+$3.11** ($0.31/card) |

The 10-pack is the better unit economics; the 4-pack is the better psychological entry point. Both are healthy.

---

## Security notes

- The compose token is the ONLY credential needed to load a draft. 192 bits of entropy (32 chars base64url) makes guessing infeasible.
- Drafts auto-expire after 24 hours; the `consumed_at` flag prevents reuse after submit.
- Twilio signature verification is **mandatory** in production. If `SMS_INBOUND_SKIP_VERIFY` is ever set true in prod, anyone can POST fake "user texted us a photo" events and exhaust the storage bucket. Keep it unset.
- The `sms-send` Edge Function requires the service-role JWT as auth. Anonymous callers cannot send SMS.
- Phone numbers (`profiles.phone`, `sms_postcard_drafts.from_phone`) are PII. The drafts table has RLS that denies all anon + authenticated access — only service-role can read. Profile.phone is only readable to the owning user via existing profile RLS.
