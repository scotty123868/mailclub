import { useState } from "react";
import { WelcomeSheet } from "@/src/components/WelcomeSheet";
import { useMailClub } from "@/src/state/MailClubContext";

/**
 * Shows the WelcomeSheet on first launch and any time the user is in a
 * not-fully-signed-up state. Mounts as a global overlay above the tab
 * navigator.
 *
 * codex Phase 6 P1: previously this gated solely on `hasSeenFreeCreditsIntro`.
 * A partially-onboarded user whose intro-seen flag was true but profile was
 * incomplete (`hasCompletedSignup === false`) would bypass the welcome
 * sheet AND be unable to use the app meaningfully. Gate on BOTH now: the
 * sheet shows if either condition is false.
 *
 * CRITICAL: We wait for `hydrated === true` before rendering the sheet.
 * Without this, returning users see the welcome flash on every cold launch
 * because both flags default to false until AsyncStorage resolves.
 */
export function WelcomeGate() {
  const { hasSeenFreeCreditsIntro, hasCompletedSignup, hydrated } = useMailClub();
  const [dismissedLocal, setDismissedLocal] = useState(false);

  if (!hydrated) return null;
  // Show the sheet whenever the user hasn't fully onboarded. This covers:
  //   - First launch (both flags false)
  //   - Incomplete signup (hasCompletedSignup false, intro maybe true)
  //   - dismissedLocal escape hatch for within-session dismissal of the
  //     intro-only path
  const fullyOnboarded = hasSeenFreeCreditsIntro && hasCompletedSignup;
  if (fullyOnboarded || dismissedLocal) return null;

  return (
    <WelcomeSheet
      visible={true}
      onComplete={() => setDismissedLocal(true)}
    />
  );
}
