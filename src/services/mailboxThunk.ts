/**
 * mailboxThunk. the haptic pattern that fires on a successful card mail.
 *
 * v0.7 D.5 magical moment: replaces the bland Haptics.NotificationFeedbackType.Success
 * "ding" with a layered thud-then-tap pattern that physically feels like
 * dropping a card into a mailbox: heavy impact (the lid swings shut),
 * brief pause, light impact (the card lands at the bottom). ~120ms total.
 *
 * Async + non-blocking. Callers should fire-and-forget. never await
 * this since it inserts a delay. Wrapped in try/catch so simulator runs
 * without a haptic engine don&apos;t throw.
 *
 * Sound layer (the actual .wav) lands in v0.7.1 once we have an audio
 * asset to load via expo-av. For v0.7.0.2, haptic-only is the ship.
 */

import * as Haptics from "expo-haptics";

const PAUSE_MS = 80;

export function mailboxThunk(): void {
 // Fire the thud → pause → tap pattern. Best-effort. any error from
 // a simulator without a haptic engine is silently absorbed.
 (async () => {
 try {
 await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
 } catch { /* simulator */ }
 await new Promise((r) => setTimeout(r, PAUSE_MS));
 try {
 await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
 } catch { /* simulator */ }
 })();
}

/**
 * mailboxWarn. softer two-tap pattern for "couldn&apos;t mail" cases
 * (insufficient credits, network error). Distinct from the success
 * thunk so users can feel the difference without seeing the screen.
 */
export function mailboxWarn(): void {
 (async () => {
 try {
 await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
 } catch { /* simulator */ }
 })();
}
