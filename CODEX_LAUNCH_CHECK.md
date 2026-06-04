# CODEX — Launch-Readiness Check (Mailroom / mailclub)

You are a senior engineer doing the **final pre-launch audit** of **Mailroom**, a "text a photo → we mail a real paper postcard" product. Your job: verify the system actually works end-to-end and produce a blunt **GO / NO-GO** with a prioritized blocker list. Be skeptical. Verify against code and live state — **do not trust the README or docs, they're stale.** Trust the code and `git log`.

Branch: `mvp-v0.3-credits-and-categories`.

---

## The system (what to check)
- **Texting bot (core product):** `supabase/functions/loop-inbound/index.ts` — a LoopMessage (iMessage) webhook + conversation state machine (~3.5k lines). `sms-inbound/` is the superseded legacy Twilio path.
- **Fulfillment:** `lob-send-postcard` → Lob prints + USPS mails. Gated by `MAILROOM_TEST_MODE_NO_LOB` and `LOB_API_KEY_TEST`.
- **Payments:** Stripe — `create-payment-intent`, `stripe-webhook`, `sms-buy-checkout`.
- **DB:** Supabase Postgres, ~80 migrations in `supabase/migrations/`.
- **Apps:** Expo iOS app ("Mailroom: Send Postcards", LIVE on the App Store, `com.mailrooms.app`) + native App Clip; web claim site on Vercel (`app.themailroom.club`).

## Current deployment state (2026-06-03 — verify these are still true)
- `loop-inbound` and `claim-nudge` are **deployed**.
- `LOB_API_KEY_TEST` is **set** → the system is in **dry-run mode**: a send hits **Lob's test environment** (creates a postcard object + preview, **nothing physically mails, no charge**).
- `MAILROOM_TEST_MODE_NO_LOB="true"` (irrelevant while the test key is set; becomes the live gate once the test key is removed).
- AASA confirmed live; iOS app live; `2026060400_claim_nudge.sql` applied.

---

## Mission — verify each area, then give a GO/NO-GO

### 0. The launch switch (P0)
- Confirm the fulfillment guard in `lob-send-postcard/index.ts` (~lines 535 & 898): `const lobKey = LOB_API_KEY_TEST ?? LOB_API_KEY; usingTestKey = !!LOB_API_KEY_TEST;` and the no-mail guard is `MAILROOM_TEST_MODE_NO_LOB === "true" && !usingTestKey`. Confirm that to go **LIVE** you must **unset `LOB_API_KEY_TEST`** AND set **`MAILROOM_TEST_MODE_NO_LOB=false`**.
- `supabase secrets list` must show every send-critical secret present: `LOB_API_KEY`, `LOOPMESSAGE_API_KEY` / `_SENDER_ID` / `_WEBHOOK_AUTH`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY` / `_WEBHOOK_SECRET`, `MAILROOM_RETURN_*` (×5), `CRON_TRIGGER_SECRET`.
- **Pass:** you can state the exact secret state for "test" vs "live," and all secrets exist.

### 1. The money path (P0 — must be correct)
Trace a send through `loop-inbound`: `doMail` / `doMailStranger` / `doMailReplyToPenPal` / `doSchedule` / `doScheduleReply`.
- Credit deducted **atomically** (`send_postcard_sms` / `send_postcard_sms_direct`; see `migrations/2026060210_atomic_credit_deduction.sql`).
- A Lob failure **refunds the credit** and releases the send claim (`releaseSendClaim`).
- Anti-double-send: the `awaiting_send_confirm → sending` atomic step-flip in `handleSendConfirm` makes a rapid second "send" no-op.
- **Pass:** no path double-charges, none mails without deducting, every failure refunds.

### 2. This session's new code (NOT covered by the Jest suite — verify by reading)
- **Deferred return address:** first-time FRIEND sends skip the address step, mail, then `doMail` re-enters `awaiting_sender_location` with `post_send:true`; `handleSenderAddressConfirm` saves + resets (no second send). Verify a first-timer can't get stranded, and the postmark STATION line + pre-send "YOUR CITY" gracefully handle the missing city on card #1.
- **Reply scheduling:** `doScheduleReply` + the removed `reply_to_pen_pal` guard in `handleSendConfirm`. Verify a scheduled reply creates a `'scheduled'` postcard to the original sender's address, closes the pairing loop + opens the reverse pairing, and the existing `fire-scheduled-postcards` cron mails it. (Known gap: no fire-time "a reply is on its way" push for scheduled replies — by design.)
- **Address auto-complete:** `resolveAddress` → Lob verify → `completeAddressAI` fallback fills a missing ZIP/city, surfaced at the confirm step. Verify it **cannot silently mail to a hallucinated address** — the "Mailing to: … Look right?" confirm must be the gate.
- **claim-nudge:** `supabase/functions/claim-nudge/index.ts` + `2026060400_claim_nudge.sql`. Verify it nudges **once** (`nudge_sent_at`), only for **unclaimed + unexpired** links ≥2 days old, and authenticates via `CRON_TRIGGER_SECRET`.
- **Pass:** each behaves as described; no state-machine dead-ends.

### 3. Live smoke test (if you have device/thread access)
Text a photo to the Mailroom number and walk: friend send **with** a typed ZIP and **without** one (confirm auto-complete), "send a link," "penpal," `buy`, `ideas`, `cancel`. With the test key set, confirm a postcard object appears in **Lob's test dashboard** and **no** physical mail/charge occurs. Tail `supabase functions logs loop-inbound` for errors/strandings.

### 4. Infra & security (P1)
- **AASA** live: `curl -I https://app.themailroom.club/.well-known/apple-app-site-association` → 200, `application/json`, correct app IDs (`824QVPJ3B5.com.mailrooms.app` + `.Clip`).
- **Stripe webhook** endpoint registered (paid credits never land without it; the free first card works regardless).
- `LOB_WEBHOOK_SKIP_VERIFY` and `SMS_INBOUND_SKIP_VERIFY` are `"true"` → flip to `"false"` for prod (verification secrets are present). Confirm RLS is on (`migrations/2026060300_*`, `2026060310_*`).
- iOS app: `src/services/*` call the live backend (not `src/data/mock.ts`). Flag that a live `pk_live_` Stripe key is committed in `app.json` (move to EAS secrets).

### 5. Consistency nits (P2)
- **Pricing mismatch:** App Store says "70 cents a card," the bot says "~$1 each," buy packs are $1/card. Pick one number across all three.
- **Brand domain split:** `app.themailroom.club` vs `themailroom.club` vs the support email. Unify.

---

## Output
1. **GO / NO-GO** for "a real postcard mails end-to-end."
2. **P0 blockers** with `file:line` + the exact fix.
3. **P1 (pre-public)** and **P2 (nits)**, deduplicated.
4. The exact commands to flip **test → live** and how to **roll back**.

Be blunt and specific. Don't gold-plate — the goal is a *safe launch*, not perfection.

---

### Reference: flip test → live (when GO)
```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
supabase secrets unset LOB_API_KEY_TEST --project-ref nlwnmgwylmmnaemdnzlq
supabase secrets set MAILROOM_TEST_MODE_NO_LOB=false --project-ref nlwnmgwylmmnaemdnzlq
# then text yourself one real card and confirm it physically mails.
# rollback: supabase secrets set LOB_API_KEY_TEST=test_...   (re-enters dry-run)
```
