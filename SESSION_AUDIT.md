# v0.7.0.49 session audit

End-to-end audit of every change shipped in the deep-audit session
(commits 78c0b7f → 7c93ad6). All checks ran 2026-05-19 against the
deployed Supabase project + Lob test API.

## Verified

### Security
- `grant-test-credits` Edge Function returns **404** (was a wide-open
  money tap that anyone could POST to). Source file deleted.
- `lob-webhook` debug response now gated behind `LOB_WEBHOOK_DEBUG=true`.
- `lob-webhook` fail-closed in prod unless `LOB_WEBHOOK_SKIP_VERIFY=true`.
- Legacy `purchase_credits` RPC dropped via `2026051802` migration.
  Dead client wrappers (`api.purchaseCredits`, MailClubContext) removed.
- Reciprocation tokens upgraded to 12-char hex (~48 bits, was ~34).
- `send_postcard_via_claim` + `send_into_void_with_matching` use
  atomic `UPDATE ... WHERE credits >= cost RETURNING credits` pattern.
- `_internal_get_reciprocation_photo_path` granted only to service_role.
- Dead RLS policies on `postcard_claims` + `postcards` dropped via
  `2026051901` migration.
- `guard_against_bulk_credit_grant()` function added. future bulk
  credit grants must call it to prove no paying users will be affected.

### Reliability
- `claim/index.ts` now parses `body.ok` from lob-send-postcard and
  persists `lob_error` on Lob rejection. The recipient still sees
  success (their address was saved); sender gets the orphan in
  retry-orphan flow.
- `record_reciprocation_scan` rejects `WRONG_FLAVOR` scans + uses
  `ON CONFLICT DO UPDATE` for the friends INSERT (no more 500s on
  double-tap-during-retry races).
- Welcome flow error states split into network / EXPIRED / NOT_FOUND /
  ALREADY_SCANNED_BY_OTHER / WRONG_FLAVOR with distinct copy.
- `getSignedPhotoUrl` failures now show an explicit "Photo unavailable"
  chip on the welcome-mail screen.
- Stripe purchase polls `fetchProfile` up to 9s for webhook-applied
  credit before showing "stamps added". no more optimistic UI.
- `fetchPostcards` batch-signs photo URLs via `createSignedUrls()` +
  23h client cache (was N round-trips per refresh).

### Endpoints verified live
- `reciprocation-photo`: NOT_FOUND on bad token, `token required` on
  empty body, CORS preflight 200 with correct headers.
- `welcome-mail`: 200 on existing tokens, EXPIRED/NOT_FOUND surfaced.
- `lob-send-postcard`: round-trip Lob submission `psc_d76a35c087bebbe8`
  produced the canonical design with all v0.7.0.49 fixes applied.
- Postcard PDF + thumbnail download cleanly. AASA stamp visible top-
  right, balloon stamp content shows correctly, postmark pill is the
  clean text+ticks form, 70¢/2026 don't overlap.
- iOS build numbers: Info.plist 58 + pbxproj 58 + app.json 58 (lockstep).

### iOS app code paths
- `/claim` Universal Link route exists at `app/claim.tsx`; opens the
  web claim form via Linking.openURL.
- Friends rolodex search bar appears at 8+ friends; sorts by
  last-interaction desc with alphabetical tiebreak.
- PrivacyCard collapses to a small pill after first acknowledgment
  (persisted via AsyncStorage).
- Constellation reciprocated nodes get a gold halo behind the gold ring.
- Map header shows "X cities · Y cards" subtitle when there's data.
- friends.tsx `userId="scotty-001"` replaced with `authedUserId`.
- Map routes branch on `senderId === authedUserId` for sent vs received.
- Map highlightRoute clears when the preview sheet dismisses.
- Constellation: stage size cap removed, single-finger pan with
  activation threshold, 60-star deterministic background.

### Design system primitives
- 12/12 sheets migrated to `SheetHeader` / `SheetCloseButton`.
- `src/theme/scales.ts` codifies spacing/radius/shadow/motion scales.
- `src/theme/colors.ts` gained `mutedSand`, `sageDeep`, `received`,
  `goldDeep` + an `overlay` table.
- `src/lib/useReducedMotion.ts` hook available for future animations.
- Unused `handBold` typography token removed.

### Build hygiene
- `bunx tsc --noEmit` clean across all changes.
- `bunx jest`. 29 test suites, 242 passing, 1 skipped, 0 failed.
- 21 commits pushed to `mvp-v0.3-credits-and-categories`.
- Working tree clean.

## Deferred (documented, not shipped)

- **AASA Vercel deploy**: file is updated in git, Vercel hasn't
  redeployed since 7:40 AM ET 2026-05-18. Two API keys (different
  scopes) tried. neither could see the Mailroom project. Real fix
  requires Vercel dashboard access. QR scans already fire Universal
  Link via the `/welcome-mail/*` path which IS in current AASA;
  the displayed `/r/{token}` URL falls back to the web page (designed
  fallback for non-iOS users).
- **NetInfo offline banner**: would require a native dep. Per-call
  Alert fallbacks already cover the offline-fail case.
- **Account deletion lifecycle**: Stripe customer + queued Lob
  postcards persist after delete. ~1 day of work + Stripe/Lob API
  calls; not blocking launch.
- **Migration of existing inline styles to new scales tokens**:
  incremental as files are touched. New code uses tokens; legacy
  works unchanged.

## Action items for the user

1. **Vercel redeploy**. open https://vercel.com/dashboard, find the
   Mailroom project, hit Redeploy on the latest commit. Verify with
   `curl -s https://app.themailroom.club/.well-known/apple-app-site-association`
  . response should include `/r/*` + `/claim?t=*` paths.
2. **TestFlight test build 58** when it lands (~10 min after push).
3. **Submit to App Review** once you've verified the device build.
