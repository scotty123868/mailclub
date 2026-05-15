import { useEffect, useMemo, useRef, useState } from "react";
import { WelcomeSheet } from "@/src/components/WelcomeSheet";
import { useMailClub } from "@/src/state/MailClubContext";

/**
 * WelcomeGate — global overlay that shows the WelcomeSheet whenever the
 * user isn&apos;t fully onboarded.
 *
 * v0.7 contract: a user is "fully onboarded" iff ALL THREE are true:
 *   1. hasSeenFreeCreditsIntro  (saw the intro page)
 *   2. hasCompletedSignup        (profile row exists server-side)
 *   3. hasSentFirstCard          (mailed or queued a card via send-link)
 *
 * The third flag is the v0.7 keystone: the forced signup→send flow does
 * NOT let users into the app until they&apos;ve mailed something.
 *
 * v0.7.0.25 — celebration race fix.
 *
 * Before: the `isReturningUser` hatch (any authenticated user with at
 * least one server-side postcard) short-circuited rendering. The bug:
 * `sendPostcardViaLinkAction` refreshes postcards BEFORE the WelcomeSheet
 * advances to MailedStep ("Your card is on its way" celebration). That
 * means the moment a first-time user sent their first card, the hatch
 * fired and unmounted the welcome flow — MailedStep (with its envelope-
 * balloon animation, Share sheet auto-open for link mode, and the
 * "Done" button) was destroyed mid-mount, the user got dropped straight
 * into the app shell with no celebration and no Share prompt.
 *
 * Fix: latch a `hasStartedFlow` flag on first mount. Once the WelcomeSheet
 * is showing, only the explicit `dismissedLocal` flag (set when MailedStep
 * fires onComplete) can dismiss it. The isReturningUser hatch still
 * applies, but only for the initial mount decision — once the user is
 * mid-flow they finish what they started.
 *
 * CRITICAL: We wait for `hydrated === true` before rendering. Otherwise
 * returning users see a welcome-sheet flash on every cold launch (all
 * three flags default to false until AsyncStorage resolves).
 */
export function WelcomeGate() {
  const {
    hasSeenFreeCreditsIntro,
    hasCompletedSignup,
    hasSentFirstCard,
    hydrated,
    authedUserId,
  } = useMailClub();
  const [dismissedLocal, setDismissedLocal] = useState(false);
  // v0.7.0.25: ref that latches true once we've decided to show the
  // WelcomeSheet in this session. Stays true until dismissedLocal flips.
  // Prevents the mid-flow unmount race that ate the celebration animation.
  // Using a ref + a state flag together: the ref is read inside useMemo
  // for the "already-latched" shortcut, the state forces a re-render
  // when the ref flips so consumers re-evaluate.
  const hasStartedFlowRef = useRef(false);
  const [, forceRender] = useState(0);

  // v0.7.0.18: when the user signs out, MailClubContext clears flags back
  // to false. dismissedLocal used to stay `true` from the previous
  // session — kept the gate closed even though the user was now
  // unauthenticated, stranding them on My Card. Reset the local
  // dismissal whenever any onboarding flag flips false.
  useEffect(() => {
    if (!hasCompletedSignup || !hasSentFirstCard || !hasSeenFreeCreditsIntro) {
      setDismissedLocal(false);
    }
  }, [hasCompletedSignup, hasSentFirstCard, hasSeenFreeCreditsIntro]);

  // Decide whether to mount the WelcomeSheet. Memoized so the JSX below
  // stays simple. The two-phase logic — "should we START the flow" vs
  // "are we already showing it" — is the whole shape of the race fix.
  const shouldShow = useMemo(() => {
    if (!hydrated) return false;
    if (dismissedLocal) return false;
    // If we already latched the flow open, stay open until user dismisses.
    if (hasStartedFlowRef.current) return true;

    const fullyOnboarded =
      hasSeenFreeCreditsIntro && hasCompletedSignup && hasSentFirstCard;
    if (fullyOnboarded) return false;

    // Returning-user hatch v0.7.0.27 — broadened.
    //
    // Previous (build 39) version required server-side postcards to
    // exist. That failed two real cases:
    //   a) User signed up, completed profile, then bailed before first
    //      send. Coming back on a new device: hasCompletedSignup=true
    //      but 0 server postcards. WelcomeGate kept showing welcome.
    //      Worse, their previous-session credits had been debited (the
    //      RPC charges before client-side share completion in some
    //      paths), so they hit INSUFFICIENT_CREDITS at "Mail it" and
    //      got stuck. User feedback: "if a user is going through the
    //      sign up flow, then they shouldn't have already been signed
    //      up."
    //   b) User in build < 41 sent cards but the journal-overwrite race
    //      blew them away locally. Server has the rows but local
    //      `postcards` was stuck empty during this evaluation. Welcome
    //      showed again, INSUFFICIENT_CREDITS again, loop.
    //
    // New gate: if the user has completed signup server-side, they're
    // done with welcome forever. The "must send a card to enter the
    // app" enforcement was always client-side aspirational; the real
    // checkpoint is server-side profile creation. If they have 0
    // credits + 0 visible postcards, that's a "buy more stamps"
    // problem to solve inside the app shell, not a "redo welcome"
    // problem.
    const isReturningUser = !!authedUserId && hasCompletedSignup;
    if (isReturningUser) return false;

    return true;
  }, [
    hydrated,
    dismissedLocal,
    hasSeenFreeCreditsIntro,
    hasCompletedSignup,
    hasSentFirstCard,
    authedUserId,
  ]);

  // Latch the started flag the first time we decide to show.
  useEffect(() => {
    if (shouldShow && !hasStartedFlowRef.current) {
      hasStartedFlowRef.current = true;
      // Bump the render counter so any consumers downstream re-evaluate;
      // not strictly required for this component but keeps behavior
      // observable for tests + future refactors.
      forceRender((n) => n + 1);
    }
  }, [shouldShow]);

  if (!shouldShow) return null;

  return (
    <WelcomeSheet
      visible={true}
      onComplete={() => {
        // Reset the latch so a future sign-out → sign-in cycle can
        // re-trigger the flow if needed.
        hasStartedFlowRef.current = false;
        setDismissedLocal(true);
      }}
    />
  );
}
