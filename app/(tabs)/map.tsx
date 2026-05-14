import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { Header } from "@/src/components/Header";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import {
  CITY_COORDS,
  type MapCity,
  type MapRoute,
  MapPanel,
  normalizeCityKey,
} from "@/src/components/MapPanel";
import {
  PostcardDetailSheet,
  type PostcardDetailSheetRef,
} from "@/src/components/PostcardDetailSheet";
import {
  PostcardPreviewSheet,
  type PostcardPreviewSheetRef,
} from "@/src/components/PostcardPreviewSheet";
import { useMailClub } from "@/src/state/MailClubContext";

/**
 * Map tab — v0.7.0.4.
 *
 * Stripped to its essence per user feedback ("just want the map to be
 * the thing itself") and then re-wired for the C.3 magical moment:
 * tap a city pin → bottom sheet rises with the postcards involving
 * that city (sent there or received from there).
 *
 * What stays:
 *   - Header with credits pill
 *   - MapPanel filling the screen body (full-bleed under header)
 *   - Polylines drawn between cities for each route
 *
 * What changed in v0.7.0.4 (vs v0.7.0.2 which removed the chrome but
 * left the map non-interactive):
 *   - City Markers are now tappable. Tap → opens PostcardPreviewSheet
 *     scoped to that city.
 *   - Replaced the legacy RouteDetailSheet with @gorhom/bottom-sheet
 *     (native drag-to-dismiss, spring physics, snap points).
 *
 * Deferred to v0.7.1:
 *   - Animated polyline highlight when a pin is tapped (drawing the
 *     line from the tapped city to the user&apos;s home city)
 *   - Pin-drop entrance animation when the Lob webhook flips a
 *     postcard to in_transit / delivered
 *   - Real-time updates via Supabase Realtime (currently the map
 *     refreshes on tab focus)
 */
export default function MapScreen() {
  const sheetRef = useRef<PostcardPreviewSheetRef>(null);
  // v0.7.0.7: detail sheet for pending-send pins. Tap the gold dashed
  // pin → opens the postcard detail with the claim URL + Share Again.
  const detailRef = useRef<PostcardDetailSheetRef>(null);
  const { postcards, friends, currentUser } = useMailClub();
  const [highlightRoute, setHighlightRoute] = useState<MapRoute | null>(null);

  // Pin set: the user&apos;s sent-to cities + received-from cities. We
  // build it from the postcards array directly so the pins reflect
  // the real history, not a hardcoded fixture.
  //
  // v0.7.0.7: also emit a "pending" pin at the sender's home for every
  // send-link card that hasn't been claimed yet. This populates the map
  // immediately after the first send — empty map ≠ first impression.
  const pins: MapCity[] = useMemo(() => {
    const seen = new Map<string, MapCity>();
    for (const p of postcards) {
      // Skip pending — handled separately below.
      if (p.toFriendId === "") continue;
      const friend = friends.find((f) => f.id === p.toFriendId);
      const cityName = p.toCity || friend?.city || "";
      if (!cityName) continue;
      const coord = CITY_COORDS[normalizeCityKey(cityName)];
      if (!coord) continue;
      const id = `city-${normalizeCityKey(cityName)}`;
      if (!seen.has(id)) {
        seen.set(id, { id, name: cityName, coord, accent: true });
      }
    }
    // Also include unique from-cities so home shows up even on the
    // first send (where you might be the only city with a pin).
    for (const p of postcards) {
      if (!p.fromCity) continue;
      const coord = CITY_COORDS[normalizeCityKey(p.fromCity)];
      if (!coord) continue;
      const id = `city-${normalizeCityKey(p.fromCity)}`;
      if (!seen.has(id)) {
        seen.set(id, { id, name: p.fromCity, coord });
      }
    }
    // Pending send-link cards: one pin per unclaimed card, offset
    // slightly from the sender's home so they don't stack on top of
    // each other. Coord = fromCity (where the user lives — that's all
    // we know until the recipient claims).
    const pendingCards = postcards.filter((p) => p.toFriendId === "");
    pendingCards.forEach((p, idx) => {
      const baseCity = p.fromCity || currentUser?.city || "";
      const coord = baseCity ? CITY_COORDS[normalizeCityKey(baseCity)] : null;
      if (!coord) return;
      // Spread pending pins slightly so they don't stack. ~0.3 deg
      // ≈ ~30km — visible but doesn't lie about location.
      const angle = (idx * 137.5 * Math.PI) / 180; // golden angle
      const r = 0.3 + idx * 0.05;
      const jittered = {
        latitude: coord.latitude + Math.sin(angle) * r,
        longitude: coord.longitude + Math.cos(angle) * r,
      };
      seen.set(`pending-${p.id}`, {
        id: `pending-${p.id}`,
        name: "awaiting address",
        coord: jittered,
        pending: true,
        pendingPostcardId: p.id,
      });
    });
    return Array.from(seen.values());
  }, [postcards, friends, currentUser]);

  // Routes for polylines. Each unique (fromCity, toCity) pair → one
  // polyline. Tone defaults to "sent" since postcards in the array
  // are predominantly outbound; receiver-side rows would need senderId
  // logic but the visual is fine either way for v0.7.0.4.
  const mapRoutes: MapRoute[] = useMemo(() => {
    const seenPairs = new Set<string>();
    const out: MapRoute[] = [];
    for (const p of postcards) {
      const friend = friends.find((f) => f.id === p.toFriendId);
      const toCityName = p.toCity || friend?.city || "";
      if (!p.fromCity || !toCityName) continue;
      const from = CITY_COORDS[normalizeCityKey(p.fromCity)];
      const to = CITY_COORDS[normalizeCityKey(toCityName)];
      if (!from || !to) continue;
      const key = `${normalizeCityKey(p.fromCity)}→${normalizeCityKey(toCityName)}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      out.push({ from, to, tone: "sent" });
    }
    return out;
  }, [postcards, friends]);

  return (
    <BottomSheetModalProvider>
      <AppShell>
        <Header title="Map" />

        {/* Map fills the body below the header */}
        <View style={styles.mapFrame}>
          <MapPanel
            routes={mapRoutes}
            cities={pins.length > 0 ? pins : undefined}
            highlightRoute={highlightRoute}
            onCityPress={(city) => {
              // v0.7.0.7: pending pin → open the postcard detail
              // sheet directly. Bypasses the city-scoped preview
              // because pending cards don't have a real destination yet.
              if (city.pending && city.pendingPostcardId) {
                detailRef.current?.open(city.pendingPostcardId);
                return;
              }
              // v0.7.0.5 D.2: trace a bright polyline from the tapped
              // city to the user's home city while the sheet rises.
              // If home city isn't resolved (no profile city yet), the
              // highlight just doesn't fire — sheet still opens.
              const homeCoord = currentUser.city
                ? CITY_COORDS[normalizeCityKey(currentUser.city)]
                : null;
              if (homeCoord && city.coord !== homeCoord) {
                setHighlightRoute({ from: city.coord, to: homeCoord, tone: "sent" });
              }
              sheetRef.current?.open({ kind: "city", cityName: city.name });
            }}
          />
          {/* v0.7.0.18: explicit empty state. Previously the user saw a
              blank US map with zero pins and no explanation — they read
              that as "the map is broken." This overlay only appears when
              there are NO pins (no sent cards, no received cards, no
              pending claims). The instant a postcard is created the
              overlay disappears. */}
          {pins.length === 0 ? (
            <View pointerEvents="none" style={styles.emptyOverlay}>
              <Text style={styles.emptyTitle}>Your map fills as you send.</Text>
              <Text style={styles.emptySubtitle}>
                Send your first card from the Send tab. Every city you mail
                to or receive from drops a pin here.
              </Text>
            </View>
          ) : null}
        </View>
      </AppShell>

      {/* The sheet must live OUTSIDE AppShell so it can render over
          the tab bar + nav. It mounts as a portal at the root and
          stays hidden (index=-1) until .open() is called. */}
      <PostcardPreviewSheet ref={sheetRef} />

      {/* v0.7.0.7: per-card detail sheet for pending-send pins. */}
      <PostcardDetailSheet ref={detailRef} />
    </BottomSheetModalProvider>
  );
}

const styles = StyleSheet.create({
  mapFrame: {
    flex: 1,
    marginTop: 8,
    overflow: "hidden",
    borderRadius: 12,
    position: "relative",
  },
  // v0.7.0.18: centered overlay shown only when pins.length === 0. The
  // overlay's pointerEvents="none" wrapper lets pinch/pan/zoom on the
  // underlying MapView still work — the user can move the map around
  // even while the empty-state copy is visible.
  emptyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 22,
    textAlign: "center",
    backgroundColor: "rgba(248, 241, 227, 0.92)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptySubtitle: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    maxWidth: 320,
    textAlign: "center",
    backgroundColor: "rgba(248, 241, 227, 0.92)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
});
