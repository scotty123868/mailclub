import { ShieldCheck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";
import { CircularPostmark } from "./PostmarkDecoration";
import { Stamp } from "./Stamp";

export function PrivacyCard() {
  return (
    <PostalCard style={styles.card}>
      <View style={styles.icon}><ShieldCheck color={colors.ink} size={26} strokeWidth={1.4} /></View>
      <View style={styles.copy}>
        <Text style={styles.title}>Addresses stay private.</Text>
        <Text style={styles.body}>Friends can send mail without seeing your full address.</Text>
      </View>
      <View style={styles.postmark}>
        <CircularPostmark size={68} topText="PRIVATE" bottomText="BY DESIGN" centerYear="" />
      </View>
      <View style={styles.stamp}>
        <Stamp motif="botanical" tone="sage" cents="15¢" rotate={5} size="sm" />
      </View>
    </PostalCard>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", flexDirection: "row", gap: 14, paddingHorizontal: 18, paddingVertical: 18 },
  icon: { alignItems: "center", backgroundColor: colors.paperDark, borderRadius: 28, height: 50, justifyContent: "center", width: 50 },
  copy: { flex: 1 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 18 },
  body: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 14, lineHeight: 19, marginTop: 3 },
  postmark: { opacity: 0.55, position: "absolute", right: 56, top: 16 },
  stamp: { position: "absolute", right: 12, top: 12 },
});
