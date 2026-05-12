import { useRouter } from "expo-router";
import { Heart, Moon, Sparkles, Star } from "lucide-react-native";
import { useMemo, useState } from "react";
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

// v0.5.0: dropped the top filter chips (All Friends / Close Friends / New
// Connections). Per the gallery cleanup pass — premature segmentation when
// most users have 0–5 friends. The Insight cards below already surface the
// useful slices (Warmest Thread / New Spark / Sleeping Stars).
export default function ConstellationScreen() {
  const router = useRouter();
  const { friends } = useMailClub();
  const [activeFriendId, setActiveFriendId] = useState<string | null>(null);
  const activeFriend = friends.find((f) => f.id === activeFriendId) ?? null;

  // Derive insights from real state, not hardcoded names. Memoized so we
  // don't resort on every render.
  const { warmest, newest, sleeping } = useMemo(() => {
    const byCards = [...friends].sort((a, b) => (b.cardsSent + b.cardsReceived) - (a.cardsSent + a.cardsReceived));
    const byRecent = [...friends].sort((a, b) => {
      if (a.lastInteractionAt === b.lastInteractionAt) return 0;
      return b.lastInteractionAt > a.lastInteractionAt ? 1 : -1;
    });
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    return {
      warmest: byCards[0],
      newest: byRecent[0],
      sleeping: friends.filter((f) => new Date(f.lastInteractionAt) < sixtyDaysAgo),
    };
  }, [friends]);

  return (
    <AppShell>
      <Header title="Constellation" />

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
