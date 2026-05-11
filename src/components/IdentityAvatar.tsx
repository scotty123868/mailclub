import { StyleSheet, Text, View } from "react-native";
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
 * known mock identities, initials disc for everyone else (including
 * post-signup real users).
 *
 * Replaces hardcoded `look="scotty"` everywhere — that worked when the user
 * was always "Scotty" but is misleading after a real user signs up as "Jamie".
 */
export function IdentityAvatar({
  user,
  size = 56,
}: {
  user: Pick<CurrentUser, "name" | "avatarInitials"> | Friend;
  size?: number;
}) {
  // Friends have an `id` field; current user does not. Use whichever is present.
  const id = "id" in user ? user.id : undefined;
  if (id && isKnownLook(id)) {
    return <IllustratedAvatar look={id} size={size} />;
  }
  // Use initials from the user record, fall back to name initials.
  const fromName = user.name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const initials = ("avatarInitials" in user ? user.avatarInitials : "") || fromName || "?";
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }]} accessibilityLabel={`${user.name || "Mail Club member"} avatar`}>
      <Text style={[styles.text, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { alignItems: "center", backgroundColor: colors.ink, borderColor: colors.white, borderWidth: 2, justifyContent: "center" },
  text: { color: colors.white, fontFamily: fonts.serifSemi, letterSpacing: 0.5 },
});
