import { Mail } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Persistent stamp-balance pill for the right side of the Header.
 *
 * v0.7: replaced the 1¢-stamp tile + count combo (which read as two
 * numerals on a glance — "1¢ 3" looked like "13") with a clean envelope
 * icon + the count. One icon, one number, unambiguous.
 *
 * - Reads `credits` from MailClubContext so the count updates the moment a
 *   send completes or a purchase lands. No prop drilling.
 * - Owns its own CreditsSheet modal so any tab using <Header /> gets a
 *   one-tap path to buy stamps without screens wiring up state.
 * - Quiet visual: cream-paper pill, inked envelope, single number. Same
 *   serif-semibold treatment as the rest of the wordmark family.
 */
export function CreditsPill() {
  const { credits } = useMailClub();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${credits} ${credits === 1 ? "stamp" : "stamps"}. Tap to buy more.`}
        testID="header-credits-pill"
        hitSlop={8}
      >
        <Mail color={colors.ink} size={16} strokeWidth={1.8} />
        <Text style={styles.count}>{credits}</Text>
      </Pressable>
      <CreditsSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Alignment note: the envelope icon and the number must visually share a
// baseline. Lucide icons render via SVG (no font-padding) but React Native
// text adds top/bottom ascender padding by default. We compensate with
// lineHeight=icon-size + includeFontPadding=false. Both end up centered
// inside the pill with no manual nudges. If you change `iconSize`, change
// `count.lineHeight` to match.
const ICON_SIZE = 16;

const styles = StyleSheet.create({
  pill: {
    alignItems: "center",
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillPressed: { opacity: 0.6 },
  count: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 16,
    // v0.7.0.17: tightened lineHeight to match the icon glyph height so
    // the number's baseline lines up with the envelope. Previously
    // `ICON_SIZE + 4` gave the text 4px of extra leading that pushed the
    // numeral visually below center.
    includeFontPadding: false,
    lineHeight: ICON_SIZE,
    textAlign: "center",
    textAlignVertical: "center",
    minWidth: 12,
  },
});
