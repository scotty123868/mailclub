import { Mail } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
        {/* v0.7.0.18: wrap both glyphs in explicit ICON_SIZE-tall boxes so
            they share an identical bounding height. iOS Text adds ascender
            padding that flex-center can't strip, so lineHeight alone wasn't
            enough — the "3" sat a hair below the envelope. Forcing equal
            height + justifyContent: center pins the optical centers. */}
        <View style={styles.glyphBox}>
          <Mail color={colors.ink} size={ICON_SIZE} strokeWidth={1.8} />
        </View>
        <View style={styles.glyphBox}>
          <Text style={styles.count}>{credits}</Text>
        </View>
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
  // v0.7.0.18: shared bounding box. Both the envelope SVG and the number
  // Text live in identical ICON_SIZE-tall boxes that center their content.
  // This is the only way to get pixel-level visual alignment between an
  // SVG glyph and a Text glyph on iOS — flex alignItems on the parent
  // alone uses different baselines for each child type.
  glyphBox: {
    alignItems: "center",
    height: ICON_SIZE,
    justifyContent: "center",
    minWidth: 12,
  },
  count: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 15,
    includeFontPadding: false,
    lineHeight: ICON_SIZE,
    textAlign: "center",
  },
});
