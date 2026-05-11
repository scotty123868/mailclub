import { useRouter } from "expo-router";
import { Globe2, Heart, Mail, Send, Users } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { AirmailDivider } from "@/src/components/Decorations";
import { Header } from "@/src/components/Header";
import { MapPanel } from "@/src/components/MapPanel";
import { PostalCard } from "@/src/components/PostalCard";
import { MiniPostcardArt } from "@/src/components/PostalIllustrations";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { RouteDetailSheet } from "@/src/components/RouteDetailSheet";
import { Stamp } from "@/src/components/Stamp";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { formatMiles } from "@/src/utils/format";

const segments = [
  { id: "Friends", icon: Users },
  { id: "Sent", icon: Send },
  { id: "Received", icon: Mail },
];

export default function MapScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState("Friends");
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const { routes } = useMailClub();
  const activeRoute = routes.find((r) => r.id === activeRouteId) ?? null;

  return (
    <AppShell>
      <Header title="Map" />
      <PostalCard style={styles.segmented}>
        {segments.map((segment) => {
          const active = selected === segment.id;
          const Icon = segment.icon;
          return (
            <Pressable key={segment.id} onPress={() => setSelected(segment.id)} style={[styles.segment, active && styles.segmentActive]}>
              <Icon color={active ? colors.white : colors.postalBlue} size={18} strokeWidth={1.6} />
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{segment.id}</Text>
            </Pressable>
          );
        })}
      </PostalCard>

      <MapPanel />

      <PostalCard style={styles.summary}>
        <View style={styles.summaryRow}>
          <SummaryItem icon={Globe2} value="23" label="Cities" tint={colors.postalRed} />
          <SummaryItem icon={Users} value="42" label="Friends" tint={colors.ink} />
          <SummaryItem icon={Send} value="1,284" label="Miles" tint="#607A55" />
        </View>
      </PostalCard>

      <PostalCard style={styles.routes}>
        <View style={styles.airmailEdge} />
        <View style={styles.routesHeader}>
          <Text style={styles.sectionTitle}>Recent Routes</Text>
          <View style={styles.postmark}>
            <CircularPostmark size={62} topText="REAL-WORLD ROUTES" bottomText="REAL FRIENDSHIPS" centerYear="" />
          </View>
        </View>
        {routes.map((route, index) => (
          <Pressable
            key={route.id}
            onPress={() => setActiveRouteId(route.id)}
            style={[styles.route, index > 0 && styles.borderTop]}
            testID={`route-row-${route.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Route from ${route.from} to ${route.to}`}
          >
            <View style={styles.routeArt}>
              <MiniPostcardArt variant={index === 1 ? "city" : index === 2 ? "coast" : "mountain"} />
              <View style={styles.routeStamp}>
                <Stamp motif={index === 0 ? "mountain" : index === 1 ? "lighthouse" : "compass"} tone={index === 1 ? "sage" : "red"} cents={`${5 + index * 5}¢`} rotate={index % 2 === 0 ? -6 : 5} size="sm" />
              </View>
            </View>
            <View style={styles.routeCopy}>
              <Text style={styles.routeTitle}>{route.from} → {route.to}</Text>
              <Text style={styles.routeDate}>{route.date}</Text>
              <View style={styles.peopleRow}>
                <Users color={colors.ink} size={12} strokeWidth={1.5} />
                <Text style={styles.people}>{route.people}</Text>
              </View>
            </View>
            <Text style={styles.miles}>{formatMiles(route.miles)} mi</Text>
          </Pressable>
        ))}
      </PostalCard>

      <PostalCard style={styles.truth}>
        <Heart color={colors.postalRed} size={20} strokeWidth={1.5} />
        <Text style={styles.truthText}>Every line started with a real connection.</Text>
        <View style={styles.truthWaves}>
          <AirmailDivider />
        </View>
      </PostalCard>

      <RouteDetailSheet
        route={activeRoute}
        visible={activeRouteId !== null}
        onClose={() => setActiveRouteId(null)}
        onSendSimilar={() => {
          setActiveRouteId(null);
          router.push("/send");
        }}
      />
    </AppShell>
  );
}

function SummaryItem({ icon: Icon, value, label, tint }: { icon: typeof Globe2; value: string; label: string; tint: string }) {
  return (
    <View style={styles.summaryItem}>
      <Icon color={tint} size={20} strokeWidth={1.5} />
      <Text style={[styles.summaryValue, { color: tint }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: { flexDirection: "row", padding: 5 },
  segment: { alignItems: "center", borderRadius: 8, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 47 },
  segmentActive: { backgroundColor: colors.ink },
  segmentText: { color: colors.mutedInk, fontFamily: fonts.serifSemi, fontSize: 16 },
  segmentTextActive: { color: colors.white },
  summary: { paddingVertical: 16 },
  summaryRow: { flexDirection: "row" },
  summaryItem: { alignItems: "center", flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", paddingHorizontal: 6 },
  summaryValue: { fontFamily: fonts.serifSemi, fontSize: 28 },
  summaryLabel: { color: colors.mutedInk, flexShrink: 1, fontFamily: fonts.sansBold, fontSize: 9, letterSpacing: 0.6, textTransform: "uppercase" },
  routes: { overflow: "hidden", paddingHorizontal: 16, paddingLeft: 22, paddingVertical: 14 },
  airmailEdge: { backgroundColor: colors.postalBlue, bottom: 0, left: 0, position: "absolute", top: 0, width: 8 },
  routesHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingBottom: 6 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22, letterSpacing: 0.2 },
  postmark: { opacity: 0.65 },
  route: { alignItems: "center", flexDirection: "row", gap: 12, paddingVertical: 14 },
  borderTop: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
  routeArt: { position: "relative" },
  routeStamp: { position: "absolute", right: -8, top: -10 },
  routeCopy: { flex: 1 },
  routeTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 18 },
  routeDate: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 2 },
  peopleRow: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 4 },
  people: { color: colors.ink, fontFamily: fonts.serif, fontSize: 13 },
  miles: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 16 },
  truth: { alignItems: "center", backgroundColor: "rgba(155,175,155,0.18)", flexDirection: "row", gap: 12, padding: 16 },
  truthText: { color: "#4A5A38", flex: 1, fontFamily: fonts.serifItalic, fontSize: 15 },
  truthWaves: { position: "absolute", right: 16, top: 18, width: 80 },
});
