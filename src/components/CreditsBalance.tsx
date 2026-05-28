import { Plus, Stamp } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function CreditsBalance({
 count,
 onPressBuy,
 compact = false,
 tone = "default",
}: {
 count: number;
 onPressBuy?: () => void;
 compact?: boolean;
 tone?: "default" | "warn";
}) {
 const isWarn = tone === "warn";
 return (
 <View
 style={[styles.pill, compact && styles.pillCompact, isWarn && styles.pillWarn]}
 accessibilityLabel={`${count} credit${count === 1 ? "" : "s"} available`}
 >
 <Stamp color={isWarn ? colors.postalRed : colors.postalBlue} size={compact ? 16 : 20} strokeWidth={1.4} />
 <Text style={[styles.text, compact && styles.textCompact, isWarn && styles.textWarn]}>
 {count} {count === 1 ? "credit" : "credits"}
 </Text>
 {onPressBuy ? (
 <Pressable
 onPress={onPressBuy}
 style={[styles.buyBtn, isWarn && styles.buyBtnWarn]}
 testID="credits-buy-btn"
 accessibilityRole="button"
 accessibilityLabel="Buy more credits"
 >
 <Plus color={colors.white} size={14} strokeWidth={2} />
 <Text style={styles.buyText}>Buy</Text>
 </Pressable>
 ) : null}
 </View>
 );
}

const styles = StyleSheet.create({
 pill: { alignItems: "center", borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 10, padding: 12 },
 pillCompact: { padding: 8 },
 pillWarn: { backgroundColor: "rgba(184,74,58,0.06)", borderColor: "rgba(184,74,58,0.35)" },
 text: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 18 },
 textCompact: { fontSize: 14 },
 textWarn: { color: colors.postalRed, fontFamily: fonts.serifSemi },
 buyBtn: { alignItems: "center", backgroundColor: colors.ink, borderRadius: 6, flexDirection: "row", gap: 4, paddingHorizontal: 10, paddingVertical: 6 },
 buyBtnWarn: { backgroundColor: colors.postalRed },
 buyText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 12, letterSpacing: 0.5 },
});
