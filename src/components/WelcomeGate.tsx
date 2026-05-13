import { useState } from "react";
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
  } = useMailClub();
  const [dismissedLocal, setDismissedLocal] = useState(false);

  if (!hydrated) return null;
  // v0.7: three-flag gate. All must be true to enter the app.
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
