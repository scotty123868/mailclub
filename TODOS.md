# TODOs

Tracking work that's been audited and surfaced but not yet committed. Each
entry should have an owner (you), a rough severity (P0 / P1 / P2), and
enough context that a future you or any AI can act on it cold.

## Open

### P0 — receipt validation in purchase_credits

**File:** `supabase/migrations/2026051200_initial_schema.sql:316` (the
`purchase_credits` RPC).

**Comment in code:** `// TODO: validate Apple/Stripe receipt`.

**Why it matters:** The function adds credits to `profiles.credits`
without checking the source. The 1211 hardening migration revoked
direct `authenticated` access, so today only the Stripe webhook calls
this via service role. As long as that webhook does its own server-
side validation (today: Stripe signs the webhook payload + we check
the sig), no double-spend can happen.

**Failure mode:** If anyone ever wires a NEW caller to `purchase_credits`
that doesn't validate the receipt first (e.g. an internal CLI tool, a
new edge function, a recovery script), retries can compound credits.
This is money.

**Fix:** Move receipt validation INTO `purchase_credits`. Take the
Stripe event ID as a param, store it as a unique idempotency key on
the credit-grant, refuse to re-grant against the same event ID. Apple
in-app purchase receipts go through `verify_apple_receipt()` similarly.

**Effort:** ~1 day. Needs a migration + webhook callsite update.

---

### P1 — pricing mismatch between friend and link sends

**Files:**
- `supabase/migrations/2026051211_phase6_hardening.sql:146-152`
  (`send_postcard`, friend mode): flat 1 credit
- `supabase/migrations/2026051208_postcard_claims.sql:137-143`
  (`send_postcard_via_claim`, link mode): 1/2/2/5 by card type
- `supabase/migrations/2026051502_penpal_postcrossing.sql:104`
  (`send_into_void_with_matching`): hardcoded 1

**Why it matters:** Same product (a printed postcard), different price
depending on which flow the user took to send it. Custom-AI postcards
cost 5 credits via the link flow and 1 credit via friend mode. The
inconsistency is invisible to the user until they notice.

**This is a product decision, not a code fix.** Pick one of:

1. Friend mode also tiers (1/2/2/5). Honest pricing, complicates the
   "send to a friend, costs 1" expectation.
2. Link mode flattens to 1 credit for everything. Loses the price
   signal that custom/AI cards are more expensive to fulfill.
3. Both modes use a new tiered structure that reflects real Lob cost
   + AI generation cost.

**Action:** Bring this to product review. Don't quietly equalize either
direction without an explicit decision.

---

### P2 — Empty GMSApiKey in Info.plist

**File:** `ios/Mailroom/Info.plist:39`

**State:** `GMSApiKey` is set to the empty string.

**Risk:** If anything in the app uses Google Maps SDK (GMSMapView,
GMSPlacesClient, etc.), it'll fail silently. The Places integration
in send-card autocomplete uses the SERVER-SIDE Google Places API via
`GOOGLE_PLACES_API_KEY` (set in Supabase secrets), so the iOS side
isn't currently hitting Google Maps SDK.

**Action:** Confirm we're not using Google Maps SDK anywhere in the
iOS bundle. If we aren't, delete the empty key entirely instead of
shipping a misleading zero-byte string. If we are, populate it from
an iOS-restricted Google Cloud API key (NOT the server one).

**Effort:** ~30 min to audit + decide.

---

### P2 — iOS build numbers split

**File:** `ios/Mailroom.xcodeproj/project.pbxproj`

**State:**
- Main + App Clip targets at `CURRENT_PROJECT_VERSION = 57`
  (lines 667, 718)
- Test targets at `CURRENT_PROJECT_VERSION = 13`
  (lines 467, 503)

**Why it matters:** Probably intentional (test targets don't need to
match the App Store build number). But if Xcode ever auto-bumps from
build settings UI, having two values means humans get confused about
which one App Store cares about.

**Action:** Either align test targets with main (just bump them in
lockstep going forward) or annotate the project.pbxproj with a
comment explaining the deliberate split.

**Effort:** ~5 min.

---

### P2 — `lookup_reciprocation` returns raw photo_path to anon

**File:** `supabase/migrations/2026051209_reciprocation_tokens.sql:262-278`

**State:** The function is granted to `anon` and returns
`postcards.photo_path` directly. The `postcard-photos` bucket is
PRIVATE, so the returned path can't be used to fetch the photo without
also obtaining a signed URL through another authenticated call. But
the path itself reveals the sender's user ID and an upload timestamp.

**Risk:** Token enumeration leaks user-IDs + timestamps to whoever
holds the token. Low severity (you'd need the token to start) but
defense in depth would have the function NOT return the path —
instead, return only a signed URL that the recipient can use directly.

**Action:** Update the RPC to mint the signed URL server-side instead
of returning the path. Will need to handle expiration carefully (the
recipient may sit on the welcome screen for hours; the URL has to
last that long or be re-signable).

**Effort:** ~1 hour.

---

## Done in v0.7.0.49 audit

- ✅ P0: `lob-webhook` column rename `expected_delivery_date` →
  `lob_expected_delivery` (delivery dates now populate from webhooks)
- ✅ P0: `lob-webhook` fail-closed in prod, requires explicit
  `LOB_WEBHOOK_SKIP_VERIFY=true` to bypass (local dev only)
- ✅ P1: Claim-path Lob silent failure — now parses `body.ok` and
  persists `parsed.error` to `postcards.lob_error`
- ✅ P1: AASA path coverage — added `/r/*` and `/claim?t=*`
- ✅ P1: Welcome flow error specificity (EXPIRED / NOT_FOUND /
  ALREADY_SCANNED_BY_OTHER each get distinct copy)
- ✅ P1: getSignedPhotoUrl explicit failure indicator
- ✅ P1: N+1 photo URL signing — batch `createSignedUrls()` + 23h
  client-side cache
- ✅ P2: Dead code branch in lob-send-postcard:739 removed
- ✅ P2: Welcome-mail signup button relabeled to match destination
