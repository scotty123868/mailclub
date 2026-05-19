import { Image, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { CurrentUser, Friend } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { emojiForFriendId } from "@/src/lib/friendEmoji";

/**
 * v0.7.0.51: avatars are now PHOTO → EMOJI → MONOGRAM in that priority.
 *
 *   1. Photo: round-cropped, postal-blue rim. Wins always.
 *   2. Emoji (Friend without photo): deterministic emoji from the
 *      friend id hashed into a curated pool. Same friend always shows
 *      the same emoji. Replaces the old IllustratedAvatar path which
 *      silently rendered everyone with unknown ids using the Sam
 *      palette — every new friend looked identical (build 63 bug).
 *   3. Monogram (CurrentUser or Friend with no id): paper-toned disc
 *      with serif initials + paper grain. Preserves the existing
 *      "embossed monogram on letterhead" feel for the user's own
 *      identity before they set a photo.
 */
export function IdentityAvatar({
  user,
  size = 56,
  variant = "default",
}: {
  user: Pick<CurrentUser, "name" | "avatarInitials" | "photoUrl"> | Friend;
  size?: number;
  variant?: "default" | "hero";
}) {
  const isHero = variant === "hero";
  const borderWidth = isHero ? 2 : 1.5;

  // 1. Real photo wins, if one is set. Round-cropped, postal-blue rim.
  if (user.photoUrl) {
    return (
      <View
        style={[
          styles.disc,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth,
            backgroundColor: colors.paperDark,
          },
        ]}
        accessibilityLabel={`${user.name || "Mailroom member"} profile photo`}
      >
        <Image
          source={{ uri: user.photoUrl }}
          style={{ width: size - borderWidth * 2, height: size - borderWidth * 2, borderRadius: (size - borderWidth * 2) / 2 }}
          accessible={false}
        />
        {isHero && (
          <View style={[styles.heroRing, { width: size - 10, height: size - 10, borderRadius: (size - 10) / 2 }]} />
        )}
      </View>
    );
  }

  // 2. Friend without photo → emoji on paper. Deterministic from the
  // friend id, so the same person always shows the same emoji.
  const friendId = "id" in user ? user.id : undefined;
  if (friendId) {
    const emoji = emojiForFriendId(friendId);
    const emojiSize = size * (isHero ? 0.5 : 0.55);
    return (
      <View
        style={[
          styles.disc,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth,
          },
        ]}
        accessibilityLabel={`${user.name || "Mailroom member"} avatar`}
      >
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Defs>
            <Pattern id={`emoji-grain-${friendId}-${size}`} patternUnits="userSpaceOnUse" width={4} height={4}>
              <Rect width={4} height={4} fill={colors.paperDark} />
              <Circle cx={1} cy={1} r={0.4} fill="#D8C19A" opacity={0.45} />
              <Circle cx={3} cy={3} r={0.3} fill="#D8C19A" opacity={0.3} />
            </Pattern>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={`url(#emoji-grain-${friendId}-${size})`} />
        </Svg>
        {isHero && (
          <View style={[styles.heroRing, { width: size - 10, height: size - 10, borderRadius: (size - 10) / 2 }]} />
        )}
        <Text
          style={[styles.emoji, { fontSize: emojiSize, lineHeight: emojiSize * 1.1 }]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {emoji}
        </Text>
      </View>
    );
  }

  // 3. CurrentUser without photo → monogram on paper.
  const fromName = user.name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const initials = ("avatarInitials" in user ? user.avatarInitials : "") || fromName || "?";

  const fontSize = size * (isHero ? 0.32 : 0.36);

  return (
    <View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth,
        },
      ]}
      accessibilityLabel={`${user.name || "Mailroom member"} monogram`}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern id={`grain-${initials}-${size}`} patternUnits="userSpaceOnUse" width={4} height={4}>
            <Rect width={4} height={4} fill={colors.paperDark} />
            <Circle cx={1} cy={1} r={0.4} fill="#D8C19A" opacity={0.45} />
            <Circle cx={3} cy={3} r={0.3} fill="#D8C19A" opacity={0.3} />
          </Pattern>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={`url(#grain-${initials}-${size})`} />
      </Svg>
      {isHero && (
        <View style={[styles.heroRing, { width: size - 10, height: size - 10, borderRadius: (size - 10) / 2 }]} />
      )}
      <Text style={[styles.text, { fontSize, lineHeight: fontSize * 1.05 }]} numberOfLines={1}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: "center",
    backgroundColor: colors.paperDark,
    borderColor: "rgba(60,110,143,0.45)",
    justifyContent: "center",
    overflow: "hidden",
  },
  heroRing: {
    borderColor: "rgba(60,110,143,0.18)",
    borderWidth: 1,
    position: "absolute",
  },
  text: {
    color: colors.ink,
    fontFamily: fonts.serifBold,
    letterSpacing: 1.5,
  },
  emoji: {
    // System font — Apple Color Emoji renders as the glyph regardless.
    textAlign: "center",
  },
});
