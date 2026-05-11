import { useState } from "react";
import { WelcomeSheet } from "@/src/components/WelcomeSheet";
import { useMailClub } from "@/src/state/MailClubContext";

/**
 * Shows the WelcomeSheet on first launch (when hasSeenFreeCreditsIntro is false).
 * Mounts as a global overlay above the tab navigator. After the user submits
 * or skips, the flag is persisted and the sheet stays dismissed across launches.
 */
export function WelcomeGate() {
  const { hasSeenFreeCreditsIntro } = useMailClub();
  const [dismissedLocal, setDismissedLocal] = useState(false);

  if (hasSeenFreeCreditsIntro || dismissedLocal) return null;

  return (
    <WelcomeSheet
      visible={true}
      onComplete={() => setDismissedLocal(true)}
    />
  );
}
