/**
 * v0.7.0.49: hook for `prefers-reduced-motion`.
 *
 * Subscribes to iOS Reduce Motion / Android animator scale settings.
 * Returns `true` when motion should be minimized.
 *
 * Usage:
 * const reducedMotion = useReducedMotion();
 * const duration = reducedMotion ? 0 : 600;
 * opacity.value = withTiming(1, { duration });
 *
 * The audit found ZERO AccessibilityInfo checks across the app. Users
 * who enable Reduce Motion in Settings expected motion-respect from
 * any well-built iOS app. we weren't shipping that. Adding this now
 * so new animations honor it; older surfaces migrate when touched.
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReducedMotion(): boolean {
 const [reduced, setReduced] = useState<boolean>(false);

 useEffect(() => {
 let cancelled = false;
 AccessibilityInfo.isReduceMotionEnabled()
 .then((enabled) => {
 if (!cancelled) setReduced(enabled);
 })
 .catch(() => {
 /* defensive. old Android versions miss the API */
 });

 const sub = AccessibilityInfo.addEventListener(
 "reduceMotionChanged",
 (enabled) => setReduced(enabled),
 );
 return () => {
 cancelled = true;
 sub.remove();
 };
 }, []);

 return reduced;
}
