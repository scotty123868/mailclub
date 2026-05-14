import { useEffect, useState } from "react";
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
 * NOT let users into the app until they&apos;ve mailed something. If any
 * of the three are false, the welcome sheet stays mounted.
 *
 * codex Phase 6 P1: previously this gated solely on `hasSeenFreeCreditsIntro`,
 * which would bypass returning-but-incomplete users straight into the
 * empty shell of the app.
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
    postcards,
  } = useMailClub();
  const [dismissedLocal, setDismissedLocal] = useState(false);

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

  if (!hydrated) return null;

  // v0.7.0.23: returning-user escape hatch.
  //
  // hasSentFirstCard is client-side only (AsyncStorage). When a user
  // signs out, reinstalls, or installs a new build, that flag resets
  // to false even though their server-side profile + postcards exist.
  // Without this hatch, returning users get force-funneled through the
  // welcome flow AGAIN, hit "INSUFFICIENT_CREDITS" because they already
  // spent their free credits in the previous session, and dead-end.
  //
  // If the user is authenticated AND has at least one postcard on the
  // server (proves they've sent before), they're a returning user.
  // Welcome flow doesn't apply. Let them in.
  const hasAnyServerPostcards = !!authedUserId && postcards.length > 0;
  const isReturningUser =
    !!authedUserId && hasCompletedSignup && hasAnyServerPostcards;

  if (isReturningUser) return null;

  // Original 3-flag gate for genuinely new users.
  const fullyOnboarded =
    hasSeenFreeCreditsIntro && hasCompletedSignup && hasSentFirstCard;
  if (fullyOnboarded || dismissedLocal) return null;

  return (
    <WelcomeSheet
      visible={true}
      onComplete={() => setDismissedLocal(true)}
    />
  );
}
