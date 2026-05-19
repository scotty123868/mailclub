import { Easing } from "react-native-reanimated";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts, type } from "@/src/theme/typography";

const HERO_ENVELOPE_BALLOON = require("@/assets/onboarding/hero-envelope-balloon.jpg");
const MAILED_STAGE = 340;

/**
 * CelebrationOverlay — global "your card is on its way" celebration.
 *
 * v0.7.0.26 addition. Subscribes to MailClubContext.celebration. When
 * set (typically by the WelcomeSheet link path AFTER the iOS share
 * sheet returns with action=sharedAction, OR by a future "send from
 * the main app" flow), renders the envelope-balloon animation as a
 * fullScreen modal above the tab bar.
 *
 * Why this exists outside the WelcomeSheet:
 *   - iOS blocks UIActivityViewController from presenting over a
 *     fullScreen modal. Welcome's MailedStep used to dismiss itself
 *     before firing Share.share — meaning the user saw the celebration
 *     BEFORE they actually shared, which was misleading (especially if
 *     they then cancelled the share sheet — celebration lied).
 *   - Moving the celebration here lets the welcome flow dismiss first,
 *     fire Share.share, and only trigger the celebration on confirmed
 *     send completion. The animation now fires after the actual share.
 *
 * Reuses the same visual language as MailedStep in WelcomeSheet (same
 * hero image, similar timings, same MAILED stamp). Kept here as a
 * separate component because (a) it's a global overlay not a step,
 * and (b) sharing animation code between the welcome and the overlay
 * would require lifting shared values into a hook and adds friction
 * for ~150 LOC of straight animation declaration.
 */
export function CelebrationOverlay() {
  const { celebration, hideCelebration } = useMailClub();
  return (
    <Modal
      visible={!!celebration}
      animationType="fade"
      transparent={false}
      presentationStyle="fullScreen"
      onRequestClose={hideCelebration}
    >
      {celebration ? (
        <CelebrationContent
          kind={celebration.kind}
          recipientName={celebration.recipientName}
          onDismiss={hideCelebration}
        />
      ) : null}
    </Modal>
  );
}

function CelebrationContent({
  kind,
  recipientName,
  onDismiss,
}: {
  kind: "link" | "friend" | "self" | "penpal";
  recipientName?: string;
  onDismiss: () => void;
}) {
  const heroScale = useSharedValue(0.85);
  const heroOpacity = useSharedValue(0);
  const heroTranslateY = useSharedValue(80);
  const heroBob = useSharedValue(0);
  const heroSway = useSharedValue(0);
  const stampScale = useSharedValue(0);
  const stampRotate = useSharedValue(-22);
  const captionOpacity = useSharedValue(0);
  const captionTranslateY = useSharedValue(12);

  useEffect(() => {
    heroOpacity.value = withTiming(1, { duration: 500 });
    heroTranslateY.value = withTiming(0, {
      duration: 700,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
    heroScale.value = withTiming(1, {
      duration: 700,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
    // Calmed bob/sway — matches the polish landed in build 39 for
    // WelcomeSheet's MailedStep. Slow breathing, not bouncing.
    heroBob.value = withDelay(
      700,
      withRepeat(
        withSequence(
          withTiming(-4, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
          withTiming(4, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );
    heroSway.value = withDelay(
      700,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
          withTiming(-1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );
    stampScale.value = withDelay(
      800,
      withTiming(1, {
        duration: 320,
        easing: Easing.bezier(0.34, 1.7, 0.5, 1),
      }),
    );
    stampRotate.value = withDelay(800, withTiming(-12, { duration: 320 }));
    captionOpacity.value = withDelay(1100, withTiming(1, { duration: 400 }));
    captionTranslateY.value = withDelay(1100, withTiming(0, { duration: 400 }));
  }, [
    heroOpacity,
    heroScale,
    heroTranslateY,
    heroBob,
    heroSway,
    stampScale,
    stampRotate,
    captionOpacity,
    captionTranslateY,
  ]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [
      { translateY: heroTranslateY.value + heroBob.value },
      { rotate: `${heroSway.value}deg` },
      { scale: heroScale.value },
    ],
  }));
  const stampStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: stampScale.value },
      { rotate: `${stampRotate.value}deg` },
    ],
  }));
  const captionStyle = useAnimatedStyle(() => ({
    opacity: captionOpacity.value,
    transform: [{ translateY: captionTranslateY.value }],
  }));

  const recipientLabel = recipientName?.trim() || (kind === "self" ? "you" : "your friend");
  // v0.7.0.49: penpal copy was misleading — said "Sent into the void.
  // A Mailroom recipient picks it up." Implied the card was already mailed.
  // Today the postcard inserts with to_profile_id=null and waits in a
  // matching queue. Honest copy tells the user we're searching.
  const title =
    kind === "link"
      ? "Link sent."
      : kind === "self"
        ? "See you in the mailbox."
        : kind === "penpal"
          ? "Finding you a pen pal..."
          : "Your card is on its way.";
  const subtitle =
    kind === "link"
      ? "Once they tap the link and share their address, we'll print and ship your card."
      : kind === "self"
        ? "USPS time, 4-7 days. We'll drop a pin on your map when it lands."
        : kind === "penpal"
          ? "We'll match your card with another Mailroom user looking for a stranger letter. You'll see it in your journal once it ships, and on your map when they reply."
          : `${recipientLabel} gets it in 4-7 days, USPS time. We'll drop a pin on your map when it lands.`;
  const buttonLabel = "Open Mailroom →";

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <Animated.View style={[styles.heroFrame, heroStyle]}>
          <Image
            source={HERO_ENVELOPE_BALLOON}
            style={styles.heroImage}
            resizeMode="cover"
          />
        </Animated.View>
        <Animated.View style={[styles.stamp, stampStyle]} pointerEvents="none">
          <Text style={styles.stampText}>MAILED</Text>
        </Animated.View>
      </View>
      <Animated.View style={captionStyle}>
        <Text style={styles.kicker}>YOUR CARD IS ON ITS WAY</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </Animated.View>
      <Pressable
        onPress={onDismiss}
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel="Open Mailroom"
        testID="celebration-dismiss-btn"
      >
        <Text style={styles.buttonText}>{buttonLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  stage: {
    width: MAILED_STAGE,
    height: MAILED_STAGE,
    marginBottom: 20,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  heroFrame: {
    width: MAILED_STAGE,
    height: MAILED_STAGE,
    borderRadius: 18,
    overflow: "hidden",
    shadowColor: colors.shadow,
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
  },
  heroImage: { width: "100%", height: "100%" },
  stamp: {
    position: "absolute",
    bottom: 14,
    right: -6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 4,
    borderColor: colors.postalRed,
    borderRadius: 6,
    backgroundColor: "rgba(255,253,247,0.92)",
    shadowColor: colors.postalRed,
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
  stampText: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 24,
    letterSpacing: 4,
  },
  kicker: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.6,
    marginTop: 30,
    textAlign: "center",
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: type.title,
    letterSpacing: -0.4,
    lineHeight: type.title + 4,
    textAlign: "center",
    marginTop: 6,
  },
  subtitle: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 12,
    maxWidth: 320,
  },
  button: {
    marginTop: 28,
    backgroundColor: colors.ink,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  buttonText: {
    color: colors.paper,
    fontFamily: fonts.serifSemi,
    fontSize: 16,
    letterSpacing: 0.2,
  },
});
