import { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";

export function StatCard({ icon: Icon, value, label }: { icon: LucideIcon; value: string | number; label: string }) {
 return (
 <PostalCard style={styles.card}>
 <Icon color={colors.postalBlue} size={25} strokeWidth={1.6} />
 <Text style={styles.value}>{value}</Text>
 <Text style={styles.label}>{label}</Text>
 </PostalCard>
 );
}

const styles = StyleSheet.create({
 card: { alignItems: "center", flex: 1, minHeight: 112, paddingHorizontal: 6, paddingVertical: 13 },
 value: { color: colors.ink, fontFamily: fonts.serif, fontSize: 31, marginTop: 6 },
 label: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 14, lineHeight: 17, textAlign: "center" },
});
