# Code Review. 2026-05-11

Consolidated from three independent passes:
- **`/codex`** (gpt-5.4) review of the MVP simplification (FlipCard, send flow, RecipientPicker, MessageEditorSheet, WelcomeSheet, MailClubContext, credits)
- **Simulator QA agent**. XcodeBuildMCP build + iPhone 17 Pro / iOS 26.4 simulator. Blocked at startup → fell back to static code review.
- **Manual code-read**. what I caught reading the diffs after the MVP simplification landed.

All three agreed on most findings. The full bug list is below, ranked. Test suite was 204/204 passing, typecheck clean, but neither verifies runtime behavior.

---

## P0. SHIP-BLOCKING

### 1. App crashes on launch on iOS 26 (Stripe `NativeEventEmitter` null)

**File:** `src/services/payments.ts:25` (import side-effect)
**Chain:** `app/_layout.tsx:6,17` and `app/(tabs)/my-card.tsx:10` → `src/components/CreditsSheet.tsx:7` → `payments.ts:25` (top-level `import { initPaymentSheet, presentPaymentSheet } from "@stripe/stripe-react-native"`)
**Symptom:** Splash → red error overlay: `new NativeEventEmitter() requires a non-null argument`. After dismissing 4 stacked errors, user lands on Expo's "Unmatched Route" sitemap. only `index.tsx` + `(tabs)/_layout.tsx` registered because the crash short-circuited route registration for every tab.

**Why:** `@stripe/stripe-react-native@0.39.0` with Expo SDK 54 (RN 0.81 / Hermes) on iOS 26. Stripe's native module is returning null when the JS side tries to subscribe to native events at module eval.

**Impact:** Any user on iOS 26+ who installs the TestFlight build cannot get past splash. Possible iOS 25 / older also affected. needs verification on real devices.

**Fix options (ranked):**
1. **Lazy-import**. move the Stripe import inside `purchasePack` so it only loads when the user taps Buy. Cheapest, biggest blast radius reduction.
2. **Upgrade `@stripe/stripe-react-native` to 0.4x**. the version with RN 0.81 / iOS 26 support. Requires pod rebuild.
3. **Rebuild iOS pods** from clean state. sometimes the autolinked native module is just stale.

**Action:** Before you push the TestFlight Internal Testing invite to your phone, install the build on a device or download to iOS 26 simulator first. If it crashes there too, do option 1 today and re-archive.

**Screenshots:** `/tmp/qa-mailroom-01-payments-crash.png`, `/tmp/qa-mailroom-02-unmatched-route.png`, `/tmp/qa-mailroom-03-sitemap-incomplete.png`

---

## P1. CRITICAL (silent revenue + data loss)

### 2. Credit refund leak on failed send

**File:** `src/state/MailClubContext.tsx:287` (deduct) → `:320-323` (catch)
**Codex finding.** Optimistic deduct of `freeCreditsRemaining` at line 287, but the catch handler at 320-323 doesn't restore it. If `sendPostcard` throws (Lob 500, network drop, Stripe payment intent failure), the user loses the credit AND gets no card.

**Test scenario that proves it:**
- User has 1 credit
- Tap Send with valid photo + note + friend
- Lob submit throws (mock the error)
- Expected: credit returns to 1, error alert
- Actual: credit drops to 0, no card sent, silent loss

**Fix:** Wrap the deduct/send in try/catch with credit restore on throw. Or even cleaner. deduct AFTER server confirms send, not optimistically.

### 3. Send button double-tap race → double-deduct + duplicate cards

**File:** `app/(tabs)/send.tsx:179` (`onSend()`)
**Both codex AND QA agent flagged.** The function gates on `if (sending) return;` (`:180`) but only sets `setSending(true)` at `:190`, after the first `await`. Two synchronous taps in the same React commit (faster than 16ms apart) both pass the gate before the rerender that hides the button propagates.

In `sendPostcardLocal` (`MailClubContext.tsx:329`) and the Supabase path `sendPostcardAction` (`:267`), the optimistic credit decrement and network call BOTH run twice → user gets charged twice, two postcards created.

The `disabled={sending}` on `PrimaryButton` only protects across React renders, not within one event-loop burst.

**Fix:** Use a `useRef<boolean>` lock that flips synchronously before any validation, instead of (or in addition to) React state. Pattern:

```ts
const sendingLockRef = useRef(false);
async function onSend() {
  if (sendingLockRef.current) return;
  sendingLockRef.current = true;
  try { ... } finally { sendingLockRef.current = false; }
}
```

---

## P2. HIGH (visible UX bugs)

### 4. FlipCard state lies during the 600ms animation

**File:** `src/components/FlipCard.tsx:74`
**Codex + QA agreed.** `doFlip()` calls `setFace("back")` synchronously while `withTiming` is still running. During the 600ms transition:
- `pointerEvents` (`:119-122`) reports the hidden face → tap target can hit the wrong layer mid-flip
- `getFace()` (`:84`) lies. returns "back" when visually we're still 50% rotated
- Accessibility label (`:114`) flips early

**Fix:** Drive `face` from the animation finish callback (or a `useDerivedValue` snapshot at the end of timing). The shared value `progress.value === 1` is the truth.

### 5. `onFlipComplete` fires synchronously, not "after the flip completes"

**File:** `src/components/FlipCard.tsx:75`
**Codex finding.** Prop contract at `:42-43` says: "Optional callback fired AFTER each flip completes." But the call at `:75` fires synchronously, 600ms early. Any caller sequencing UI off this is going to see the next state change too soon.

**Fix:** Move the `onFlipComplete?.(...)` call into the `withTiming` completion callback (line 64-72. `if (finished) { runOnJS(onFlipComplete)(...) }`).

### 6. MessageEditorSheet emoji counter + slice broken

**File:** `src/components/MessageEditorSheet.tsx:77` (slice), `:98` (counter)
**Codex + my code-read.** `t.slice(0, MAX_LENGTH)` slices on UTF-16 code units. A multi-byte emoji at the 250 boundary gets cut into a broken char. The visible counter at `:98` (`{draft.length}/{MAX_LENGTH}`) lies because emoji count as 2+ code units.

**Fix:** Use grapheme-aware counting. `Array.from(str)` gives codepoints (closer but still not grapheme-correct for ZWJ sequences). Real fix is `[...new Intl.Segmenter().segment(str)]`.

### 7. Birthday validation accepts impossible dates

**File:** `src/components/WelcomeSheet.tsx:81-88`
**Codex + QA + my code-read all flagged.** `isValidBirthday` checks `month 1-12 && day 1-31` with no per-month logic, so `02/30`, `02/31`, `04/31`, `06/31`, `09/31`, `11/31` all pass and persist via `completeSignup`.

**Fix:** Construct `new Date(2000, month-1, day)` and verify `result.getMonth() === month-1 && result.getDate() === day`. Allow `02/29` always since we don't collect year (treat as valid; downstream reminder logic decides which year to schedule).

### 8. WelcomeSheet state input `maxLength={3}` (should be 2)

**File:** `src/components/WelcomeSheet.tsx:252`
**QA agent caught this one. I missed it.** The state TextInput accepts up to 3 chars. US state codes are 2. So `CAL` enters and gets persisted. No validator catches it because `canContinue` doesn't check state at all (`:49`).

**Fix:** `maxLength={2}` + add `state.length === 2` to `canContinue` (or relax state to optional).

### 9. WelcomeSheet city/state not required

**File:** `src/components/WelcomeSheet.tsx:49`
**QA agent.** Gate is `name.trim().length > 0 && isValidBirthday(birthday)`. City/state skipped entirely. "Spaces only" city becomes empty → silently defaulted to `"Somewhere"` in `completeSignupAction` (`MailClubContext.tsx:653`). State becomes empty string.

**Fix:** Either require both (add to `canContinue`) or accept that they're optional and remove the "Somewhere" fallback in favor of a clean empty.

---

## P3. MEDIUM

### 10. MessageEditorSheet has no discard confirmation

**File:** `src/components/MessageEditorSheet.tsx:54`
**Codex + QA.** Cancel always blows away typed text with no "Discard changes?" prompt. Combined with the `useEffect` that resets draft on `[visible, initial]`, the user can lose 200 chars of typing with one accidental tap.

**Fix:** When `draft !== initial`, show an alert: "Discard your message?" → Discard / Keep editing.

### 11. MessageEditorSheet allows empty save

**File:** `src/components/MessageEditorSheet.tsx:64`
**QA agent.** `onPress={() => onSave(draft)}` with no length check. The send-screen `validate()` catches it on Send, but the "Note" button label flips to "Edit note" anyway (`send.tsx:381`. `message.trim()` is the check, so an empty save with whitespace passes neither side). Worse: if user previously had a saved note, then opens editor, clears the field, taps Done → prior note is lost without warning.

**Fix:** Disable Done when `draft.trim().length === 0` OR confirm "Clear your message?" if user is about to overwrite a non-empty `initial` with empty.

---

## P4. LOW / CLEANUP

### 12. Dead code from old 4-category system

**Files:**
- `src/state/MailClubContext.tsx:14-18`. `SendInput` union still has `handwritten | photo | place | custom`
- `src/data/credits.ts:3-44`. `CARD_COSTS` map still maps all four (even though they all = 1)

**Why it matters:** Confusing for future devs. The runtime knows about categories that the UI never shows. Strip down to `{ photo: 1 }` and `kind: "photo"`.

### 13. Orphan test files

**Files:** `__tests__/CategoryCompose.test.tsx`, `__tests__/CustomRequestForm.test.tsx`
**Codex.** Reference deleted-flow components. They pass today but will bit-rot. Delete.

### 14. Missing tests on new components

**Codex + QA.** Zero tests on `FlipCard`, `RecipientPicker`, `MessageEditorSheet`. Existing `__tests__/SendScreen.test.tsx:26-99` and `__tests__/WelcomeSheet.test.tsx:19-88` are shallow:
- No double-tap race coverage
- No failed-send refund coverage
- No birthday invalid-date cases
- No emoji counting
- No recipient-mode switching
- No flip-mid-animation interruption

### 15. `console.error` noise in test runs

**File:** `src/state/MailClubContext.tsx:166`
**QA agent.** `setHydrated(true)` after `AsyncStorage.getItem` fires outside an `act(...)` wrapper in tests. 28 warnings on every run. Wrap the hydration effect's state mutations in `act` (in the test setup, not the source).

### 16. `ENABLE_USER_SCRIPT_SANDBOXING = NO` is a band-aid

**File:** `ios/Mailroom.xcodeproj/project.pbxproj:458` and `:525`
**Codex.** Disabling User Script Sandboxing got the build green but didn't fix the underlying script-permission issue. Real fix: identify which build script (probably Hermes or Expo prebuild) is reading outside its declared inputs, add the path to `INPUT_FILE_LIST_PATHS` or convert it to a sandboxed declaration, then flip the flag back to YES.

---

## What was verified OK

These were specifically checked and cleared by codex or the QA agent:

- **Address mode auto-friend-create** (`send.tsx:223-245`). codex says no code-local bug. My concern about phantom friends if `sendPostcard` fails after `addFriendByAddress` succeeded is a real data-hygiene issue but is debatable as a "bug." Defer.
- **"Ask" mode + send with no photo**. `validate()` correctly bails with `"Pick a photo for the front first."`
- **Library picker permission flow** (`send.tsx:128-135`). codex says OK.
- **Friend cycler with empty friends list** (`RecipientPicker.tsx:104-145`). QA agent confirmed empty-state card renders correctly; tap-cycle is gated.
- **Test suite**. 28 suites, 204 tests, all passing in ~4.6s.
- **TypeScript**. `npm run typecheck` clean.

---

## Recommended fix order

If you want to act on this Monday:

1. **First hour:** Verify the Stripe crash on a real iOS 26 device or simulator. If it reproduces, fix with lazy-import (~10 LOC change in `payments.ts`). Re-archive and re-upload.
2. **Same day:** Fix the credit refund leak (#2) and the send double-tap race (#3). Both small diffs, both are real losses.
3. **Same day:** Fix the FlipCard state-sync bugs (#4, #5). Move `setFace` and `onFlipComplete` into the timing-finished callback.
4. **This week:** Tighten birthday validation (#7), MessageEditorSheet emoji + discard + empty-save (#6, #10, #11), state input maxLength (#8).
5. **This week:** Delete dead code (#12, #13) and add tests for the new components (#14).
6. **Backlog:** Sandbox re-enable (#16), `act` wrapping noise (#15).

---

*Generated 2026-05-11 from /codex (gpt-5.4) + simulator QA agent + manual code-read pass. See also `ESCARGOT_GALLERY.md` for competitor-inspired product proposals.*
