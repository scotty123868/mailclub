import { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";

type Metric = {
 icon: LucideIcon;
 value: string | number;
 label: string;
 accent?: string;
 onPress?: () => void;
 testID?: string;
};

/**
 * Restrained metric strip. numbers in ink, a small colored dot beside the
 * uppercase label as the only accent. Less circus, more letterhead.
 */
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
 return (
 <PostalCard style={styles.strip}>
 {metrics.map((metric, index) => {
 const Icon = metric.icon;
 const accent = metric.accent ?? colors.postalRed;
 const Wrapper: any = metric.onPress ? Pressable : View;
 return (
 <Wrapper
 key={metric.label}
 onPress={metric.onPress}
 style={[styles.metric, index > 0 && styles.borderLeft]}
 testID={metric.testID}
 accessibilityRole={metric.onPress ? "button" : undefined}
 accessibilityLabel={metric.onPress ? `${metric.value} ${metric.label}. Tap for details.` : undefined}
 >
 <Text style={styles.value}>{metric.value}</Text>
 <View style={styles.labelRow}>
 <View style={[styles.dot, { backgroundColor: accent }]} />
 <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{metric.label}</Text>
 </View>
 </Wrapper>
 );
 })}
 </PostalCard>
 );
}

const styles = StyleSheet.create({
 strip: { flexDirection: "row", minHeight: 92, paddingVertical: 16 },
 metric: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: 4 },
 borderLeft: { borderLeftColor: colors.line, borderLeftWidth: StyleSheet.hairlineWidth },
 value: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 36, lineHeight: 38 },
 labelRow: { alignItems: "center", flexDirection: "row", gap: 5, justifyContent: "center", marginTop: 6 },
 dot: { borderRadius: 3, height: 6, width: 6 },
 label: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 9, letterSpacing: 0.9, textTransform: "uppercase" },
});
