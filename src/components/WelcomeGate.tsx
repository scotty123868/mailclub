import { useState } from "react";
import { WelcomeSheet } from "@/src/components/WelcomeSheet";
import { useMailClub } from "@/src/state/MailClubContext";

/**
 * Shows the WelcomeSheet on first launch (when hasSeenFreeCreditsIntro is false).
 * Mounts as a global overlay above the tab navigator. After the user submits
 * or skips, the flag is persisted and the sheet stays dismissed across launches.
 *
 * CRITICAL: We wait for `hydrated === true` before rendering the sheet.
 * Without this, returning users see the welcome flash on every cold launch
 * because hasSeenFreeCreditsIntro defaults to false until AsyncStorage resolves.
 */
export function WelcomeGate() {
  const { hasSeenFreeCreditsIntro, hydrated } = useMailClub();
  const [dismissedLocal, setDismissedLocal] = useState(false);

  if (!hydrated) return null;
  if (hasSeenFreeCreditsIntro || dismissedLocal) return null;

  return (
    <WelcomeSheet
      visible={true}
      onComplete={() => setDismissedLocal(true)}
    />
  );
}
