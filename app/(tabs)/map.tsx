import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useMemo, useRef, useState } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { Header } from "@/src/components/Header";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import {
  type MapCity,
  type MapRoute,
  MapPanel,
  normalizeCityKey,
  resolveCoord,
} from "@/src/components/MapPanel";
import {
  coordKey as toCoordKey,
  computeCityStats,
  groupByArea,
} from "@/src/lib/mapStats";
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
  // v1.0.1: tapping a row in the city preview sheet now opens the
  // postcard detail sheet (photo + message + status), not /send.
  const detailRef = useRef<PostcardDetailSheetRef>(null);
  const { postcards, friends, currentUser, authedUserId } = useMailClub();

  // v0.7.0.50 Simplified Atlas:
  //   1) Aggregate postcards into one stat row per city (sent/received counts).
  //   2) Collapse nearby cities into ~50mi areas (Bay Area = SF + Oakland + ...).
  //   3) Every area with any activity gets ONE dotted line from home.
  //   4) Reciprocated areas get a gold dashed ring on the pin.
  //   5) No size scaling, no pulse, no per-line color/weight variance.
  //   6) Selected area's line goes solid + thicker (handled in MapPanel).
  const cityStats = useMemo(() => {
    const raw = computeCityStats(postcards, friends, authedUserId);
    return groupByArea(raw, 50);
  }, [postcards, friends, authedUserId]);

  // Selected area — tapping a pin OR a line sets this. Drives the
  // line's solid/thicker render in MapPanel via the isNewest flag
  // (repurposed: "newest" → "selected"). When null, no line is solid.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Pin set: home + every area we've sent to or received from. Pins
  // carry reciprocated + selected flags so MapPanel can render gold
  // ring + selection halo.
  const pins: MapCity[] = useMemo(() => {
    const out: MapCity[] = [];
    let homeKey: string | null = null;
    if (currentUser.city || currentUser.state) {
      const homeCoord = resolveCoord(currentUser.city, currentUser.state);
      if (homeCoord) {
        homeKey = toCoordKey(homeCoord);
        const homeName = currentUser.city || currentUser.state || "home";
        out.push({ id: "home", name: homeName, coord: homeCoord });
      }
    }
    for (const s of cityStats) {
      if (homeKey && s.key === homeKey) continue;
      out.push({
        id: `city-${normalizeCityKey(s.cityName)}`,
        name: s.cityName,
        coord: s.coord,
        reciprocated: s.sendCount > 0 && s.receivedCount > 0,
        // Repurpose isNewest as the "selected" flag — MapPanel renders
        // a small dashed halo around the pin when set. Keeping the field
        // name avoids another type churn; conceptually it's "stand out
        // a beat" either way.
        isNewest: selectedKey != null && s.key === selectedKey,
      });
    }
    return out;
  }, [cityStats, selectedKey, currentUser.city, currentUser.state]);

  // Routes — one per area with any activity (sent OR received), all
  // originating from home, all dotted, all coral. The selected route
  // is marked isNewest so MapPanel draws it solid + thicker.
  const mapRoutes: MapRoute[] = useMemo(() => {
    const homeCoord = resolveCoord(currentUser.city, currentUser.state);
    if (!homeCoord) return [];
    const out: MapRoute[] = [];
    for (const s of cityStats) {
      if (s.sendCount === 0 && s.receivedCount === 0) continue;
      out.push({
        from: homeCoord,
        to: s.coord,
        tone: "sent",
        isNewest: selectedKey != null && s.key === selectedKey,
      });
    }
    return out;
  }, [cityStats, selectedKey, currentUser.city, currentUser.state]);

  // v0.7.0.49: subtitle storytelling. Was just "Map"; now shows
  // "X cities · Y cards" when the user has any postcards.
  // v0.7.0.50: exclude home from the cities count — the story is
  // "places I've mailed to/from," not "places I exist."
  const cityCount = pins.filter((p) => p.id !== "home").length;
  const cardCount = postcards.length;
  const subtitle =
    cardCount > 0
      ? `${cityCount} ${cityCount === 1 ? "city" : "cities"} · ${cardCount} ${cardCount === 1 ? "card" : "cards"}`
      : undefined;

  return (
    <BottomSheetModalProvider>
      <AppShell>
        <Header title="Map" subtitle={subtitle} />

        {/* Map fills the body below the header */}
        <View style={styles.mapFrame}>
          <MapPanel
            routes={mapRoutes}
            cities={pins.length > 0 ? pins : undefined}
            onCityPress={(city) => {
              // v0.7.0.50: tap a pin → mark its area selected (the line
              // goes solid + thicker via the isNewest flag on the
              // matching route), then open the city chapter sheet.
              // Home tap is a no-op (no chapter for home).
              if (city.id === "home") return;
              const key = toCoordKey(city.coord);
              setSelectedKey(key);
              sheetRef.current?.open({ kind: "city", cityName: city.name });
            }}
            onRoutePress={(route) => {
              // v0.7.0.50: lines are tappable too. Tapping a polyline
              // is equivalent to tapping its destination pin — find the
              // matching city by coord and treat it as a pin tap.
              const key = toCoordKey(route.to);
              const city = pins.find((p) => toCoordKey(p.coord) === key);
              if (!city) return;
              setSelectedKey(key);
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
      <PostcardPreviewSheet
        ref={sheetRef}
        // v0.7.0.50: clear the selected-area state when the sheet
        // closes so the line goes back to dotted.
        onDismiss={() => setSelectedKey(null)}
        // v1.0.1: hand postcard taps up so we can open the detail sheet
        // instead of routing to /send.
        onTapPostcard={(postcardId) => detailRef.current?.open(postcardId)}
      />
      <PostcardDetailSheet ref={detailRef} />
    </BottomSheetModalProvider>
  );
}

const styles = StyleSheet.create({
  // v0.7.0.23 BUGFIX: explicit height instead of flex:1.
  //
  // The Map screen sits inside AppShell, which uses a ScrollView as its
  // root container. flex:1 inside a ScrollView's contentContainer
  // collapses to height 0 — the entire MapPanel was rendering at zero
  // height, which is why the map screen showed nothing but cream paper.
  //
  // window-height-minus-chrome gives a proper fullscreen-ish map area
  // (Header is ~52, step crumb ~30, tab bar ~90 with the raised FAB,
  // safe-area bottom inset ~30, plus the borderRadius breathing room).
  // When the map screen eventually moves out of AppShell into its own
  // root-level layout (build 38+), this hack goes away.
  //
  // v0.7.0.25: bumped from 220 → 280 because Apple Maps attribution
  // (the "Maps Legal" link at the bottom of every MapView) was being
  // clipped by the floating tab bar. The map view extended *behind*
  // the tab bar and the legal text was rendering in the overlap zone.
  // 280 leaves a clean ~60px gap between the map's bottom edge and
  // the tab bar, so the attribution is fully visible.
  mapFrame: {
    height: Dimensions.get("window").height - 280,
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
