import { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";

type Metric = {
  icon: LucideIcon;
  value: string | number;
  label: string;
  accent?: string;
};

export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <PostalCard style={styles.strip}>
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        const accent = metric.accent ?? colors.ink;
        return (
          <View key={metric.label} style={[styles.metric, index > 0 && styles.borderLeft]}>
            <Text style={[styles.value, { color: accent }]}>{metric.value}</Text>
            <View style={styles.labelRow}>
              <Icon color={accent} size={21} strokeWidth={1.45} />
              <Text style={[styles.label, { color: accent }]} numberOfLines={2}>{metric.label}</Text>
            </View>
          </View>
        );
      })}
    </PostalCard>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", minHeight: 104, paddingVertical: 13 },
  metric: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: 6 },
  borderLeft: { borderLeftColor: colors.line, borderLeftWidth: StyleSheet.hairlineWidth },
  value: { fontFamily: fonts.serif, fontSize: 34 },
  labelRow: { alignItems: "center", flexDirection: "row", gap: 5, justifyContent: "center", marginTop: 6 },
  label: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 10, fontWeight: "800", letterSpacing: 0.3, lineHeight: 13, textAlign: "left", textTransform: "uppercase" },
});
