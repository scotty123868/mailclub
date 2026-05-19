# TODOs

Tracking work that's been audited and surfaced but not yet committed.

## What you need to do (BLOCKING)

### 1. Trigger Vercel redeploy for AASA
**Why:** `vercel-staging/.well-known/apple-app-site-association` was updated in commit `508d6f7` to add `/r/*` and `/claim?t=*` to Apple's path patterns. The file IS in git on `mvp-v0.3-credits-and-categories`, but Apple's CDN still serves the OLD version (only `/welcome-mail/*`).

**Verify with:**
```bash
curl -s "https://app.themailroom.club/.well-known/apple-app-site-association"
curl -s "https://app-site-association.cdn-apple.com/a/v1/app.themailroom.club"
```

The Apple CDN version updates within 24 hours after the source changes. If both still show the OLD AASA, the Vercel deploy hasn't shipped. Trigger one manually or push an empty commit to `main` if Vercel auto-deploys from there.

### 2. Read this and decide
See "Open audit items" below — five P1 items need a product decision from you, not just code.

## Done in v0.7.0.49 deep audit (commits `78c0b7f → 1aa6fc1`)

### Postcard back canonical design
- ✅ Rebuilt `buildBackHtml()` to reproduce actuallysent.pdf composition
- ✅ All 8 design-review fixes applied + Lob pressure-tested across 4 input variants
- ✅ Function annotated CANONICAL with banner pointing to REPRODUCE doc
- ✅ All competing HTML mockups archived under `_archived/`
- ✅ QR end-to-end verified — generates, decodes, URL resolves

### Reliability fixes
- ✅ P0: `lob-webhook` column rename (delivery dates populate from webhooks)
- ✅ P0: `lob-webhook` fail-closed in prod (`LOB_WEBHOOK_SKIP_VERIFY=true` for local)
- ✅ P0: `lob-webhook` debug response no longer leaks request fingerprint
- ✅ P0: `grant-test-credits` edge function DELETED (was an open money tap)
- ✅ P0: Legacy `purchase_credits` RPC DROPPED + dead client wrappers removed
- ✅ P0: `send_postcard_via_claim` atomic credit deduction (race-free)
- ✅ P0: Reciprocation token entropy upgraded from ~34 bits → ~48 bits hex
- ✅ P0: `guard_against_bulk_credit_grant()` added — future migrations refuse to bulk-credit if paying users exist
- ✅ P1: Claim-path Lob silent failure — `claim/index.ts` parses `body.ok`, persists `lob_error`
- ✅ P1: AASA path coverage — added `/r/*` and `/claim?t=*` (PENDING VERCEL DEPLOY)
- ✅ P1: Pricing mismatch — VERIFIED already unified in `2026051418`
- ✅ P1: Welcome flow error specificity (EXPIRED / NOT_FOUND / ALREADY_SCANNED / WRONG_FLAVOR)
- ✅ P1: `record_reciprocation_scan` flavor check (rejects scans on address-collection tokens)
- ✅ P1: `record_reciprocation_scan` friends INSERT on-conflict guard
- ✅ P1: Stripe purchase confirmation gate — polls for webhook-applied credit before showing "added"
- ✅ P1: `getSignedPhotoUrl` explicit failure indicator on welcome-mail
- ✅ P1: N+1 photo URL signing — batch + 23h client cache

### Defensive hardening
- ✅ P2: `lookup_reciprocation` no longer returns raw `photo_path` to anon
- ✅ P2: New `reciprocation-photo` Edge Function (service-role-only RPC + server-side signing)
- ✅ P2: Dead code branch in lob-send-postcard removed
- ✅ P2: Welcome-mail signup button relabeled to match destination
- ✅ P2: iOS build numbers unified — Info.plist 57 + pbxproj 57 + app.json 57
- ✅ P2: `GMSApiKey` verified intentional (Apple Maps default)

### Bug catches from this session
- ✅ `friends.tsx` hardcoded `userId="scotty-001"` — every user's QR rendered the founder's identity
- ✅ Map routes always tagged `tone:"sent"` — receiver cards rendered as outbound
- ✅ Map highlightRoute polyline never cleared on sheet dismiss

### Constellation UX
- ✅ Stage size cap dropped (was wasting 70pt on wide phones)
- ✅ Single-finger pan (was uncommon 2-finger)
- ✅ Literal star field background (60 seeded Circles)

## Open audit items

### P1 — Real, fixable, need product input

**P1-A. AASA `/claim?t=*` route exists in web but not in iOS app**

`app/` has `r/[token]` and `welcome-mail/[token]` Expo Router files. There's no `claim.tsx`. AASA promises `/claim?t=*` as an app intercept. Three options:

1. Add `app/claim.tsx` that reads `t` from query, routes to existing claim handler
2. Remove `/claim?t=*` from AASA (the web claim page at `vercel-staging/app/claim/page.tsx` handles it fine)
3. Leave as-is — `/claim` URLs open Safari, which is the intended fallback anyway

Recommendation: #2. Simpler. The `/claim` flow is for recipients pasting an address — they're not Mailroom users yet, no benefit from opening the app.

**P1-B. Stripe webhook delivery race — what if it NEVER fires?**

I added a 9-second polling gate to CreditsSheet. If the webhook is delayed past 9s the user sees "Payment received — should appear shortly. Email support if it doesn't."

That's a soft handoff. For real: a periodic reconciliation cron (or a manual checker) that compares `credit_purchases` rows against Stripe `payment_intent.succeeded` events in the last 24h would close this. Worth ~1 day of work.

**P1-C. Penpal void sends drop silently when no match exists**

`MailClubContext.tsx:744-800` `sendIntoVoid` does NOT call `submitToLob` for void sends. The postcard is inserted with `to_profile_id = null` and never ships. User sees "On its way!" celebration. There is no "matching in progress" state surfaced. Three options:

1. Add a `pending_match` status + visual chip on the journal tile
2. Switch the celebration to "We're finding you a pen pal" copy
3. Don't allow void sends until the matching queue has at least N candidates

Recommendation: #2 + #1. Doesn't gate sends, but is honest about the wait.

**P1-D. 30-day claim link expiry with no sender notification**

`postcard_claims.expires_at = now() + interval '30 days'` at insert. After 30 days, the recipient sees `EXPIRED`, but the sender's journal tile shows the original send forever. No "your card expired without being claimed" copy. Worth a daily cron + push notification.

**P1-E. Recipient on a different device than the original scanner locked out**

A user who scans on Device A but signs up on Device B (different account) sees `ALREADY_SCANNED_BY_OTHER` forever. No recovery. This is correct behavior in the abstract, but: the user has the physical postcard in their hand. The current copy makes them feel like they've been locked out unfairly. Options:

1. Provide a "contact the sender" CTA so they can ask for a new card
2. Add a "device switch" flow — same person, different login — that re-binds the scan
3. Accept the lockout, improve the copy

Recommendation: #1 + #3.

**P1-F. No delete-postcard affordance**

`PostcardDetailSheet.tsx` shows shipped/orphan/pending states with retry CTA. No delete. Users with an orphan they want to abandon can't get their credit back unless they Retry (which costs Lob again on success). Need a "Cancel + refund" path that only works while `lob_id IS NULL`.

### P1 — Fixable without product input (queue for next round)

- **No offline detection anywhere.** Cold launch with no network silently fails Promise.all → caught with `console.warn`. Add a NetInfo banner + retry UI.
- **Account deletion leaves Stripe customer + queued Lob postcards live.** Document + script Lob cancellation on user delete.
- **`send_into_void_with_matching` race-shape match `send_postcard_via_claim`.** Currently has a TODO comment from the migration.
- **`postcard_claims` RLS dead policies.** Either restore `grant select on postcard_claims to authenticated` (relying on row policies) or drop the dead policies.
- **`fire_lob_submit_on_postcard_insert` trigger stores service-role JWT in Postgres GUC.** Anyone with DB superuser can read it. Operational concern.

### P2 — Design system tightening (multi-day undertaking)

- **Extract `<SheetHeader/>`, `<SheetCloseButton/>`, `<IconChip/>`, `<EmptyState/>`, `<IconButton/>`.** Currently the close-button rgba pattern is copy-pasted across 12 sheets, and the sheet-header (title + subtitle + closeBtn) is copy-pasted across 9.
- **Codify scales:** `spacing.xs/sm/md/lg/xl = 4/8/12/16/24`, `radius.sm/md/lg/pill = 6/8/14/999`, `shadow.sm/md/lg`.
- **Add color tokens:** `mutedSand` (#9A8D76, used 9 places inline), `sageDeep` (#637C5E), `received` (#607A55), `goldDeep` (#A89060).
- **Drop unused `handBold` typography token.**
- **Add `prefers-reduced-motion` respect** to all motion (currently zero AccessibilityInfo checks).
- **Skeleton loading screens** for journal, friends, post-card load.
- **Empty state primitive** — currently each tab has its own treatment (sage card, backdrop pills, italic-only).

### P2 — Polish

- **Map header storytelling:** "Map" → "Map · X cities · Y cards mailed"
- **Pin label collision on Map** — Bethesda/Silver Spring/Chevy Chase stack at default zoom
- **Constellation reciprocation gold ring** doesn't animate in (the D.3 magical moment promised in the file's own header comment)
- **Friends rolodex has no search/sort** at >20 friends
- **PrivacyCard always renders full-size on friends.tsx** — collapse after acknowledgment
- **Apple "Tap Sign in with Apple again" copy** fires on deliberate dismiss too — too aggressive
- **WelcomeSheet `signUp → signIn` fallback uses same password** — duplicate-email with different password fails confusingly
- **`Alert.alert` used 40+ times across the codebase** — Toast primitive for non-blocking errors would unify the look
- **`PostalCard` adoption is weak** — used only 2 places, everywhere else builds inline card chrome
