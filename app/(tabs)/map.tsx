import { Globe2, Heart, Mail, Send, Users } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { AirmailDivider } from "@/src/components/Decorations";
import { Header } from "@/src/components/Header";
import { MapPanel } from "@/src/components/MapPanel";
import { PostalCard } from "@/src/components/PostalCard";
import { MiniPostcardArt } from "@/src/components/PostalIllustrations";
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
  const [selected, setSelected] = useState("Friends");
  const { routes } = useMailClub();
  return (
    <AppShell>
      <Header title="Map" />
      <PostalCard style={styles.segmented}>
        {segments.map((segment) => {
          const active = selected === segment.id;
          const Icon = segment.icon;
          return (
            <Pressable key={segment.id} onPress={() => setSelected(segment.id)} style={[styles.segment, active && styles.segmentActive]}>
              <Icon color={active ? colors.white : colors.postalBlue} size={19} strokeWidth={1.7} />
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{segment.id}</Text>
            </Pressable>
          );
        })}
      </PostalCard>

      <MapPanel />

      <PostalCard style={styles.summary}>
        <View style={styles.summaryRow}>
          <SummaryItem icon={Globe2} value="23" label="Cities" />
          <SummaryItem icon={Users} value="42" label="Friends" />
          <SummaryItem icon={Mail} value="1,284" label="Miles This Month" />
        </View>
        <View style={styles.dividerLine} />
        <AirmailDivider />
      </PostalCard>

      <PostalCard style={styles.routes}>
        <View style={styles.airmailEdge} />
        <View style={styles.routesHeader}>
          <Text style={styles.sectionTitle}>Recent Routes</Text>
          <Text style={styles.routeBadge}>REAL-WORLD ROUTES</Text>
        </View>
        {routes.map((route, index) => (
          <View key={route.id} style={[styles.route, index > 0 && styles.borderTop]}>
            <MiniPostcardArt variant={index === 1 ? "city" : index === 2 ? "coast" : "mountain"} />
            <View style={styles.routeCopy}>
              <Text style={styles.routeTitle}>{route.from} → {route.to}</Text>
              <Text style={styles.routeDate}>{route.date}</Text>
              <View style={styles.peopleRow}>
                <Users color={colors.ink} size={13} strokeWidth={1.5} />
                <Text style={styles.people}>{route.people}</Text>
              </View>
            </View>
            <Text style={styles.miles}>{formatMiles(route.miles)} mi</Text>
          </View>
        ))}
      </PostalCard>
      <PostalCard style={styles.truth}>
        <Heart color={colors.postalRed} size={22} strokeWidth={1.5} />
        <Text style={styles.truthText}>Every line started with a real connection.</Text>
      </PostalCard>
    </AppShell>
  );
}

function SummaryItem({ icon: Icon, value, label }: { icon: typeof Globe2; value: string; label: string }) {
  return (
    <View style={styles.summaryItem}>
      <Icon color={colors.postalBlue} size={26} strokeWidth={1.5} />
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: { flexDirection: "row", padding: 5 },
  segment: { alignItems: "center", borderRadius: 8, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 47 },
  segmentActive: { backgroundColor: colors.ink },
  segmentText: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 17 },
  segmentTextActive: { color: colors.white },
  summary: { gap: 0, marginHorizontal: 16, marginTop: -52, overflow: "hidden", paddingTop: 18 },
  summaryRow: { flexDirection: "row" },
  summaryItem: { alignItems: "center", flex: 1, paddingBottom: 16 },
  dividerLine: { backgroundColor: colors.line, height: StyleSheet.hairlineWidth },
  summaryValue: { color: colors.ink, fontFamily: fonts.serif, fontSize: 32, marginTop: 4 },
  summaryLabel: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 14, textAlign: "center" },
  routes: { overflow: "hidden", paddingHorizontal: 15, paddingLeft: 20, paddingVertical: 12 },
  airmailEdge: { backgroundColor: colors.postalBlue, bottom: 0, left: 0, position: "absolute", top: 0, width: 8 },
  routesHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingBottom: 6 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.serif, fontSize: 22 },
  link: { color: colors.postalBlue, fontFamily: fonts.serif, fontSize: 15 },
  routeBadge: { color: colors.postalRed, fontFamily: fonts.sans, fontSize: 10, fontWeight: "800" },
  route: { alignItems: "center", flexDirection: "row", gap: 12, paddingVertical: 13 },
  borderTop: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
  routeCopy: { flex: 1 },
  routeTitle: { color: colors.ink, fontFamily: fonts.serif, fontSize: 19 },
  routeDate: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 13, marginTop: 2 },
  peopleRow: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 4 },
  people: { color: colors.ink, fontFamily: fonts.serif, fontSize: 13 },
  miles: { color: colors.postalRed, fontFamily: fonts.mono, fontSize: 14 },
  truth: { alignItems: "center", backgroundColor: "rgba(155,175,155,0.18)", flexDirection: "row", gap: 12, padding: 16 },
  truthText: { color: "#607A55", flex: 1, fontFamily: fonts.serif, fontSize: 17 },
});
