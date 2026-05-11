import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { IllustratedAvatar, AvatarLook } from "@/src/components/Avatar";
import { CurrentUser, Friend } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const KNOWN_LOOKS: AvatarLook[] = ["scotty", "tatiana", "alex", "maya", "nora", "ben", "sam"];

function isKnownLook(id: string): id is AvatarLook {
  return (KNOWN_LOOKS as string[]).includes(id);
}

/**
 * Picks the right visual for the current user: illustrated portrait for the
 * known mock identities, monogram-on-parchment for everyone else.
 *
 * The fallback is a paper-toned disc with serif initials and a faint inner
 * grain — meant to feel like an embossed monogram on letterhead, not a flat
 * dark mugshot. Designed to match the postal vocabulary rather than fight it.
 */
export function IdentityAvatar({
  user,
  size = 56,
  variant = "default",
}: {
  user: Pick<CurrentUser, "name" | "avatarInitials"> | Friend;
  size?: number;
  variant?: "default" | "hero";
}) {
  const id = "id" in user ? user.id : undefined;
  if (id && isKnownLook(id)) {
    return <IllustratedAvatar look={id} size={size} />;
  }

  const fromName = user.name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const initials = ("avatarInitials" in user ? user.avatarInitials : "") || fromName || "?";

  const isHero = variant === "hero";
  // Hero variant is larger + a touch more decorated. Default is compact + flat.
  const fontSize = size * (isHero ? 0.32 : 0.36);
  const borderWidth = isHero ? 2 : 1.5;

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
      accessibilityLabel={`${user.name || "Mail Club member"} monogram`}
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
});
