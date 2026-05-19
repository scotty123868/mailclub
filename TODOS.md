# TODOs

Tracking work that's been audited and surfaced but not yet committed. Each
entry should have an owner (you), a rough severity (P0 / P1 / P2), and
enough context that a future you or any AI can act on it cold.

## Open

_(empty — see "Done in v0.7.0.49 audit" below)_

## Done in v0.7.0.49 audit

### Postcard back canonical design
- ✅ Rebuilt `buildBackHtml()` to reproduce actuallysent.pdf composition
- ✅ All 8 design-review fixes applied + Lob pressure-tested across 4 input
  variants (canonical / long message / long city / no QR)
- ✅ Function annotated CANONICAL with 30-line banner pointing to the
  REPRODUCE doc; all competing HTML mockups archived under `_archived/`

### Reliability fixes
- ✅ P0: `lob-webhook` column rename `expected_delivery_date` →
  `lob_expected_delivery` (delivery dates now populate from webhooks)
- ✅ P0: `lob-webhook` fail-closed in prod, requires explicit
  `LOB_WEBHOOK_SKIP_VERIFY=true` to bypass (local dev only)
- ✅ P0: Legacy `public.purchase_credits` RPC DROPPED. Was a
  validation-free credit grant. Production Stripe purchases run through
  `apply_stripe_credit_purchase` (idempotent, ledger-backed, called only
  by the signature-verified stripe-webhook). Dead client wrappers
  (`api.purchaseCredits`, `MailClubContext.purchaseCredits`) removed too.
- ✅ P1: Claim-path Lob silent failure — `claim/index.ts` now parses
  `body.ok` (lob-send-postcard always returns HTTP 200) and persists
  `parsed.error` to `postcards.lob_error` so retry-orphan can show it
- ✅ P1: AASA path coverage — added `/r/*` and `/claim?t=*`
- ✅ P1: Pricing mismatch — VERIFIED already fixed in migration
  `2026051418_normalize_send_via_claim_credits.sql`; audit was reading the
  outdated 2026051208 definition. All flows charge 1 credit flat.
- ✅ P1: Welcome flow error specificity (EXPIRED / NOT_FOUND /
  ALREADY_SCANNED_BY_OTHER each get distinct copy)
- ✅ P1: `getSignedPhotoUrl` explicit failure indicator
- ✅ P1: N+1 photo URL signing — batch `createSignedUrls()` + 23h
  client-side cache

### Defensive hardening
- ✅ P2: `lookup_reciprocation` no longer returns raw `photo_path` to
  anon callers. New `reciprocation-photo` Edge Function takes the token,
  validates it via service-role-only RPC, and returns just a signed URL.
  Sender user_id + upload timestamp stay server-side.
- ✅ P2: Dead code branch in lob-send-postcard removed
- ✅ P2: Welcome-mail signup button relabeled to match destination
- ✅ P2: iOS build numbers unified — Info.plist 57 + pbxproj main target
  57 + app.json 57 (all in lockstep so `expo prebuild` won't regress)
- ✅ P2: `GMSApiKey` empty string verified intentional — Apple Maps is
  the default, Google Maps requires populating `app.json` → `ios.config.
  googleMapsApiKey` (the empty key IS the Apple-Maps signal)
