import { useRouter } from "expo-router";
import { Globe2, Mail, MapPin, Send, Users } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { Header } from "@/src/components/Header";
import { CITY_COORDS, type MapRoute, MapPanel, normalizeCityKey } from "@/src/components/MapPanel";
import { PostalCard } from "@/src/components/PostalCard";
import { MiniPostcardArt } from "@/src/components/PostalIllustrations";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { RouteDetailSheet } from "@/src/components/RouteDetailSheet";
import { Stamp } from "@/src/components/Stamp";
import { useMailClub } from "@/src/state/MailClubContext";
import type { MailRoute as RouteRow } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

type SegmentId = "Friends" | "Sent" | "Received";

const segments: Array<{ id: SegmentId; icon: typeof Users }> = [
  { id: "Friends", icon: Users },
  { id: "Sent", icon: Send },
  { id: "Received", icon: Mail },
];

/**
 * Map tab — v0.5.0 redesign.
 *
 * Per codex audit + user feedback on TestFlight 0.4.1:
 *   • Filter chips now actually filter. `selected` drives `filteredPostcards`
 *     which drives both the polylines on the map AND the Recent Routes list.
 *   • Pan/zoom enabled on the map (MapPanel's `interactive` default is true
 *     when not compact).
 *   • "Every line started with a real connection." footer card removed.
 *   • Unused imports (`Heart`, `AirmailDivider`, `currentUser`) removed.
 *
 * Filter semantics, current data model (only outbound `postcards` exist):
 *   • Friends — all routes the user has connected with (= all sends today)
 *   • Sent    — same set as Friends, kept as an explicit affordance
 *   • Received — empty until v0.5.1 ships inbound postcards. We render an
 *     informative empty state instead of pretending there's data.
 */
export default function MapScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<SegmentId>("Friends");
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const { postcards, friends } = useMailClub();

  // Apply the segment filter to the source data BEFORE deriving routes.
  // Today every postcard is outbound; the "Received" path is intentionally
  // empty until inbound mail lands in 0.5.1.
  const filteredPostcards = useMemo(() => {
    if (selected === "Received") return [];
    return postcards;
  }, [postcards, selected]);

  // Group postcards into unique (fromCity → toCity) routes. Each route gets
  // the most recent send date, a friend-name aggregate, and a stable id.
  const routes: RouteRow[] = useMemo(() => {
    const groups = new Map<string, { from: string; to: string; sentAt: string; people: Set<string> }>();
    for (const p of filteredPostcards) {
      const key = `${p.fromCity || "Home"}→${p.toCity}`;
      const existing = groups.get(key);
      const friendName = friends.find((f) => f.id === p.toFriendId)?.name ?? p.toCity;
      if (existing) {
        if (p.sentAt > existing.sentAt) existing.sentAt = p.sentAt;
        existing.people.add(friendName);
      } else {
        groups.set(key, { from: p.fromCity || "Home", to: p.toCity, sentAt: p.sentAt, people: new Set([friendName]) });
      }
    }
    return Array.from(groups.entries()).map(([key, g]) => ({
      id: `route-${key.replace(/\s+/g, "-").toLowerCase()}`,
      from: g.from,
      to: g.to,
      date: formatRouteDate(g.sentAt),
      miles: estimateMiles(g.from, g.to),
      people: Array.from(g.people).join(", "),
    }));
  }, [filteredPostcards, friends]);

  // Polylines that the MapPanel actually draws. We only render a line when
  // BOTH cities resolve to a known geocoord; unknowns drop silently until
  // 0.5.1 ships real geocoding. City strings go through normalizeCityKey
  // first so "Denver, CO" and " denver " both hit the lookup.
  const mapRoutes: MapRoute[] = useMemo(() => {
    const out: MapRoute[] = [];
    for (const r of routes) {
      const from = CITY_COORDS[normalizeCityKey(r.from)];
      const to = CITY_COORDS[normalizeCityKey(r.to)];
      if (!from || !to) continue;
      out.push({ from, to, tone: selected === "Received" ? "received" : "sent" });
    }
    return out;
  }, [routes, selected]);

  const activeRoute = routes.find((r) => r.id === activeRouteId) ?? null;

  // Stats reflect the currently-filtered view, not the all-time totals.
  // Received → all zeros (no inbound data today) so the strip doesn't lie.
  // Friends/Sent → unique cities you've connected with via the filtered set,
  // friends in your rolodex, and total miles across the filtered routes.
  // (codex P2, Phase 1 review: previously friends.length was always all-time.)
  const stats = useMemo(() => {
    if (selected === "Received") {
      return { citiesCount: 0, friendsCount: 0, totalMiles: 0 };
    }
    const cities = new Set<string>();
    for (const p of filteredPostcards) {
      if (p.fromCity) cities.add(p.fromCity);
      if (p.toCity) cities.add(p.toCity);
    }
    for (const f of friends) {
      if (f.city) cities.add(f.city);
    }
    return {
      citiesCount: cities.size,
      friendsCount: friends.length,
      totalMiles: routes.reduce((sum, r) => sum + r.miles, 0),
    };
  }, [selected, filteredPostcards, friends, routes]);

  function formatRouteDate(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return iso;
    }
  }

  // Stable pseudo-distance from a city-pair string hash, plausible 100-3000mi
  // range. Real geo distance ships with backend geocoding in 0.5.1.
  function estimateMiles(from: string, to: string): number {
    if (from === to) return 0;
    const seed = (from + to).split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
    return 100 + (seed % 2900);
  }

  return (
    <AppShell>
      <Header title="Map" />

      <PostalCard style={styles.segmented}>
        {segments.map((segment) => {
          const active = selected === segment.id;
          const Icon = segment.icon;
          return (
            <Pressable
              key={segment.id}
              onPress={() => setSelected(segment.id)}
              style={[styles.segment, active && styles.segmentActive]}
              testID={`map-filter-${segment.id.toLowerCase()}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Icon color={active ? colors.white : colors.postalBlue} size={18} strokeWidth={1.6} />
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{segment.id}</Text>
            </Pressable>
          );
        })}
      </PostalCard>

      <MapPanel routes={mapRoutes} />

      <PostalCard style={styles.summary}>
        <View style={styles.summaryRow}>
          <SummaryItem icon={Globe2} value={String(stats.citiesCount)} label="Cities" tint={colors.postalRed} />
          <SummaryItem icon={Users} value={String(stats.friendsCount)} label="Friends" tint={colors.ink} />
          <SummaryItem icon={Send} value={stats.totalMiles.toLocaleString()} label="Miles" tint="#607A55" />
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
        {routes.length === 0 ? (
          <View style={styles.routesEmpty} testID="routes-empty">
            <MapPin color={colors.postalBlue} size={26} strokeWidth={1.5} />
            <Text style={styles.routesEmptyTitle}>
              {selected === "Received" ? "No replies yet." : "No routes yet."}
            </Text>
            <Text style={styles.routesEmptyBody}>
              {selected === "Received"
                ? "Inbound postcards arrive in 0.5.1. Until then, send one and watch the line trace itself."
                : "Send your first card — it's free — and watch the line trace itself across the map."}
            </Text>
          </View>
        ) : (
          routes.map((route, index) => (
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
              <Text style={styles.miles}>~{route.miles.toLocaleString()} mi</Text>
            </Pressable>
          ))
        )}
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
      <Icon color={tint} size={18} strokeWidth={1.5} />
      <Text style={[styles.summaryValue, { color: tint }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.summaryLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: { flexDirection: "row", padding: 5 },
  segment: { alignItems: "center", borderRadius: 8, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 47 },
  segmentActive: { backgroundColor: colors.ink },
  segmentText: { color: colors.mutedInk, fontFamily: fonts.serifSemi, fontSize: 16 },
  segmentTextActive: { color: colors.white },
  summary: { paddingVertical: 14 },
  summaryRow: { flexDirection: "row" },
  summaryItem: { alignItems: "center", flex: 1, gap: 4, paddingHorizontal: 6 },
  summaryValue: { fontFamily: fonts.serifSemi, fontSize: 24, letterSpacing: -0.4 },
  summaryLabel: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" },
  routes: { overflow: "hidden", paddingHorizontal: 16, paddingLeft: 22, paddingVertical: 14 },
  airmailEdge: { backgroundColor: colors.postalBlue, bottom: 0, left: 0, position: "absolute", top: 0, width: 8 },
  routesHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingBottom: 6 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22, letterSpacing: 0.2 },
  postmark: { opacity: 0.65 },
  route: { alignItems: "center", flexDirection: "row", gap: 12, paddingVertical: 14 },
  borderTop: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
  routesEmpty: { alignItems: "center", gap: 8, paddingVertical: 24 },
  routesEmptyTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17, marginTop: 6 },
  routesEmptyBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17, textAlign: "center" },
  routeArt: { position: "relative" },
  routeStamp: { position: "absolute", right: -8, top: -10 },
  routeCopy: { flex: 1 },
  routeTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 18 },
  routeDate: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 2 },
  peopleRow: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 4 },
  people: { color: colors.ink, fontFamily: fonts.serif, fontSize: 13 },
  miles: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 16 },
});
