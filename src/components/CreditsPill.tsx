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

const styles = StyleSheet.create({
  pill: {
    alignItems: "center",
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  pillPressed: { opacity: 0.6 },
  stampTile: {
    alignItems: "center",
    backgroundColor: colors.postalRed,
    borderRadius: 3,
    height: 20,
    justifyContent: "center",
    width: 16,
  },
  stampDenom: {
    color: colors.white,
    fontFamily: fonts.serifSemi,
    fontSize: 9,
    letterSpacing: -0.4,
  },
  count: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 16,
    marginRight: 2,
    minWidth: 14,
    textAlign: "center",
  },
});
