import { Pressable, StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  useDerivedValue,
} from "react-native-reanimated";
import { ReactNode, useCallback, useImperativeHandle, forwardRef, useRef, useState } from "react";

/**
 * FlipCard — postcard-style card that flips 180° in 3D when tapped.
 *
 * The interaction this is built for:
 *   • Postcard front shows a photo.
 *   • Tap it. The card flips horizontally on its long axis.
 *   • Now you see the back, where you can write a note.
 *   • Tap again, flips back to the photo.
 *
 * Implementation notes:
 *   • Single shared rotation drives both faces; back gets +180° offset.
 *   • `backfaceVisibility: hidden` would be the right call on iOS native, but
 *     RN's RN-Reanimated does not always honor it cross-platform on Android.
 *     We use opacity stepping instead: the front fades to 0 at 90°, the back
 *     fades in from 0 at 90°. That avoids both faces showing simultaneously.
 *   • Animation is 600ms with a soft cubic ease — feels like a paper card,
 *     not a flat UI toggle.
 *   • The wrapper preserves its natural height (the front + back are
 *     absolutely positioned over each other). Caller controls width/height
 *     via the `style` prop or by passing front + back at fixed dimensions.
 */
export type FlipCardHandle = {
  flip: () => void;
  flipTo: (face: "front" | "back") => void;
  getFace: () => "front" | "back";
};

type Props = {
  front: ReactNode;
  back: ReactNode;
  /** Optional callback fired AFTER each flip completes. */
  onFlipComplete?: (face: "front" | "back") => void;
  /** Disable tap-to-flip if the caller wants imperative control only. */
  disableTap?: boolean;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
};

export const FlipCard = forwardRef<FlipCardHandle, Props>(function FlipCard(
  { front, back, onFlipComplete, disableTap = false, style, testID },
  ref,
) {
  // Visible face. Truth source for pointerEvents, getFace(), and a11y label.
  // We update this from the animation's `finished` callback (via runOnJS) so
  // it stays accurate for the full 600ms of the flip — previously it was set
  // synchronously and lied about which face was visible mid-animation, which
  // broke pointer routing and the screen reader.
  const [face, setFace] = useState<"front" | "back">("front");
  // Mirror of `face` that the imperative handle can read synchronously
  // between renders. `face` doesn't update until React commits, so chained
  // flipTo() calls would race against pending animations without this.
  const faceRef = useRef<"front" | "back">("front");
  // Track the in-flight target so `flipTo()` can short-circuit duplicates
  // before they kick off a new withTiming.
  const targetRef = useRef<"front" | "back">("front");
  // 0 = front showing, 1 = back showing. Drives the rotation directly.
  const progress = useSharedValue(0);

  // onFinish runs on the JS thread via runOnJS. We can safely set React
  // state and call the caller's prop here. The callback receives the
  // animation's `finished` flag — false means an interrupting flip
  // cancelled this one mid-way, in which case the LATER animation's
  // callback is what counts.
  const onFinish = useCallback((targetFace: "front" | "back", finished: boolean) => {
    if (!finished) return; // a newer flip will set the state
    faceRef.current = targetFace;
    setFace(targetFace);
    onFlipComplete?.(targetFace);
  }, [onFlipComplete]);

  function doFlip(toBack: boolean) {
    const targetFace: "front" | "back" = toBack ? "back" : "front";
    const target = toBack ? 1 : 0;
    targetRef.current = targetFace;
    progress.value = withTiming(
      target,
      { duration: 600, easing: Easing.bezier(0.25, 0.1, 0.25, 1) },
      (finished) => {
        // `finished` is a worklet boolean. Hop back to the JS thread to
        // mutate React state safely. Pass the target through so the
        // callback knows which face we just landed on.
        runOnJS(onFinish)(targetFace, !!finished);
      },
    );
  }

  useImperativeHandle(ref, () => ({
    // Toggle relative to the CURRENT TARGET, not the visible face. If we're
    // mid-flip heading to back, flip() should reverse to front — not no-op
    // because the visible face is still "front."
    flip: () => doFlip(targetRef.current === "front"),
    flipTo: (next) => {
      // Short-circuit redundant flips. Either we're already on `next` or
      // an animation in flight is already heading there.
      if (next === faceRef.current && next === targetRef.current) return;
      if (next === targetRef.current) return; // mid-flip toward `next`
      doFlip(next === "back");
    },
    getFace: () => faceRef.current,
  }), []);

  const rotation = useDerivedValue(() =>
    interpolate(progress.value, [0, 1], [0, 180]),
  );

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1400 },
      { rotateY: `${rotation.value}deg` },
    ],
    // Hide the front once we cross the halfway point of the flip.
    opacity: progress.value < 0.5 ? 1 : 0,
  }));

  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1400 },
      { rotateY: `${rotation.value + 180}deg` },
    ],
    opacity: progress.value >= 0.5 ? 1 : 0,
  }));

  const Wrapper: any = disableTap ? View : Pressable;
  const wrapperProps = disableTap
    ? {}
    : {
        // Tap reverses the CURRENT TARGET so mid-flip taps correctly
        // reverse direction instead of re-issuing the same flip (which
        // would no-op since targetRef already matches).
        onPress: () => doFlip(targetRef.current === "front"),
        accessibilityRole: "button",
        // The a11y label tracks the VISIBLE face (post-animation), which
        // is what a screen reader user sees — not the in-flight target.
        accessibilityLabel: face === "front" ? "Flip to back" : "Flip to front",
      };

  return (
    <Wrapper {...wrapperProps} testID={testID ?? "flip-card"} style={[styles.wrap, style]}>
      <Animated.View style={[styles.face, frontStyle]} pointerEvents={face === "front" ? "auto" : "none"}>
        {front}
      </Animated.View>
      <Animated.View style={[styles.face, backStyle, styles.backFace]} pointerEvents={face === "back" ? "auto" : "none"}>
        {back}
      </Animated.View>
    </Wrapper>
  );
});

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  face: { backfaceVisibility: "hidden" },
  backFace: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
});
