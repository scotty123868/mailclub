import Constants from "expo-constants";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from "react-native-maps";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Ellipse, G, Line, Path, Pattern, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import { sepiaMapStyle } from "@/src/data/sepiaMapStyle";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { CircularPostmark } from "./PostmarkDecoration";
import { PostalCard } from "./PostalCard";

/**
 * MapPanel — real US map with a custom sepia vintage style, overlaid with
 * Mailroom postcard decorations (compass rose, sea monster, MAILROOM
 * cartouche, parchment vignette).
 *
 * v0.5.0 changes (per codex audit):
 *   • Polylines now driven by `routes` prop instead of a hardcoded fixture.
 *     Falls back to demo routes only when no prop is passed (so the My Card
 *     compact preview still has texture for users with zero sends).
 *   • Pan/zoom enabled by default — set `interactive={false}` for the My Card
 *     preview where the map is a tappable target, not a real map.
 *   • Cities can be passed via `cities` prop; defaults to the full demo set.
 *
 * Architecture:
 *   • `react-native-maps` MapView renders the actual map tiles
 *   • Google Maps provider is used when an API key is configured in
 *     `app.json` → ios.config.googleMapsApiKey
 *   • Apple Maps `mutedStandard` is the fallback when no key is configured,
 *     with a sepia tint overlay layered on top
 *   • Routes are drawn as Polyline components, red for sent / green for
 *     received based on the `tone` field on each route.
 *   • Cities are Marker components with custom paper-pin views + serif labels
 */

const GOOGLE_MAPS_KEY = (Constants.expoConfig?.ios as { config?: { googleMapsApiKey?: string } } | undefined)?.config?.googleMapsApiKey ?? "";
const HAS_GOOGLE = GOOGLE_MAPS_KEY.length > 0;

export type Geo = { latitude: number; longitude: number };

export type MapCity = {
  id: string;
  name: string;
  coord: Geo;
  accent?: boolean;
  /**
   * v0.7.0.7: pending-send marker. Used for cards sent via the
   * "share-a-link" flow where the recipient hasn't claimed yet. The pin
   * gets a dashed gold ring + italic label so the user can see "yeah I
   * sent something, it's waiting on them" right after their first send.
   */
  pending?: boolean;
  /** Postcard id this pending pin represents. Tap → open detail sheet
   *  with the claim URL + "Share again" button. */
  pendingPostcardId?: string;
};

export type MapRoute = { from: Geo; to: Geo; tone?: "sent" | "received" };

// Default demo set — used by the My Card preview AND as a coord lookup table
// for the Map tab when deriving real routes from user postcards.
export const DEMO_CITIES: MapCity[] = [
  { id: "vancouver", name: "VANCOUVER", coord: { latitude: 49.2827, longitude: -123.1207 }, accent: true },
  { id: "san_francisco", name: "SAN FRANCISCO", coord: { latitude: 37.7749, longitude: -122.4194 } },
  { id: "denver", name: "DENVER", coord: { latitude: 39.7392, longitude: -104.9903 }, accent: true },
  { id: "austin", name: "AUSTIN", coord: { latitude: 30.2672, longitude: -97.7431 } },
  { id: "chicago", name: "CHICAGO", coord: { latitude: 41.8781, longitude: -87.6298 } },
  { id: "nashville", name: "NASHVILLE", coord: { latitude: 36.1627, longitude: -86.7816 } },
  { id: "new_york", name: "NEW YORK", coord: { latitude: 40.7128, longitude: -74.006 } },
];

const DEMO_ROUTE_PAIRS: Array<[string, string]> = [
  ["denver", "vancouver"],
  ["denver", "chicago"],
  ["denver", "nashville"],
  ["denver", "san_francisco"],
  ["denver", "austin"],
  ["chicago", "new_york"],
  ["nashville", "new_york"],
  ["austin", "nashville"],
];

const DEMO_ROUTES: MapRoute[] = DEMO_ROUTE_PAIRS.map(([from, to]) => ({
  from: DEMO_CITIES.find((c) => c.id === from)!.coord,
  to: DEMO_CITIES.find((c) => c.id === to)!.coord,
  tone: "sent",
}));

/**
 * Normalize a city name to the canonical key used by `CITY_COORDS`.
 *
 * Strips a state/country suffix after a comma (so "Denver, CO" hits "denver"),
 * collapses whitespace, lowercases. Lookups and table construction MUST go
 * through this — otherwise " Denver " or "DENVER" or "Denver, CO" silently
 * drop from the polyline render. (codex P2, Phase 1 review.)
 */
export function normalizeCityKey(input: string): string {
  if (!input) return "";
  return input.split(",")[0].trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Lookup table for the Map tab: normalized city name → Geo. Expanded in
 * v0.7.0.10 to cover all 50 state capitals + ~30 of the largest US metros
 * + common DC-metro suburbs (Bethesda, Silver Spring, Arlington, etc.)
 * so most users' home + destination cities resolve to a pin without
 * needing a live geocoding round-trip. When a city isn't here, we fall
 * back to Nominatim-based on-the-fly geocoding (see GEOCODE_CACHE in
 * map.tsx) which caches results to AsyncStorage.
 */
const EXTRA_CITIES: Array<[string, Geo]> = [
  // DC metro (user's own city: Bethesda, MD)
  ["bethesda", { latitude: 38.9847, longitude: -77.0947 }],
  ["silver spring", { latitude: 38.9907, longitude: -77.0261 }],
  ["arlington", { latitude: 38.8816, longitude: -77.0910 }],
  ["alexandria", { latitude: 38.8048, longitude: -77.0469 }],
  ["washington", { latitude: 38.9072, longitude: -77.0369 }],
  ["chevy chase", { latitude: 38.9686, longitude: -77.0872 }],
  // 50 state capitals
  ["montgomery", { latitude: 32.3792, longitude: -86.3077 }],
  ["juneau", { latitude: 58.3019, longitude: -134.4197 }],
  ["phoenix", { latitude: 33.4484, longitude: -112.0740 }],
  ["little rock", { latitude: 34.7465, longitude: -92.2896 }],
  ["sacramento", { latitude: 38.5816, longitude: -121.4944 }],
  ["hartford", { latitude: 41.7637, longitude: -72.6851 }],
  ["dover", { latitude: 39.1582, longitude: -75.5244 }],
  ["tallahassee", { latitude: 30.4383, longitude: -84.2807 }],
  ["atlanta", { latitude: 33.7490, longitude: -84.3880 }],
  ["honolulu", { latitude: 21.3069, longitude: -157.8583 }],
  ["boise", { latitude: 43.6150, longitude: -116.2023 }],
  ["springfield", { latitude: 39.7817, longitude: -89.6501 }],
  ["indianapolis", { latitude: 39.7684, longitude: -86.1581 }],
  ["des moines", { latitude: 41.5868, longitude: -93.6250 }],
  ["topeka", { latitude: 39.0473, longitude: -95.6752 }],
  ["frankfort", { latitude: 38.2009, longitude: -84.8733 }],
  ["baton rouge", { latitude: 30.4515, longitude: -91.1871 }],
  ["augusta", { latitude: 44.3106, longitude: -69.7795 }],
  ["annapolis", { latitude: 38.9784, longitude: -76.4922 }],
  ["boston", { latitude: 42.3601, longitude: -71.0589 }],
  ["lansing", { latitude: 42.7325, longitude: -84.5555 }],
  ["saint paul", { latitude: 44.9537, longitude: -93.0900 }],
  ["jackson", { latitude: 32.2988, longitude: -90.1848 }],
  ["jefferson city", { latitude: 38.5767, longitude: -92.1735 }],
  ["helena", { latitude: 46.5891, longitude: -112.0391 }],
  ["lincoln", { latitude: 40.8136, longitude: -96.7026 }],
  ["carson city", { latitude: 39.1638, longitude: -119.7674 }],
  ["concord", { latitude: 43.2081, longitude: -71.5376 }],
  ["trenton", { latitude: 40.2206, longitude: -74.7597 }],
  ["santa fe", { latitude: 35.6870, longitude: -105.9378 }],
  ["albany", { latitude: 42.6526, longitude: -73.7562 }],
  ["raleigh", { latitude: 35.7796, longitude: -78.6382 }],
  ["bismarck", { latitude: 46.8083, longitude: -100.7837 }],
  ["columbus", { latitude: 39.9612, longitude: -82.9988 }],
  ["oklahoma city", { latitude: 35.4676, longitude: -97.5164 }],
  ["salem", { latitude: 44.9429, longitude: -123.0351 }],
  ["harrisburg", { latitude: 40.2732, longitude: -76.8867 }],
  ["providence", { latitude: 41.8240, longitude: -71.4128 }],
  ["columbia", { latitude: 34.0007, longitude: -81.0348 }],
  ["pierre", { latitude: 44.3683, longitude: -100.3510 }],
  ["nashville", { latitude: 36.1627, longitude: -86.7816 }],
  ["austin", { latitude: 30.2672, longitude: -97.7431 }],
  ["salt lake city", { latitude: 40.7608, longitude: -111.8910 }],
  ["montpelier", { latitude: 44.2601, longitude: -72.5754 }],
  ["richmond", { latitude: 37.5407, longitude: -77.4360 }],
  ["olympia", { latitude: 47.0379, longitude: -122.9007 }],
  ["charleston", { latitude: 38.3498, longitude: -81.6326 }],
  ["madison", { latitude: 43.0731, longitude: -89.4012 }],
  ["cheyenne", { latitude: 41.1399, longitude: -104.8202 }],
  // Major US metros not already covered
  ["new york", { latitude: 40.7128, longitude: -74.0060 }],
  ["los angeles", { latitude: 34.0522, longitude: -118.2437 }],
  ["chicago", { latitude: 41.8781, longitude: -87.6298 }],
  ["houston", { latitude: 29.7604, longitude: -95.3698 }],
  ["philadelphia", { latitude: 39.9526, longitude: -75.1652 }],
  ["san antonio", { latitude: 29.4241, longitude: -98.4936 }],
  ["san diego", { latitude: 32.7157, longitude: -117.1611 }],
  ["dallas", { latitude: 32.7767, longitude: -96.7970 }],
  ["san jose", { latitude: 37.3382, longitude: -121.8863 }],
  ["jacksonville", { latitude: 30.3322, longitude: -81.6557 }],
  ["fort worth", { latitude: 32.7555, longitude: -97.3308 }],
  ["el paso", { latitude: 31.7619, longitude: -106.4850 }],
  ["detroit", { latitude: 42.3314, longitude: -83.0458 }],
  ["seattle", { latitude: 47.6062, longitude: -122.3321 }],
  ["denver", { latitude: 39.7392, longitude: -104.9903 }],
  ["portland", { latitude: 45.5152, longitude: -122.6784 }],
  ["las vegas", { latitude: 36.1699, longitude: -115.1398 }],
  ["memphis", { latitude: 35.1495, longitude: -90.0490 }],
  ["louisville", { latitude: 38.2527, longitude: -85.7585 }],
  ["milwaukee", { latitude: 43.0389, longitude: -87.9065 }],
  ["albuquerque", { latitude: 35.0844, longitude: -106.6504 }],
  ["tucson", { latitude: 32.2226, longitude: -110.9747 }],
  ["fresno", { latitude: 36.7378, longitude: -119.7871 }],
  ["miami", { latitude: 25.7617, longitude: -80.1918 }],
  ["minneapolis", { latitude: 44.9778, longitude: -93.2650 }],
  ["cleveland", { latitude: 41.4993, longitude: -81.6944 }],
  ["pittsburgh", { latitude: 40.4406, longitude: -79.9959 }],
  ["cincinnati", { latitude: 39.1031, longitude: -84.5120 }],
  ["new orleans", { latitude: 29.9511, longitude: -90.0715 }],
  ["orlando", { latitude: 28.5384, longitude: -81.3789 }],
  ["tampa", { latitude: 27.9506, longitude: -82.4572 }],
  ["san francisco", { latitude: 37.7749, longitude: -122.4194 }],
  ["oakland", { latitude: 37.8044, longitude: -122.2712 }],
  ["berkeley", { latitude: 37.8716, longitude: -122.2727 }],
  ["palo alto", { latitude: 37.4419, longitude: -122.1430 }],
  ["mountain view", { latitude: 37.3861, longitude: -122.0839 }],
  ["brooklyn", { latitude: 40.6782, longitude: -73.9442 }],
  ["queens", { latitude: 40.7282, longitude: -73.7949 }],
  ["bronx", { latitude: 40.8448, longitude: -73.8648 }],
  ["manhattan", { latitude: 40.7831, longitude: -73.9712 }],
];

export const CITY_COORDS: Record<string, Geo> = (() => {
  const map: Record<string, Geo> = {};
  for (const c of DEMO_CITIES) {
    map[c.id] = c.coord;
    map[normalizeCityKey(c.name)] = c.coord;
    map[normalizeCityKey(c.name.replace(/_/g, " "))] = c.coord;
  }
  for (const [key, coord] of EXTRA_CITIES) {
    map[normalizeCityKey(key)] = coord;
  }
  return map;
})();

// Continental US framing — centered roughly on Kansas, framed to include
// Vancouver in the NW and Miami in the SE.
const INITIAL_REGION = {
  latitude: 39.5,
  longitude: -98.5,
  latitudeDelta: 32,
  longitudeDelta: 60,
};

const COMPACT_REGION = {
  latitude: 39.5,
  longitude: -98.5,
  latitudeDelta: 36,
  longitudeDelta: 64,
};

export function MapPanel({
  compact = false,
  interactive,
  routes,
  cities,
  onCityPress,
  highlightRoute,
}: {
  compact?: boolean;
  /**
   * If true, the underlying MapView accepts pan / zoom / rotate gestures.
   * Defaults to `!compact` so the full Map tab is interactive and the My Card
   * preview is locked (it's a tap target, not a real map).
   */
  interactive?: boolean;
  /**
   * Routes to draw as polylines. Omit to use the demo fixture (useful for
   * the My Card preview when the user has zero real sends).
   */
  routes?: MapRoute[];
  /**
   * Cities to render as markers. Omit to use the demo set.
   */
  cities?: MapCity[];
  /**
   * v0.7.0.4 C.3: callback fired when a city Marker is tapped. The Map
   * tab uses this to open a postcard-preview bottom sheet filtered to
   * that city. Omit for previews / compact mode where pins are
   * decorative.
   */
  onCityPress?: (city: MapCity) => void;
  /**
   * v0.7.0.5 D.2: when a pin is tapped, the Map tab passes a
   * highlightRoute to draw a brighter polyline from the tapped city
   * to a reference city (typically the user&apos;s home). The line
   * appears INSTANTLY with a strong stroke + no dash — distinct
   * from the ambient routes — and disappears when the sheet closes.
   */
  highlightRoute?: MapRoute | null;
}) {
  const height = compact ? 168 : 260;
  const liveInteractive = interactive ?? !compact;
  const renderRoutes = routes ?? (compact ? DEMO_ROUTES : []);
  // v0.7.0.10: stop falling back to DEMO_CITIES in full Map view. If the
  // user has no postcards (cities undefined) we render an empty map so
  // the geography reads as "your map, currently quiet" rather than
  // pre-populated with cities the user has never sent a card to.
  const renderCities = cities ?? (compact ? DEMO_CITIES : []);

  // Full Map view (non-compact): render the map full-bleed without the
  // PostalCard's parchment border, since the screen frames it for us.
  // Compact preview keeps the card chrome so the My Card tile reads as
  // a finished surface.
  const Wrapper = compact ? PostalCard : View;

  return (
    <Wrapper style={compact ? [styles.card, styles.compactCard] : styles.fullBleedWrap}>
      {/* When compact (My Card preview), `pointerEvents="none"` lets touches
          pass through to the outer Pressable so tapping the preview navigates
          to /map. Without this, MapView swallows the tap even with
          scroll/zoom disabled. (codex P1, Phase 1 review.) */}
      <View
        style={compact ? [styles.mapWrap, { height }] : styles.mapWrapFull}
        pointerEvents={compact ? "none" : "auto"}
      >
        <MapView
          style={StyleSheet.absoluteFill}
          provider={HAS_GOOGLE ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
          customMapStyle={HAS_GOOGLE ? sepiaMapStyle : undefined}
          mapType={HAS_GOOGLE ? "standard" : "mutedStandard"}
          initialRegion={compact ? COMPACT_REGION : INITIAL_REGION}
          scrollEnabled={liveInteractive}
          zoomEnabled={liveInteractive}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          showsScale={false}
          showsBuildings={false}
          showsTraffic={false}
          showsIndoors={false}
          showsPointsOfInterest={false}
          loadingEnabled
          loadingBackgroundColor="#E8D5A8"
          loadingIndicatorColor="#4A3520"
        >
          {/* Routes — colored dashed arcs between coord pairs. Red = sent
              (default), sage green = received. */}
          {renderRoutes.map((r, i) => (
            <Polyline
              key={`route-${i}`}
              coordinates={[r.from, r.to]}
              strokeColor={r.tone === "received" ? "#607A55" : colors.postalRed}
              strokeWidth={2}
              lineDashPattern={[6, 4]}
              geodesic
            />
          ))}

          {/* v0.7.0.5 D.2: highlight polyline when a pin is tapped.
              Solid (no dash), thicker, brighter. Renders on top of the
              ambient routes so the user can clearly see the line
              connecting the tapped city to home. */}
          {highlightRoute ? (
            <Polyline
              key="highlight-route"
              coordinates={[highlightRoute.from, highlightRoute.to]}
              strokeColor={colors.postalRed}
              strokeWidth={3.5}
              geodesic
              zIndex={10}
            />
          ) : null}

          {/* Cities — custom paper-pin marker with serif label.
              tracksViewChanges defaults to true for the first render so
              the entrance animation actually composites, then we'd
              ideally disable it once settled. Marker's animation
              behavior with React Native Reanimated is fiddly across
              iOS/Android; we leave the marker tracking on for v0.7.0.5
              and accept a tiny CPU cost during the 300ms drop. */}
          {!compact &&
            renderCities.map((c, idx) => (
              <Marker
                key={c.id}
                coordinate={c.coord}
                anchor={{ x: 0.5, y: 0.5 }}
                onPress={onCityPress ? () => onCityPress(c) : undefined}
              >
                <CityPin
                  name={c.name}
                  accent={!!c.accent}
                  pending={!!c.pending}
                  staggerIndex={idx}
                />
              </Marker>
            ))}

          {compact &&
            renderCities.filter((c) => c.accent).map((c) => (
              <Marker key={c.id} coordinate={c.coord} anchor={{ x: 0.5, y: 0.5 }}>
                <CityDot accent />
              </Marker>
            ))}
        </MapView>

        {/* v0.7.0.10: stripped the vintage decorations (sepia tint,
            parchment frame, cartouche badge, compass rose, postmark
            overlay) per user feedback — wanted Apple Maps full-bleed,
            not a "framed postcard" treatment. Compact preview still
            uses ParchmentFrame because the My Card preview tile reads
            better with a border. */}
        {compact ? (
          <View style={styles.borderOverlay} pointerEvents="none">
            <ParchmentFrame compact={compact} />
          </View>
        ) : null}
      </View>
    </Wrapper>
  );
}

// ────────────────────────────────────────────────────────────────
// Custom marker views
// ────────────────────────────────────────────────────────────────

function CityPin({
  name,
  accent,
  pending = false,
  staggerIndex = 0,
}: {
  name: string;
  accent: boolean;
  pending?: boolean;
  staggerIndex?: number;
}) {
  // v0.7.0.5 D.2: drop-in entrance animation. Each pin springs in
  // with a small downward offset → settles, delayed by staggerIndex *
  // 60ms so a map full of pins draws in a satisfying cascade rather
  // than appearing all at once. ~300ms per pin from offset → settled.
  // Hoisted to Reanimated shared values so the animation runs on the
  // UI thread, never the JS thread.
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-8);
  const scale = useSharedValue(0.7);

  useEffect(() => {
    const delay = staggerIndex * 60;
    opacity.value = withDelay(delay, withTiming(1, { duration: 240 }));
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: 300, easing: Easing.bezier(0.34, 1.56, 0.64, 1) }),
    );
    scale.value = withDelay(
      delay,
      withTiming(1, { duration: 300, easing: Easing.bezier(0.34, 1.56, 0.64, 1) }),
    );
  }, [opacity, translateY, scale, staggerIndex]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View style={[pinStyles.wrap, animStyle]}>
      <View
        style={[
          pinStyles.dot,
          accent && pinStyles.dotAccent,
          pending && pinStyles.dotPending,
        ]}
      >
        <View
          style={[
            pinStyles.core,
            accent && pinStyles.coreAccent,
            pending && pinStyles.corePending,
          ]}
        />
      </View>
      <View style={[pinStyles.labelWrap, pending && pinStyles.labelWrapPending]}>
        <Text
          style={[pinStyles.label, pending && pinStyles.labelPending]}
          numberOfLines={1}
        >
          {name}
        </Text>
      </View>
    </Animated.View>
  );
}

function CityDot({ accent }: { accent: boolean }) {
  return (
    <View style={[pinStyles.dot, accent && pinStyles.dotAccent]}>
      <View style={[pinStyles.core, accent && pinStyles.coreAccent]} />
    </View>
  );
}

const pinStyles = StyleSheet.create({
  wrap: { alignItems: "center" },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#EFDDB5",
    borderWidth: 1.1,
    borderColor: "#4A3520",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2B1A08",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  dotAccent: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  // v0.7.0.7: pending-send pin — dashed gold ring + warm inner. Reads as
  // "still waiting on something" without competing with the bold red
  // delivered/sent pins.
  dotPending: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FBEFD6",
    borderColor: colors.gold,
    borderStyle: "dashed",
    borderWidth: 1.5,
  },
  core: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2B1A08",
  },
  coreAccent: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.postalRed,
  },
  corePending: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.gold,
  },
  labelWrap: {
    marginTop: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  labelWrapPending: {
    backgroundColor: "rgba(217,180,110,0.18)",
    borderRadius: 3,
  },
  label: {
    color: "#2B1A08",
    fontFamily: fonts.serifBold,
    fontSize: 10,
    letterSpacing: 0.8,
    // Soft halo so the label stays legible over any color the map paints
    textShadowColor: "rgba(232, 213, 168, 0.95)",
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 0 },
  },
  labelPending: {
    color: "#6E5421",
    fontFamily: fonts.serifItalic,
    letterSpacing: 0.4,
    textTransform: "none",
  },
});

// ────────────────────────────────────────────────────────────────
// Overlay decorations
// ────────────────────────────────────────────────────────────────

/**
 * Parchment frame — a soft inner shadow + corner ticks + vignette around
 * the live map, so it reads as a postcard cutout rather than a modern UI.
 *
 * Overlay sits on top of the live MapView to push Apple's standard tiles
 * into vintage parchment territory:
 *   • paper-grain dot pattern (subtle texture)
 *   • deeper edge vignette so the center feels framed
 *   • age stains in opposing corners
 *   • corner survey ticks (compositional touch)
 *
 * All decorations are positioned in normalized 100×100 space and stretched to
 * fit the map's actual rendered size via preserveAspectRatio="none".
 */
function ParchmentFrame({ compact }: { compact?: boolean }) {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={StyleSheet.absoluteFill}
    >
      <Defs>
        <RadialGradient id="map-vignette" cx="50%" cy="50%" rx="75%" ry="65%">
          <Stop offset="0.45" stopColor="#2B1A08" stopOpacity={0} />
          <Stop offset="1" stopColor="#2B1A08" stopOpacity={0.45} />
        </RadialGradient>
        <RadialGradient id="map-stain" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#7A4A1C" stopOpacity={0.28} />
          <Stop offset="1" stopColor="#7A4A1C" stopOpacity={0} />
        </RadialGradient>
        <Pattern id="paper-grain" patternUnits="userSpaceOnUse" width="1.2" height="1.2">
          <Rect width="1.2" height="1.2" fill="rgba(0,0,0,0)" />
          <Circle cx="0.3" cy="0.3" r="0.06" fill="#5A3920" opacity={0.18} />
          <Circle cx="0.9" cy="0.8" r="0.05" fill="#5A3920" opacity={0.12} />
        </Pattern>
      </Defs>

      {/* Paper-grain texture across the whole map */}
      <Rect x="0" y="0" width="100" height="100" fill="url(#paper-grain)" />

      {/* Age stains — corners + scattered */}
      {!compact && (
        <G>
          <Ellipse cx="12" cy="12" rx="22" ry="9" fill="url(#map-stain)" />
          <Ellipse cx="86" cy="8" rx="18" ry="6" fill="url(#map-stain)" />
          <Ellipse cx="92" cy="92" rx="14" ry="10" fill="url(#map-stain)" />
          <Ellipse cx="40" cy="95" rx="28" ry="5" fill="url(#map-stain)" />
        </G>
      )}

      {/* Corner survey ticks — set apart from the bezel */}
      <G stroke="#2B1A08" strokeWidth={0.35} fill="none" opacity={0.75}>
        <Line x1="2" y1="4" x2="5" y2="4" />
        <Line x1="2" y1="4" x2="2" y2="7" />
        <Line x1="98" y1="4" x2="95" y2="4" />
        <Line x1="98" y1="4" x2="98" y2="7" />
        <Line x1="2" y1="96" x2="5" y2="96" />
        <Line x1="2" y1="96" x2="2" y2="93" />
        <Line x1="98" y1="96" x2="95" y2="96" />
        <Line x1="98" y1="96" x2="98" y2="93" />
      </G>

      {/* Faint wave hatching across the open Pacific and Atlantic */}
      {!compact && (
        <G stroke="#3A2410" strokeWidth={0.18} fill="none" opacity={0.35}>
          <Path d="M 2 38 Q 4 37, 6 38" />
          <Path d="M 2 44 Q 4 43, 6 44" />
          <Path d="M 2 64 Q 4 63, 6 64" />
          <Path d="M 2 72 Q 4 71, 6 72" />
          <Path d="M 2 80 Q 4 79, 6 80" />
          <Path d="M 92 45 Q 94 44, 96 45" />
          <Path d="M 92 52 Q 94 51, 96 52" />
          <Path d="M 92 60 Q 94 59, 96 60" />
          <Path d="M 92 68 Q 94 67, 96 68" />
          <Path d="M 92 75 Q 94 74, 96 75" />
          <Path d="M 92 82 Q 94 81, 96 82" />
        </G>
      )}

      {/* Vignette — darken edges */}
      <Rect x="0" y="0" width="100" height="100" fill="url(#map-vignette)" />
    </Svg>
  );
}

/**
 * 8-point vintage compass rose — drawn fully in SVG, positioned in the
 * lower-right corner of the map card.
 */
function CompassRose() {
  return (
    <View style={overlayStyles.compass} pointerEvents="none">
      <Svg width={56} height={56} viewBox="-22 -22 44 44">
        <Circle cx={0} cy={0} r={20} fill="#EFDDB5" stroke="#4A3520" strokeWidth={0.8} />
        <Circle cx={0} cy={0} r={14} fill="none" stroke="#6B5535" strokeWidth={0.4} />
        <Path d="M 0 -19 L 3 0 L 0 19 L -3 0 Z" fill="#2B1A08" />
        <Path d="M -19 0 L 0 3 L 19 0 L 0 -3 Z" fill="#2B1A08" opacity={0.55} />
        <G rotation={45}>
          <Path d="M 0 -14 L 2 0 L 0 14 L -2 0 Z" fill="#6B5535" opacity={0.7} />
          <Path d="M -14 0 L 0 2 L 14 0 L 0 -2 Z" fill="#6B5535" opacity={0.5} />
        </G>
        <Path d="M 0 -20 L -1.5 -16 L 0 -14 L 1.5 -16 Z" fill="#2B1A08" />
        <SvgText
          x={0}
          y={-22}
          textAnchor="middle"
          fill="#2B1A08"
          fontSize={7}
          fontFamily="CormorantGaramond_700Bold"
          letterSpacing={0.3}
        >
          N
        </SvgText>
        <Circle cx={0} cy={0} r={1.2} fill="#2B1A08" />
      </Svg>
    </View>
  );
}

/**
 * MAILROOM cartouche — vintage ribbon-style badge sitting bottom-left.
 */
function CartoucheBadge() {
  return (
    <View style={overlayStyles.cartouche} pointerEvents="none">
      <Svg width={120} height={28} viewBox="-60 -14 120 28">
        <Path d="M -52 -10 L 52 -10 L 58 0 L 52 10 L -52 10 L -58 0 Z" fill="#EFDDB5" stroke="#4A3520" strokeWidth={0.8} />
        <Path
          d="M -52 -10 L 52 -10 L 58 0 L 52 10 L -52 10 L -58 0 Z"
          fill="none"
          stroke="#6B5535"
          strokeWidth={0.4}
          opacity={0.6}
          transform="translate(1.5 1.5)"
        />
        <SvgText
          x={0}
          y={3}
          textAnchor="middle"
          fill="#2B1A08"
          fontSize={10}
          fontFamily="CormorantGaramond_700Bold"
          letterSpacing={2.6}
        >
          MAILROOM
        </SvgText>
      </Svg>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: { overflow: "hidden", padding: 0 },
  compactCard: { minHeight: 168 },
  fullBleedWrap: { flex: 1, backgroundColor: "transparent" },
  mapWrap: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
    backgroundColor: "#E8D5A8",
  },
  mapWrapFull: {
    position: "relative",
    flex: 1,
    width: "100%",
    overflow: "hidden",
    backgroundColor: "#E8D5A8",
  },
  sepiaTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(170, 105, 45, 0.5)",
  },
  borderOverlay: { ...StyleSheet.absoluteFillObject },
  decorationsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(201, 166, 107, 0.35)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#6B5535",
  },
  postmarkOverlay: { position: "absolute", right: 10, top: 10, opacity: 0.65 },
});

const overlayStyles = StyleSheet.create({
  compass: { paddingBottom: 4 },
  cartouche: { paddingBottom: 6 },
});
