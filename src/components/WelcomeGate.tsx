import { useEffect, useMemo, useRef, useState } from "react";
import { WelcomeSheet } from "@/src/components/WelcomeSheet";
import { useMailClub } from "@/src/state/MailClubContext";

/**
 * WelcomeGate. global overlay that shows the WelcomeSheet whenever the
 * user isn&apos;t fully onboarded.
 *
 * v0.7 contract: a user is "fully onboarded" iff ALL THREE are true:
 * 1. hasSeenFreeCreditsIntro (saw the intro page)
 * 2. hasCompletedSignup (profile row exists server-side)
 * 3. hasSentFirstCard (mailed or queued a card via send-link)
 *
 * The third flag is the v0.7 keystone: the forced signup→send flow does
 * NOT let users into the app until they&apos;ve mailed something.
 *
 * v0.7.0.25. celebration race fix.
 *
 * Before: the `isReturningUser` hatch (any authenticated user with at
 * least one server-side postcard) short-circuited rendering. The bug:
 * `sendPostcardViaLinkAction` refreshes postcards BEFORE the WelcomeSheet
 * advances to MailedStep ("Your card is on its way" celebration). That
 * means the moment a first-time user sent their first card, the hatch
 * fired and unmounted the welcome flow. MailedStep (with its envelope-
 * balloon animation, Share sheet auto-open for link mode, and the
 * "Done" button) was destroyed mid-mount, the user got dropped straight
 * into the app shell with no celebration and no Share prompt.
 *
 * Fix: latch a `hasStartedFlow` flag on first mount. Once the WelcomeSheet
 * is showing, only the explicit `dismissedLocal` flag (set when MailedStep
 * fires onComplete) can dismiss it. The isReturningUser hatch still
 * applies, but only for the initial mount decision. once the user is
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
 // session. kept the gate closed even though the user was now
 // unauthenticated, stranding them on My Card. Reset the local
 // dismissal whenever any onboarding flag flips false.
 //
 // v0.7.0.53 BUGFIX (sign-in-after-sign-out loop):
 // Also reset hasStartedFlowRef. Previously the latch stayed true after
 // sign-out, so the returning-user hatch below couldn't fire. a user
 // who signed out and signed back in with the SAME Apple ID was
 // shown the signup flow every time (their hasCompletedSignup did
 // eventually flip to true server-side, but the latch held the sheet
 // open until they dismissed manually).
 useEffect(() => {
 if (!hasCompletedSignup || !hasSentFirstCard || !hasSeenFreeCreditsIntro) {
 setDismissedLocal(false);
 hasStartedFlowRef.current = false;
 forceRender((n) => n + 1);
 }
 }, [hasCompletedSignup, hasSentFirstCard, hasSeenFreeCreditsIntro]);

 // Decide whether to mount the WelcomeSheet. Memoized so the JSX below
 // stays simple. The two-phase logic. "should we START the flow" vs
 // "are we already showing it". is the whole shape of the race fix.
 const shouldShow = useMemo(() => {
 if (!hydrated) return false;
 if (dismissedLocal) return false;

 // v1.0.6 (production audit): once the flow has started, keep
 // showing the WelcomeSheet until it explicitly completes (via
 // onComplete → setDismissedLocal(true)) OR the user signs out
 // (the reset effect above clears the latch). Without this gate,
 // hasSentFirstCard flipping to true mid-send (because sendPostcard
 // succeeded, Realtime pushed the row back, hasSentFirstCard memo
 // recomputed) caused WelcomeSheet to unmount BEFORE the Lob
 // handoff completed. orphaning the postcard with status=sent and
 // lob_id=null. The orphan-retry UI then appeared the moment the
 // user opened the app, ruining the first-postcard experience.
 if (hasStartedFlowRef.current) return true;

 const fullyOnboarded =
 hasSeenFreeCreditsIntro && hasCompletedSignup && hasSentFirstCard;
 if (fullyOnboarded) return false;

 // v0.7.0.53 BUGFIX: returning-user hatch must run BEFORE the latch
 // check, otherwise a user who signs out + signs back in still sees
 // the signup flow (the latch was set during the pre-auth render).
 const isReturningUser = !!authedUserId && hasCompletedSignup;
 if (isReturningUser) return false;

 // v0.7.0.53: the returning-user hatch + latch check were duplicated
 // here from above (where they now live, so they run BEFORE the latch
 // can hold the sheet open through a sign-out → sign-in cycle).
 // Reaching this point means we should show the welcome flow.
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
