import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Persistent stamp-balance pill for the right side of the Header.
 *
 * - Reads `credits` from MailClubContext so the count updates the moment a
 *   send completes (or a purchase lands) — no prop drilling.
 * - Owns its own CreditsSheet modal so any tab that uses <Header /> gets
 *   a one-tap path to buy stamps without each screen needing to wire up
 *   state for the sheet.
 * - Quiet visual: small cream-paper pill with a 1¢-red stamp tile + the
 *   number. Not a flashy gold badge — information, not pressure.
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
        <View style={styles.stampTile}>
          <Text style={styles.stampDenom}>1¢</Text>
        </View>
        <Text style={styles.count}>{credits}</Text>
      </Pressable>
      <CreditsSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Geometry note: the stamp tile and count text both want to sit centered on
// the same horizontal line. RN text has implicit top/bottom padding ("font
// padding" on Android, ascender/descender on iOS) so we can't just match
// fontSize to tile height and hope. The reliable pattern: set lineHeight to
// match the tile height, set includeFontPadding=false (Android), and use
// textAlignVertical: center. Then drop the count's minWidth/textAlign quirks
// that were nudging it off-center.
const TILE_H = 22;

const styles = StyleSheet.create({
  pill: {
    alignItems: "center",
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pillPressed: { opacity: 0.6 },
  stampTile: {
    alignItems: "center",
    backgroundColor: colors.postalRed,
    borderRadius: 3,
    height: TILE_H,
    justifyContent: "center",
    width: 18,
  },
  stampDenom: {
    color: colors.white,
    fontFamily: fonts.serifSemi,
    fontSize: 10,
    includeFontPadding: false,
    letterSpacing: -0.4,
    lineHeight: TILE_H,
    textAlign: "center",
    textAlignVertical: "center",
  },
  count: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 16,
    includeFontPadding: false,
    lineHeight: TILE_H,
    textAlign: "center",
    textAlignVertical: "center",
  },
});
