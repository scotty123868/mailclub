# Codex review prompt — v0.7.0.49 closing batch

Use this prompt with `codex review` (or paste into the Codex web app) to
audit the work shipped in this session. Branch:
`mvp-v0.3-credits-and-categories`, builds 58 → 61.

## Run command

```bash
cd ~/Code/mailclub-app
codex review --since=78c0b7f \
  --focus="security,reliability,UX,product-correctness" \
  --model=high
```

Or paste the prompt below into Codex/ChatGPT with the diff in hand.

---

## Hand-rolled review prompt (paste verbatim)

You are auditing the Mailroom iOS app — a "send a real postcard for less
than a stamp" product (Expo/RN + Supabase + Lob). I shipped a deep
audit + hardening pass on branch `mvp-v0.3-credits-and-categories`
between commits `78c0b7f` and `1f5b666`. Builds 58 → 61 are on
TestFlight.

You previously found these issues and I claimed to fix them. **Be hostile.
Try to break each fix.** If a fix is incomplete, say so concretely with
file + line. If you find new bugs, surface them with severity.

### Fixes shipped in this batch (verify each)

**P1 — Claim endpoint no longer JWT-gated**
- `supabase functions deploy claim --no-verify-jwt` was applied
- Same for `reciprocation-photo`, `welcome-mail`
- Verify: `curl -X POST https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/claim?t=ABC -H "Content-Type: application/json" -d '{}'` should return 400/200 with body, NOT 401.
- Verify: same call to `/reciprocation-photo` should return 200 with `{ok:false}` for bad token.
- Failure mode I want you to probe: anonymous POST to `/claim` with a VALID redeemed token, attempting to re-claim. Confirm the atomic `redeem_postcard_claim` rejects.

**P1 — redeem_postcard_claim race**
- Migration: `supabase/migrations/2026051902_redeem_claim_atomic.sql`
- Switched to atomic `UPDATE ... WHERE claim_token = ? AND claimed_at IS NULL AND expires_at > now() RETURNING id`
- Try to construct a race: two concurrent POSTs for the same fresh token. Only ONE should succeed; the other should return `ALREADY_CLAIMED`.
- Also check: does `lob-send-postcard` now refuse to re-submit when `lob_id` is already set? See `supabase/functions/lob-send-postcard/index.ts` around the "v0.7.0.49 idempotency guard" comment.

**P2 — Claim handoff missing-secret path persists lob_error**
- `supabase/functions/claim/index.ts` — when MAILROOM_INTERNAL_SECRET is empty, the function now writes `lob_error` to the postcards row before returning the misconfig response.
- Confirm: `retry-orphan` can read this lob_error and surface it to the sender.

**P2 — reciprocation-photo token oracle hardening**
- File: `supabase/functions/reciprocation-photo/index.ts`
- Hex format check rejects malformed tokens before hitting the DB
- All failure modes (NOT_FOUND / EXPIRED / NO_PHOTO) collapsed to `{ok: false}` — no reason string.
- Probe with: bad tokens of various lengths, special chars, very long strings, control chars.

**Postcard back canonical design**
- Source of truth: `supabase/functions/lob-send-postcard/index.ts` `buildBackHtml()`
- Reference render: Lob postcard `psc_d76a35c087bebbe8` (URL in commit 9908f81)
- Pressure-tested against 4 input variants — canonical / long_message /
  long_city / no_qr. Recipe in `design-mockups/postcard-back/REPRODUCE_ACTUALLYSENT.md`.
- Check: does the displayUrl (`themailroom.club/r/{token}`) match what's in the rendered HTML? Does the QR encode `/welcome-mail/{token}` (in current AASA) so iOS Universal Link fires?

**Build 61 design fixes (Codex P2s from the previous round)**
- **#2 Real QR encoding**: `src/components/QRCodeModal.tsx` now uses `react-native-qrcode-svg` to encode `https://app.themailroom.club/u/{userId}`. Was a hash-pattern that looked like a QR but encoded nothing. Verify the URL pattern.
- **#4 Text-only postcards**: `send.tsx` cover step no longer requires a photo. `CoverStep` shows "Or skip this step — text-only postcards work too." `MailClubContext.sendPostcardAction` guards upload behind `hasPhotoIntent`. Verify: can a user send with `kind: "photo"` and `photoUri: ""` without hitting "We couldn't upload your photo"?
- **#5 Photo permission deny**: Both `send.tsx` and `WelcomeSheet.tsx` now show a two-button Alert: Open Settings (Linking.openSettings) + Continue without. Verify: a user who denies photo access can still proceed.
- **#8 Warm pending copy**: `PostcardDetailSheet` swapped cold labels — "AWAITING ADDRESS" → "WAITING FOR THEIR ADDRESS", etc. Verify the new copy reads warm + the old labels are gone.
- **#10 Stripe inline confirmation**: `CreditsSheet.onBuy` no longer pops `Alert.alert`. Sets `purchaseResult` state and renders an inline card with "Mail something" deep-link (`router.push("/(tabs)/send")`) + "Buy more" reset. Verify the result card mounts in both `credited` and `pending` states.

### Things I'd specifically like you to attack

1. **Atomic redeem race**: write the actual SQL test. Two transactions both `BEGIN`, both call `redeem_postcard_claim('SAME_TOKEN', ...)` simultaneously. Only one should commit with `ok: true`. Walk through the WHERE clause and explain why the race is closed (or find a gap).

2. **lob_id idempotency**: I added an early-return guard in `lob-send-postcard/index.ts` after fetching the postcard row. If `lob_id` is non-null, return immediately. **Is there a race where two concurrent calls both see `lob_id: null` because the FIRST call hasn't written its lob_id yet?** I think this exists. What's the cleanest fix — a `SELECT FOR UPDATE` on the postcards row at the start, or a unique-on-(postcard_id, request_id) idempotency table?

3. **send_into_void_with_matching atomic credit**: 2026051900 used `UPDATE ... WHERE credits >= cost RETURNING credits`. Confirm this closes the race shape that 2026051803 closed for `send_postcard_via_claim`. Check the `for update skip locked` on `penpal_queue` — does the matching step have its own race?

4. **`fetchReciprocationPhotoUrl` client behavior**: src/services/api.ts uses `supabase.functions.invoke()` which sends the platform anon JWT. Now that we deployed reciprocation-photo with `--no-verify-jwt`, the platform bearer is no longer required — but the invoke() helper still sends it. Confirm this isn't accidentally double-failing.

5. **`/u/{userId}` QR URL**: today the printed QR encodes `https://app.themailroom.club/u/{userId}` but neither AASA nor the Vercel rewrite cover `/u/*`. Scanning opens Safari to the marketing homepage. **Is this acceptable for launch?** If not, what's the smallest change — add `/u/*` to AASA + a Vercel rewrite to a profile-share landing page?

6. **Bottom-line: did `--no-verify-jwt` introduce any new attack surface?**
   - Anonymous callers can POST to `/claim`, `/reciprocation-photo`, `/welcome-mail`.
   - The functions themselves validate tokens (`/claim` validates the claim_token, `/reciprocation-photo` validates the token before signing, `/welcome-mail` validates via lookup_reciprocation).
   - Probe: rate-limit absence on these endpoints. Can someone enumerate the token space? With 48 bits of entropy (12 hex chars) that's 281 trillion — brute force is infeasible. But a determined attacker could still hammer the DB. Is per-IP rate limiting at the Supabase/Vercel edge sufficient?

7. **TestFlight build 61**: the canonical design + reciprocation-photo + text-only + Stripe inline are all in this build. After Apple processes it, test on device:
   - Show My QR (friends tab) renders a real scannable QR
   - Send flow: skip the photo step, write a quick note, send
   - Buy stamps: payment completes, inline confirmation appears (no native Alert)
   - Postcard detail on an unclaimed link: copy reads "WAITING FOR THEIR ADDRESS" not "AWAITING ADDRESS"

### Out of scope for this review

- AASA deployed copy still shows only `/welcome-mail/*`. The `/r/*` and `/claim?t=*` paths from my AASA update went to the wrong repo (`scotty123868/mailclub`'s `vercel-staging/`, not the actually-deployed `scotty123868/mail` at `~/Downloads/mailroom-site/`). User has to manually update the right file.
- Penpal void send "matching pending" UI surfacing — copy changed in CelebrationOverlay but the journal tile doesn't show a pending-match chip yet.
- Constellation reciprocation gold-ring entrance animation — still static.
- Account deletion lifecycle (Stripe + Lob residue) — deferred.
- NetInfo offline banner — deferred (native dep).

### What to deliver

For each item in the "Fixes shipped" list above, output:
- ✅ Verified working (with evidence) — or
- ⚠️ Partial fix (specific gap with file:line) — or
- ❌ Broken (specific reproduction + severity)

Plus any NEW issues you find while probing the diff (be specific:
file path, line number, severity, suggested fix).
