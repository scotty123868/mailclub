import { Heart, Moon, Sparkles, Star, Users } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { ConstellationPanel } from "@/src/components/ConstellationPanel";
import { Header } from "@/src/components/Header";
import { PostalCard } from "@/src/components/PostalCard";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const filters = [
  { id: "All Friends", icon: Users },
  { id: "Close Friends", icon: Heart },
  { id: "New Connections", icon: Sparkles },
];

export default function ConstellationScreen() {
  const [selected, setSelected] = useState("All Friends");
  return (
    <AppShell>
      <Header title="Constellation" />
      <PostalCard style={styles.chips}>
        {filters.map((filter) => {
          const active = selected === filter.id;
          const Icon = filter.icon;
          return (
            <Pressable key={filter.id} onPress={() => setSelected(filter.id)} style={[styles.chip, active && styles.activeChip]}>
              <Icon color={active ? colors.white : "#8B806C"} size={16} strokeWidth={1.7} />
              <Text style={[styles.chipText, active && styles.activeChipText]}>{filter.id}</Text>
            </Pressable>
          );
        })}
      </PostalCard>
      <ConstellationPanel />
      <View style={styles.insights}>
        <Insight icon={Heart} title="Warmest Thread" value="Tatiana · 12 cards" body="The most beautiful back-and-forth." accent={colors.postalRed} />
        <Insight icon={Star} title="New Spark" value="Nora" body="You met recently. Early ties grow into lasting connections." accent={colors.postalBlue} />
        <Insight icon={Moon} title="Sleeping Stars" value="3 friends to write back" body="A little note could rekindle something wonderful." accent="#76733B" />
      </View>
    </AppShell>
  );
}

function Insight({ icon: Icon, title, value, body, accent }: { icon: typeof Heart; title: string; value: string; body: string; accent: string }) {
  return (
    <PostalCard style={styles.insight}>
      <Icon color={accent} size={29} strokeWidth={1.5} />
      <View style={styles.insightCopy}>
        <Text style={styles.insightTitle}>{title}</Text>
        <Text style={[styles.insightValue, { color: accent }]}>{value}</Text>
        <Text style={styles.insightBody}>{body}</Text>
      </View>
    </PostalCard>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", padding: 5 },
  chip: { alignItems: "center", borderRadius: 8, flex: 1, flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 44 },
  activeChip: { backgroundColor: colors.ink },
  chipText: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 15 },
  activeChipText: { color: colors.white },
  insights: { gap: 12 },
  insight: { alignItems: "center", flexDirection: "row", gap: 16, minHeight: 120, padding: 16 },
  insightCopy: { flex: 1 },
  insightTitle: { color: colors.ink, fontFamily: fonts.serif, fontSize: 19 },
  insightValue: { fontFamily: fonts.serif, fontSize: 27, marginTop: 4 },
  insightBody: { color: colors.mutedInk, flex: 1, fontFamily: fonts.serif, fontSize: 14, lineHeight: 20, marginTop: 3 },
});
