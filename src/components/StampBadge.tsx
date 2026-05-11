import { Stamp } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function StampBadge({ count, label = "credits available" }: { count: number; label?: string }) {
  return (
    <View style={styles.badge}>
      <Stamp color={colors.postalRed} size={20} strokeWidth={1.4} />
      <Text style={styles.text}>{count} {label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  text: { color: colors.ink, fontFamily: fonts.serif, fontSize: 18 },
});
