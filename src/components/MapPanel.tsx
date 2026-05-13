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
 * Lookup table for the Map tab: normalized city name → Geo. Cities outside
 * this list silently drop from the polyline render until we ship real
 * geocoding in 0.5.1.
 */
export const CITY_COORDS: Record<string, Geo> = Object.fromEntries(
  DEMO_CITIES.flatMap((c) => [
    [c.id, c.coord],
    [normalizeCityKey(c.name), c.coord],
    [normalizeCityKey(c.name.replace(/_/g, " ")), c.coord],
  ]),
);

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
  const renderCities = cities ?? DEMO_CITIES;

  return (
    <PostalCard style={[styles.card, compact && styles.compactCard]}>
      {/* When compact (My Card preview), `pointerEvents="none"` lets touches
          pass through to the outer Pressable so tapping the preview navigates
          to /map. Without this, MapView swallows the tap even with
          scroll/zoom disabled. (codex P1, Phase 1 review.) */}
      <View
        style={[styles.mapWrap, { height }]}
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

        {/* Sepia tint overlay — only applies on the Apple Maps fallback path,
            where the live map keeps its standard colors. With Google + custom
            style, the style JSON already paints the map sepia. */}
        {!HAS_GOOGLE && <View style={styles.sepiaTint} pointerEvents="none" />}

        {/* Parchment border + vignette — drawn over the map for "framed
            postcard" feel. pointerEvents=none lets the map stay interactive. */}
        <View style={styles.borderOverlay} pointerEvents="none">
          <ParchmentFrame compact={compact} />
        </View>
      </View>

      {/* Decorations row beneath the map */}
      {!compact && (
        <View style={styles.decorationsRow} pointerEvents="none">
          <CartoucheBadge />
          <CompassRose />
        </View>
      )}

      {!compact && (
        <View style={styles.postmarkOverlay} pointerEvents="none">
          <CircularPostmark size={64} opacity={0.4} />
        </View>
      )}
    </PostalCard>
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
  mapWrap: {
    position: "relative",
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
