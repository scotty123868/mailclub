import { useRouter } from "expo-router";
import { Heart, Moon, Sparkles, Star, Users } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { ConstellationPanel } from "@/src/components/ConstellationPanel";
import { FriendDetailSheet } from "@/src/components/FriendDetailSheet";
import { Header } from "@/src/components/Header";
import { PostalCard } from "@/src/components/PostalCard";
import { MiniPostcardArt } from "@/src/components/PostalIllustrations";
import { Stamp } from "@/src/components/Stamp";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const filters = [
  { id: "All Friends", icon: Users },
  { id: "Close Friends", icon: Heart },
  { id: "New Connections", icon: Sparkles },
];

export default function ConstellationScreen() {
  const router = useRouter();
  const { friends } = useMailClub();
  const [selected, setSelected] = useState("All Friends");
  const [activeFriendId, setActiveFriendId] = useState<string | null>(null);
  const activeFriend = friends.find((f) => f.id === activeFriendId) ?? null;

  // Derive insights from real state, not hardcoded names. If the user has no
  // friends yet, render an inviting empty state instead of inventing names.
  const sortedByCards = [...friends].sort((a, b) => (b.cardsSent + b.cardsReceived) - (a.cardsSent + a.cardsReceived));
  const warmest = sortedByCards[0];
  const sortedByRecent = [...friends].sort((a, b) => (b.lastInteractionAt > a.lastInteractionAt ? 1 : -1));
  const newest = sortedByRecent[0];
  // "Sleeping" = friends not interacted with in 60+ days
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const sleeping = friends.filter((f) => new Date(f.lastInteractionAt) < sixtyDaysAgo);

  return (
    <AppShell>
      <Header title="Constellation" />
      <View style={styles.chips}>
        {filters.map((filter) => {
          const active = selected === filter.id;
          const Icon = filter.icon;
          return (
            <Pressable
              key={filter.id}
              onPress={() => setSelected(filter.id)}
              style={[styles.chip, active && styles.activeChip]}
              testID={`constellation-filter-${filter.id.toLowerCase().replace(/\s+/g, "-")}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Icon color={active ? colors.white : colors.ink} size={16} strokeWidth={1.6} />
              <Text style={[styles.chipText, active && styles.activeChipText]}>{filter.id}</Text>
            </Pressable>
          );
        })}
      </View>

      <ConstellationPanel friends={friends} />

      {friends.length === 0 ? (
        <View style={styles.empty} testID="constellation-empty">
          <Sparkles color={colors.postalBlue} size={28} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>No constellation yet.</Text>
          <Text style={styles.emptyBody}>
            Add a friend to light up your first star. Insights appear here as you write more cards.
          </Text>
          <Pressable onPress={() => router.push("/friends")} style={styles.emptyBtn} testID="constellation-empty-add">
            <Text style={styles.emptyBtnText}>Add a friend</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.insights}>
          {warmest && (warmest.cardsSent + warmest.cardsReceived) > 0 && (
            <Insight
              icon={Heart}
              title="Warmest Thread"
              value={warmest.name}
              chip={`${warmest.cardsSent + warmest.cardsReceived} cards`}
              body="Your most beautiful back-and-forth."
              accent={colors.postalRed}
              art="mountain"
              cents="20¢"
              stampMotif="botanical"
              stampTone="red"
              testID="constellation-insight-warmest"
              onPress={() => setActiveFriendId(warmest.id)}
            />
          )}
          {newest && newest.id !== warmest?.id && (
            <Insight
              icon={Star}
              title="New Spark"
              value={newest.name}
              chip="Most recent connection"
              body="Early ties grow into lasting connections."
              accent={colors.postalBlue}
              art="coast"
              cents="10¢"
              stampMotif="lighthouse"
              stampTone="blue"
              testID="constellation-insight-spark"
              onPress={() => setActiveFriendId(newest.id)}
            />
          )}
          {sleeping.length > 0 && (
            <Insight
              icon={Moon}
              title="Sleeping Stars"
              value={`${sleeping.length} ${sleeping.length === 1 ? "friend" : "friends"}`}
              chip="quiet for 60+ days"
              body="A short note could rekindle something."
              accent="#76733B"
              art="night"
              cents="5¢"
              stampMotif="moon"
              stampTone="night"
              testID="constellation-insight-sleeping"
              onPress={() => router.push("/friends")}
            />
          )}
        </View>
      )}

      <FriendDetailSheet
        friend={activeFriend}
        visible={activeFriendId !== null}
        onClose={() => setActiveFriendId(null)}
        onSend={(id) => {
          setActiveFriendId(null);
          router.push({ pathname: "/send", params: { friendId: id } });
        }}
      />
    </AppShell>
  );
}

function Insight({
  icon: Icon,
  title,
  value,
  chip,
  body,
  accent,
  art,
  cents,
  stampMotif,
  stampTone,
  onPress,
  testID,
}: {
  icon: typeof Heart;
  title: string;
  value: string;
  chip: string;
  body: string;
  accent: string;
  art: "mountain" | "coast" | "night";
  cents: string;
  stampMotif: "botanical" | "lighthouse" | "moon";
  stampTone: "red" | "blue" | "night";
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      testID={testID}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${title}: ${value}`}
    >
      <PostalCard style={styles.insight}>
        <View style={styles.airmailEdge} />
        <MiniPostcardArt variant={art} />
        <View style={styles.insightCopy}>
          <View style={styles.titleRow}>
            <Icon color={accent} size={18} strokeWidth={1.6} />
            <Text style={styles.insightTitle}>{title}</Text>
          </View>
          <View style={styles.valueRow}>
            <Text style={[styles.insightValue, { color: accent }]}>{value}</Text>
            <Text style={[styles.insightChip, { color: accent }]}> · {chip}</Text>
          </View>
          <Text style={styles.insightBody}>{body}</Text>
        </View>
        <View style={styles.insightStamp}>
          <Stamp motif={stampMotif} tone={stampTone} cents={cents} rotate={6} size="sm" />
        </View>
      </PostalCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", backgroundColor: "rgba(60,110,143,0.06)", borderColor: colors.line, borderRadius: 10, borderWidth: 1, gap: 8, padding: 28 },
  emptyTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 19, marginTop: 8 },
  emptyBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 18, textAlign: "center" },
  emptyBtn: { backgroundColor: colors.ink, borderRadius: 8, marginTop: 8, paddingHorizontal: 16, paddingVertical: 10 },
  emptyBtnText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 14, letterSpacing: 0.3 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { alignItems: "center", borderColor: colors.line, borderRadius: 24, borderWidth: 1, flex: 1, flexDirection: "row", gap: 6, justifyContent: "center", paddingVertical: 10 },
  activeChip: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
  activeChipText: { color: colors.white },
  insights: { gap: 12 },
  insight: { alignItems: "center", flexDirection: "row", gap: 14, minHeight: 124, overflow: "hidden", padding: 16, paddingRight: 70 },
  airmailEdge: { backgroundColor: colors.postalBlue, bottom: 0, left: 0, position: "absolute", top: 0, width: 7 },
  insightCopy: { flex: 1, gap: 3 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  insightTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17 },
  valueRow: { alignItems: "baseline", flexDirection: "row" },
  insightValue: { fontFamily: fonts.serifSemi, fontSize: 26 },
  insightChip: { fontFamily: fonts.serif, fontSize: 14 },
  insightBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 18, marginTop: 2 },
  insightStamp: { position: "absolute", right: 14, top: 18 },
});
