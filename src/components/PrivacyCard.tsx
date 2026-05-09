import { ShieldCheck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";

export function PrivacyCard() {
  return (
    <PostalCard style={styles.card}>
      <View style={styles.icon}><ShieldCheck color={colors.ink} size={24} strokeWidth={1.5} /></View>
      <View style={styles.copy}>
        <Text style={styles.title}>Addresses stay private.</Text>
        <Text style={styles.body}>Friends can send mail without seeing your full address.</Text>
      </View>
    </PostalCard>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", flexDirection: "row", gap: 15, padding: 18 },
  icon: { alignItems: "center", backgroundColor: colors.paperDark, borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  copy: { flex: 1 },
  title: { color: colors.ink, fontFamily: fonts.serif, fontSize: 20 },
  body: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, marginTop: 3 },
});
