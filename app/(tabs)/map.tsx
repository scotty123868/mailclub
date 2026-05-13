import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { Header } from "@/src/components/Header";
import {
  CITY_COORDS,
  type MapRoute,
  MapPanel,
  normalizeCityKey,
} from "@/src/components/MapPanel";
import { RouteDetailSheet } from "@/src/components/RouteDetailSheet";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";

/**
 * Map tab — v0.7.0.2.
 *
 * Stripped to its essence per user feedback: "I just want the map to be
 * the thing itself, especially because there... the map will already be
 * populated with something once the user is forced to send."
 *
 * What v0.7.0.2 removes (was in v0.6.x):
 *   - Segmented filter chips (Friends / Sent / Received)
 *   - 3-tile summary (Cities · Friends · Miles)
 *   - "Recent Routes" list below the map
 *   - "Mailroom" hexagonal button + compass decoration
 *
 * What remains:
 *   - Header with credits pill
 *   - MapPanel (full real estate of the screen body) rendering all
 *     outbound postcard routes as polylines + city pins
 *   - Tap a route → RouteDetailSheet
 *
 * v0.7.1 will add: tap pin → animated polyline to reciprocal pin + a
 * @gorhom bottom sheet with the postcard preview (D.2 magical moment).
 */
export default function MapScreen() {
  const router = useRouter();
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const { postcards, friends, currentUser } = useMailClub();

  // Build the route list from outbound postcards. We aggregate
  // (fromCity → toCity) so multiple sends along the same line collapse
  // into one polyline. People column joins the names of recipients on
  // that route. Geocoords come from CITY_COORDS; unknowns drop silently
  // until backend geocoding (planned v0.7.5).
  const routes = useMemo(() => {
    type Group = { from: string; to: string; sentAt: string; people: Set<string> };
    const groups = new Map<string, Group>();
    for (const p of postcards) {
      const friend = friends.find((f) => f.id === p.toFriendId);
      const toCity = p.toCity || friend?.city || "";
      if (!p.fromCity || !toCity) continue;
      const key = `${p.fromCity}→${toCity}`;
      const existing = groups.get(key);
      if (existing) {
        if (p.sentAt > existing.sentAt) existing.sentAt = p.sentAt;
        if (friend?.name) existing.people.add(friend.name);
      } else {
        groups.set(key, {
          from: p.fromCity,
          to: toCity,
          sentAt: p.sentAt,
          people: new Set(friend?.name ? [friend.name] : []),
        });
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
  }, [postcards, friends]);

  const mapRoutes: MapRoute[] = useMemo(() => {
    const out: MapRoute[] = [];
    for (const r of routes) {
      const from = CITY_COORDS[normalizeCityKey(r.from)];
      const to = CITY_COORDS[normalizeCityKey(r.to)];
      if (!from || !to) continue;
      out.push({ from, to, tone: "sent" });
    }
    return out;
  }, [routes]);

  const activeRoute = routes.find((r) => r.id === activeRouteId) ?? null;

  return (
    <AppShell>
      <Header title="Map" />

      {/* The map IS the screen. Fills the body, full-bleed within the
          AppShell horizontal padding. No chrome above or below — that
          was the user feedback ("just want the map to be the thing"). */}
      <View style={styles.mapFrame}>
        <MapPanel routes={mapRoutes} />
      </View>

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

function formatRouteDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Stable pseudo-distance from a city-pair string hash. Real geocoding
 *  lands in v0.7.5. */
function estimateMiles(from: string, to: string): number {
  if (from === to) return 0;
  const seed = (from + to).split("").reduce(
    (a, c) => (a * 31 + c.charCodeAt(0)) >>> 0,
    0,
  );
  return 100 + (seed % 2900);
}

const styles = StyleSheet.create({
  mapFrame: {
    flex: 1,
    marginTop: 8,
    overflow: "hidden",
    borderRadius: 12,
  },
});
