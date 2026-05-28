import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from "react-native-maps";
import Animated, {
 Easing,
 useAnimatedStyle,
 useSharedValue,
 withDelay,
 withTiming,
} from "react-native-reanimated";
import { useReducedMotion } from "@/src/lib/useReducedMotion";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Line, Path, Pattern, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import { sepiaMapStyle } from "@/src/data/sepiaMapStyle";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { CircularPostmark } from "./PostmarkDecoration";
import { PostalCard } from "./PostalCard";

/**
 * MapPanel. real US map with a custom sepia vintage style, overlaid with
 * Mailroom postcard decorations (compass rose, sea monster, MAILROOM
 * cartouche, parchment vignette).
 *
 * v0.5.0 changes (per codex audit):
 * • Polylines now driven by `routes` prop instead of a hardcoded fixture.
 * Falls back to demo routes only when no prop is passed (so the My Card
 * compact preview still has texture for users with zero sends).
 * • Pan/zoom enabled by default. set `interactive={false}` for the My Card
 * preview where the map is a tappable target, not a real map.
 * • Cities can be passed via `cities` prop; defaults to the full demo set.
 *
 * Architecture:
 * • `react-native-maps` MapView renders the actual map tiles
 * • Google Maps provider is used when an API key is configured in
 * `app.json` → ios.config.googleMapsApiKey
 * • Apple Maps `mutedStandard` is the fallback when no key is configured,
 * with a sepia tint overlay layered on top
 * • Routes are drawn as Polyline components, red for sent / green for
 * received based on the `tone` field on each route.
 * • Cities are Marker components with custom paper-pin views + serif labels
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
 *
 * v0.7.0.50: pending pins were removed from the Map tab (kept as a
 * prop for future use / map preview reuse).
 */
 pending?: boolean;
 /** Postcard id this pending pin represents. Tap → open detail sheet
 * with the claim URL + "Share again" button. */
 pendingPostcardId?: string;
 /**
 * v0.7.0.50 Map "Option 4". per-destination signals so the pin can
 * render the user's relationship with this city at a glance.
 */
 /** How many postcards we've sent to this city. Pin scales with count;
 * 3+ unlocks the "accent" treatment. */
 sendCount?: number;
 /** True when we've both sent to AND received from this city. earns a
 * gold dashed ring around the pin. The whole point of the product. */
 reciprocated?: boolean;
 /** True for the destination of the user's most-recent send. Pin
 * gently pulses to mark "this just went out." */
 isNewest?: boolean;
 /** True when we've received from this city but never sent back. Pin
 * paints sage instead of red/gold and gets no outgoing line. */
 receivedOnly?: boolean;
};

export type MapRoute = {
 from: Geo;
 to: Geo;
 tone?: "sent" | "received";
 /**
 * v0.7.0.50 Map "Option 4". visual weighting per route.
 * weight: line thickness, scales with sendCount to this city.
 * opacity: 0.25–1.0, decays with months since most recent send.
 * isNewest: rendered solid (no dash) so the latest line "snaps."
 */
 weight?: number;
 opacity?: number;
 isNewest?: boolean;
};


// Default demo set. used by the My Card preview AND as a coord lookup table
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
 * through this. otherwise " Denver " or "DENVER" or "Denver, CO" silently
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

/**
 * v0.7.0.19: state-center fallback for cities we don't have hardcoded.
 *
 * Bug we're fixing: a user typed "Aurora, CO" as their address. Aurora is
 * the third-biggest city in Colorado but it isn't in CITY_COORDS. so
 * pins.length stayed 0, the user saw an empty map, and assumed the map
 * was broken. Same story for any user in a suburb or mid-tier city we
 * haven't enumerated.
 *
 * Use this map's coords as a fallback when a city isn't found by name.
 * Pin lands at the state's geographic center / capital. close enough
 * that the user reads it as "yes, that's my region" without needing
 * thousands of entries in CITY_COORDS. When we later wire Lob address
 * verification (which returns lat/lng), we'll store coords directly on
 * the friend / profile row and skip both lookup tables.
 */
export const STATE_COORDS: Record<string, Geo> = {
 AL: { latitude: 32.806671, longitude: -86.79113 },
 AK: { latitude: 61.370716, longitude: -152.404419 },
 AZ: { latitude: 33.729759, longitude: -111.431221 },
 AR: { latitude: 34.969704, longitude: -92.373123 },
 CA: { latitude: 36.116203, longitude: -119.681564 },
 CO: { latitude: 39.059811, longitude: -105.311104 },
 CT: { latitude: 41.597782, longitude: -72.755371 },
 DE: { latitude: 39.318523, longitude: -75.507141 },
 DC: { latitude: 38.897438, longitude: -77.026817 },
 FL: { latitude: 27.766279, longitude: -81.686783 },
 GA: { latitude: 33.040619, longitude: -83.643074 },
 HI: { latitude: 21.094318, longitude: -157.498337 },
 ID: { latitude: 44.240459, longitude: -114.478828 },
 IL: { latitude: 40.349457, longitude: -88.986137 },
 IN: { latitude: 39.849426, longitude: -86.258278 },
 IA: { latitude: 42.011539, longitude: -93.210526 },
 KS: { latitude: 38.5266, longitude: -96.726486 },
 KY: { latitude: 37.66814, longitude: -84.670067 },
 LA: { latitude: 31.169546, longitude: -91.867805 },
 ME: { latitude: 44.693947, longitude: -69.381927 },
 MD: { latitude: 39.063946, longitude: -76.802101 },
 MA: { latitude: 42.230171, longitude: -71.530106 },
 MI: { latitude: 43.326618, longitude: -84.536095 },
 MN: { latitude: 45.694454, longitude: -93.900192 },
 MS: { latitude: 32.741646, longitude: -89.678696 },
 MO: { latitude: 38.456085, longitude: -92.288368 },
 MT: { latitude: 46.921925, longitude: -110.454353 },
 NE: { latitude: 41.12537, longitude: -98.268082 },
 NV: { latitude: 38.313515, longitude: -117.055374 },
 NH: { latitude: 43.452492, longitude: -71.563896 },
 NJ: { latitude: 40.298904, longitude: -74.521011 },
 NM: { latitude: 34.840515, longitude: -106.248482 },
 NY: { latitude: 42.165726, longitude: -74.948051 },
 NC: { latitude: 35.630066, longitude: -79.806419 },
 ND: { latitude: 47.528912, longitude: -99.784012 },
 OH: { latitude: 40.388783, longitude: -82.764915 },
 OK: { latitude: 35.565342, longitude: -96.928917 },
 OR: { latitude: 44.572021, longitude: -122.070938 },
 PA: { latitude: 40.590752, longitude: -77.209755 },
 RI: { latitude: 41.680893, longitude: -71.51178 },
 SC: { latitude: 33.856892, longitude: -80.945007 },
 SD: { latitude: 44.299782, longitude: -99.438828 },
 TN: { latitude: 35.747845, longitude: -86.692345 },
 TX: { latitude: 31.054487, longitude: -97.563461 },
 UT: { latitude: 40.150032, longitude: -111.862434 },
 VT: { latitude: 44.045876, longitude: -72.710686 },
 VA: { latitude: 37.769337, longitude: -78.169968 },
 WA: { latitude: 47.400902, longitude: -121.490494 },
 WV: { latitude: 38.491226, longitude: -80.954453 },
 WI: { latitude: 44.268543, longitude: -89.616508 },
 WY: { latitude: 42.755966, longitude: -107.30249 },
};

/**
 * Resolve a city name to a coord. Tries the exact lookup first, falls
 * back to the state center if a 2-letter state code is provided. Returns
 * null only when both fail (e.g. unknown city + missing/foreign state).
 *
 * Use this everywhere instead of `CITY_COORDS[normalizeCityKey(city)]`
 * directly. the fallback is what lets users in Aurora / Bethesda /
 * any sub-major city actually see pins.
 */
export function resolveCoord(city: string | null | undefined, state?: string | null): Geo | null {
 if (city) {
 const hit = CITY_COORDS[normalizeCityKey(city)];
 if (hit) return hit;
 }
 if (state) {
 const upper = state.trim().toUpperCase();
 if (upper && STATE_COORDS[upper]) return STATE_COORDS[upper];
 }
 return null;
}

// Continental US framing. centered roughly on Kansas, framed to include
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
 onRoutePress,
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
 * v0.7.0.50: callback fired when a route (Polyline) is tapped. Lines
 * are tappable in the Simplified Atlas. tapping a line is
 * equivalent to tapping its destination pin. Omit to keep lines
 * non-tappable (e.g. compact preview).
 */
 onRoutePress?: (route: MapRoute) => void;
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
 {/* Routes. v0.7.0.50 Simplified Atlas:
 Every line is dotted coral. Always. No direction
 color, no recency fade, no weight variance.
 The SELECTED line (isNewest) draws solid + slightly
 thicker so the user can see what they tapped.
 Polylines are tappable; tapping invokes onRoutePress
 with the same effect as tapping the destination pin. */}
 {renderRoutes.map((r) => {
 const selected = !!r.isNewest;
 // v1.0.3: stable per-route key so Polylines reconcile by
 // destination coord, not array index. Index-based keys
 // caused Polylines to swap props with each other on rapid
 // re-renders (selectedKey state churn when the user taps
 // pins fast), occasionally rendering one line at width 0
 // and making it look like it disappeared. The "Denver line
 // disappeared" bug.
 const routeKey = `route-${r.to.latitude},${r.to.longitude}`;
 return (
 <Polyline
 key={routeKey}
 coordinates={[r.from, r.to]}
 strokeColor={colors.postalRed}
 strokeWidth={selected ? 3.2 : 1.8}
 // v1.0.3: always pass an explicit lineDashPattern.
 // Passing `undefined` for the solid case worked on some
 // react-native-maps versions but other versions treated
 // undefined as "use last value" mid-toggle, leaving the
 // line invisible if the previous render's pattern had
 // collapsed. [1, 0] is a no-gap dash pattern that all
 // versions render as a solid line.
 lineDashPattern={selected ? [1, 0] : [6, 4]}
 geodesic
 tappable={!!onRoutePress}
 onPress={onRoutePress ? () => onRoutePress(r) : undefined}
 zIndex={selected ? 10 : 1}
 />
 );
 })}

 {/* Cities. custom paper-pin marker with serif label.
 v0.7.0.55: tracksViewChanges flipped to false after the
 initial entrance animation so the marker stops re-rasterizing
 on every re-render. Without this, any unrelated state update
 (selectedKey, sheet open/close, etc.) caused the marker to
 re-composite at default origin (0,0) for one frame before
 snapping back. that's the "Denver teleport to top-left"
 bug the user saw. */}
 {!compact &&
 renderCities.map((c, idx) => (
 <CityMarker key={c.id} city={c} idx={idx} onCityPress={onCityPress} />
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
 overlay) per user feedback. wanted Apple Maps full-bleed,
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

/**
 * CityMarker. one Apple/Google Marker per city pin.
 *
 * v1.0.1: extracted from MapPanel so we can own per-marker render state.
 * The "Atlanta in Canada" bug was caused by `tracksViewChanges={false}`
 * being set permanently from first mount. react-native-maps needs at
 * least one tick of view-tracking after the marker mounts so the
 * Marker's coordinate prop and the rendered visual sync up. Without it,
 * the first render snapshot is taken before the lat/lng has actually
 * been applied. the pin gets frozen at iOS's default origin (~upper
 * left of map = Canada) and never recovers.
 *
 * Fix: allow tracksViewChanges=true for ~900ms on mount, then flip it
 * to false (the perf reason it was disabled. re-rasterizing on every
 * upstream re-render. still matters for steady-state). Also re-arm
 * tracking briefly any time the coord changes, which catches city
 * data reloads after a postcard arrives via Realtime.
 */
function CityMarker({
 city: c,
 idx,
 onCityPress,
}: {
 city: MapCity;
 idx: number;
 onCityPress?: (city: MapCity) => void;
}) {
 const isHome = c.id === "home";
 // v1.0.3: re-arm tracksViewChanges whenever ANY visual prop changes,
 // not just coord. Before this, isNewest flipping (selected pin) or
 // reciprocated toggling on/off would change the CityPin's rendered
 // SVG, but tracksViewChanges was already false. Apple Maps held the
 // old snapshot. On rapid clicks (tap pin → close sheet → tap pin
 // again) the marker's cached view drifted from its prop state,
 // causing pins to appear in wrong positions and adjacent polylines
 // to render against a stale anchor. the "Denver line disappeared"
 // bug. renderKey hashes every prop that affects the marker's visual.
 const renderKey = `${c.coord.latitude},${c.coord.longitude},${c.isNewest ? 1 : 0},${c.reciprocated ? 1 : 0}`;
 const [tracks, setTracks] = useState(true);
 useEffect(() => {
 setTracks(true);
 const t = setTimeout(() => setTracks(false), 900);
 return () => clearTimeout(t);
 }, [renderKey]);

 // v0.7.0.58 marker geometry. comments preserved for the next person
 // who has to debug Apple-vs-Google pin offsets:
 // Wrap = 80×50. View center at (40, 25).
 // Pin SVG 28×36 sits top-centered → occupies x=26..54, y=0..36.
 // Needle tip in pin SVG: (23, 33).
 // Needle tip in wrap coords: (26+23, 0+33) = (49, 33).
 // Offset from view center to needle tip: (9, 8).
 // centerOffset = -(9, 8) = (-9, -8).
 //
 // HomePin: disc center in wrap = (40, 14). Offset from view center
 // = (0, -11). centerOffset = (0, 11).
 return (
 <Marker
 coordinate={c.coord}
 anchor={{ x: 0.5, y: 0.5 }}
 centerOffset={isHome ? { x: 0, y: 11 } : { x: -9, y: -8 }}
 onPress={onCityPress ? () => onCityPress(c) : undefined}
 tracksViewChanges={tracks}
 >
 {isHome ? (
 <HomePin name={c.name} staggerIndex={idx} />
 ) : (
 <CityPin
 name={c.name}
 staggerIndex={idx}
 reciprocated={!!c.reciprocated}
 isNewest={!!c.isNewest}
 />
 )}
 </Marker>
 );
}

// ────────────────────────────────────────────────────────────────
// Custom marker views
// ────────────────────────────────────────────────────────────────

/**
 * v0.7.0.51: deterministic tilt for each pin. Same city always tilts
 * the same way, so the map reads as hand-placed rather than stamped.
 * Range -8° to +8°. enough variation to look organic, small enough
 * that labels remain readable.
 */
function tiltDegFromName(name: string): number {
 let h = 5381;
 for (let i = 0; i < name.length; i++) {
 h = ((h << 5) + h + name.charCodeAt(i)) & 0xffffffff;
 }
 // Map hash to -8..+8 degrees
 return ((Math.abs(h) % 161) - 80) / 10;
}

function CityPin({
 name,
 staggerIndex = 0,
 reciprocated = false,
 isNewest = false,
}: {
 name: string;
 // Legacy props (kept on the type for backward compat; not used by
 // the Simplified Atlas).
 accent?: boolean;
 pending?: boolean;
 staggerIndex?: number;
 sendCount?: number;
 reciprocated?: boolean;
 /** v0.7.0.50: repurposed as "selected". drops the tilt + brightens
 * the head + grows the shadow for emphasis. */
 isNewest?: boolean;
 receivedOnly?: boolean;
}) {
 // v0.7.0.5 D.2: drop-in entrance animation. Each pin springs in with
 // a small downward offset → settles, delayed by staggerIndex * 60ms.
 const opacity = useSharedValue(0);
 const translateY = useSharedValue(-8);
 const scale = useSharedValue(0.7);
 const reducedMotion = useReducedMotion();

 useEffect(() => {
 if (reducedMotion) {
 opacity.value = 1;
 translateY.value = 0;
 scale.value = 1;
 return;
 }
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
 }, [opacity, translateY, scale, staggerIndex, reducedMotion]);

 // v0.7.0.51: deterministic tilt per city. Selected pin straightens
 // up (tilt = 0) for emphasis. Tilt is applied via the marker's transform.
 const tiltDeg = isNewest ? 0 : tiltDegFromName(name);

 const animStyle = useAnimatedStyle(() => ({
 opacity: opacity.value,
 transform: [
 { translateY: translateY.value },
 { scale: scale.value },
 { rotate: `${tiltDeg}deg` },
 ],
 }));

 // v0.7.0.52 Codex pin. diagonal needle pushpin.
 //
 // The big realism move (vs build 64's vertical-needle dot): the metal
 // shaft exits the back-right of the head and angles down-right, as if
 // the pin were pushed into the paper at a slight angle. Matches the
 // corkboard wall-map vibe of physical map tacks.
 //
 // SVG layout (28 wide × 36 tall viewBox):
 // [19.8, 31.2] paper contact shadow (rotated 32°, blurred)
 // [15.2 → 23.2, 21.2 → 33.4] needle shaft (dark base + metal gradient + bright glint)
 // [13.6, 14] head circle r=9.35 (red plastic + radial gradient + drop-shadow filter)
 // underside curve at y≈18 (subtle curvature shadow on the dome)
 // [10.4, 10.6] specular highlight (white ellipse tilted -24°)
 // [9.15, 9.55] specular hot-spot (small bright white dot)
 const HEAD_SVG_W = 28;
 const HEAD_SVG_H = 36;
 const isSelected = isNewest;
 // Unique id suffix so multiple pins each get their own filter/gradient
 // (RN-SVG re-uses the global URL namespace across all Svg instances).
 const idSuffix = name.replace(/[^a-zA-Z0-9]/g, "");

 // v0.7.0.58: wrap is now 80×50. Pin SVG sits top-centered (28×36 in the
 // upper region), label sits below in normal flex flow with 80px of
 // horizontal room so city names like "VANCOUVER" / "CLEVELAND" no
 // longer truncate. centerOffset on the Marker compensates for the
 // larger wrap (math in the Marker's call site above).
 const WRAP_W = 80;
 const WRAP_H = 50;
 return (
 <Animated.View style={[pinStyles.wrap, { width: WRAP_W, height: WRAP_H }, animStyle]}>
 <View style={{ width: HEAD_SVG_W, height: HEAD_SVG_H }}>
 <Svg width={HEAD_SVG_W} height={HEAD_SVG_H} viewBox={`0 0 ${HEAD_SVG_W} ${HEAD_SVG_H}`}>
 <Defs>
 {/* Red plastic head. 5-stop radial gradient gives believable
 3D form: bright top-left highlight, mid-red body, dark
 bottom-right curvature shadow. */}
 <RadialGradient id={`pinHead-${idSuffix}`} cx="30%" cy="24%" r="76%">
 <Stop offset="0%" stopColor="#FFD2CA" />
 <Stop offset="15%" stopColor="#FF7A6B" />
 <Stop offset="43%" stopColor="#E13225" />
 <Stop offset="72%" stopColor="#AF160A" />
 <Stop offset="100%" stopColor="#530904" />
 </RadialGradient>
 {/* Metal needle. linear gradient along the shaft axis gives
 a believable bounced highlight (light → dark → bright →
 dark = catches light at one edge, shadowed at the other). */}
 <LinearGradient
 id={`pinMetal-${idSuffix}`}
 x1="14"
 y1="21"
 x2="23"
 y2="34"
 gradientUnits="userSpaceOnUse"
 >
 <Stop offset="0%" stopColor="#E8E4DA" />
 <Stop offset="28%" stopColor="#9D9B94" />
 <Stop offset="62%" stopColor="#F6F0DF" />
 <Stop offset="100%" stopColor="#5F5C55" />
 </LinearGradient>
 </Defs>

 {/* Selection halo. dashed ink ring at the contact point,
 rotated to match the needle angle so it reads as part of
 the same composition. */}
 {isSelected ? (
 <Ellipse
 cx={21.6}
 cy={32.1}
 rx={12.4}
 ry={3.6}
 fill="none"
 stroke="#2B1A08"
 strokeWidth={1.1}
 strokeDasharray="2 2"
 opacity={0.78}
 transform="rotate(32 21.6 32.1)"
 />
 ) : null}
 {/* Reciprocation ring. gold dashed, same axis. */}
 {reciprocated ? (
 <Ellipse
 cx={21.6}
 cy={32.1}
 rx={10.6}
 ry={3.05}
 fill="none"
 stroke={colors.gold}
 strokeWidth={1.45}
 strokeDasharray="3 2"
 opacity={0.94}
 transform="rotate(32 21.6 32.1)"
 />
 ) : null}
 {/* Paper contact shadow under the needle tip. two stacked
 ellipses (one larger + softer, one smaller + darker) to
 approximate a Gaussian-blurred soft shadow without
 relying on the SVG filter (which RN-SVG doesn't reliably
 re-export from its main barrel). */}
 <Ellipse
 cx={isSelected ? 19.9 : 19.8}
 cy={isSelected ? 31.4 : 31.2}
 rx={isSelected ? 10 : 9}
 ry={isSelected ? 2.6 : 2.4}
 fill="#000"
 opacity={isSelected ? 0.14 : 0.12}
 transform={`rotate(32 ${isSelected ? 19.9 : 19.8} ${isSelected ? 31.4 : 31.2})`}
 />
 <Ellipse
 cx={isSelected ? 19.9 : 19.8}
 cy={isSelected ? 31.4 : 31.2}
 rx={isSelected ? 8.7 : 7.8}
 ry={isSelected ? 2.2 : 2.05}
 fill="#000"
 opacity={isSelected ? 0.28 : 0.25}
 transform={`rotate(32 ${isSelected ? 19.9 : 19.8} ${isSelected ? 31.4 : 31.2})`}
 />
 {/* Needle: 3-layered for metal sheen. dark base + bright shaft + crisp glint. */}
 <Path
 d={isSelected ? "M15.8 21.5 L23.5 33.2" : "M15.2 21.2 L23.2 33.4"}
 stroke="#4D4942"
 strokeWidth={isSelected ? 1.7 : 1.6}
 strokeLinecap="round"
 opacity={isSelected ? 0.58 : 0.55}
 />
 <Path
 d={isSelected ? "M15.2 21 L22.9 32.8" : "M14.7 20.8 L22.5 32.7"}
 stroke={`url(#pinMetal-${idSuffix})`}
 strokeWidth={isSelected ? 1.22 : 1.15}
 strokeLinecap="round"
 />
 <Path
 d={isSelected ? "M14.6 20.8 L21.1 30.5" : "M14.2 20.6 L20.8 30.5"}
 stroke="#FFF7E9"
 strokeWidth={isSelected ? 0.4 : 0.36}
 strokeLinecap="round"
 opacity={isSelected ? 0.95 : 0.9}
 />
 {/* Drop-shadow under the head. offset darker circle, sits
 behind the actual red head. Approximates a Gaussian
 drop-shadow filter without relying on RN-SVG filter
 re-exports. */}
 <Circle
 cx={(isSelected ? 13.7 : 13.6) + 1.25}
 cy={14 + 1.9}
 r={isSelected ? 10.15 : 9.35}
 fill="#2B1A08"
 opacity={0.38}
 />
 {/* Red plastic head. */}
 <Circle
 cx={isSelected ? 13.7 : 13.6}
 cy={14}
 r={isSelected ? 10.15 : 9.35}
 fill={`url(#pinHead-${idSuffix})`}
 stroke="#5A0A04"
 strokeWidth={isSelected ? 0.7 : 0.65}
 />
 {/* Underside curvature shadow. a subtle dark arc on the bottom
 of the dome to sell the 3D form. */}
 <Path
 d={isSelected
 ? "M5.8 16.8 C8.8 22.3 18.6 23 22.4 16.6 C21.4 21.8 17.4 25 12.8 24.4 C8.9 24 6.4 21.1 5.8 16.8Z"
 : "M6.2 16.7 C9.1 21.9 17.9 22.5 21.7 16.5 C20.7 21.3 17.1 24.2 12.9 23.8 C9.3 23.5 6.8 20.9 6.2 16.7Z"}
 fill="#3E0502"
 opacity={0.16}
 />
 {/* Specular highlight. tilted ellipse top-left of the dome. */}
 <Ellipse
 cx={isSelected ? 10.2 : 10.4}
 cy={isSelected ? 10.45 : 10.6}
 rx={isSelected ? 3.55 : 3.25}
 ry={isSelected ? 2 : 1.85}
 fill="#FFFFFF"
 opacity={0.78}
 transform={`rotate(-24 ${isSelected ? 10.2 : 10.4} ${isSelected ? 10.45 : 10.6})`}
 />
 {/* Specular hot-spot. small bright crisp dot. */}
 <Circle
 cx={isSelected ? 8.85 : 9.15}
 cy={isSelected ? 9.35 : 9.55}
 r={isSelected ? 0.95 : 0.85}
 fill="#FFFFFF"
 opacity={0.95}
 />
 </Svg>
 </View>
 <View style={pinStyles.labelWrap}>
 <Text style={pinStyles.label} numberOfLines={1}>
 {name}
 </Text>
 </View>
 </Animated.View>
 );
}

/**
 * v0.7.0.51: home pin uses the actual house emoji 🏠 on a paper-cream
 * disc. instantly recognizable as "you are here" without being a
 * differently-colored version of the city pin. The user's request: make
 * home an actual home emoji.
 */
function HomePin({
 name,
 staggerIndex = 0,
}: {
 name: string;
 staggerIndex?: number;
}) {
 const opacity = useSharedValue(0);
 const translateY = useSharedValue(-8);
 const scale = useSharedValue(0.7);
 const reducedMotion = useReducedMotion();

 useEffect(() => {
 if (reducedMotion) {
 opacity.value = 1;
 translateY.value = 0;
 scale.value = 1;
 return;
 }
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
 }, [opacity, translateY, scale, staggerIndex, reducedMotion]);

 const animStyle = useAnimatedStyle(() => ({
 opacity: opacity.value,
 transform: [
 { translateY: translateY.value },
 { scale: scale.value },
 ],
 }));

 const DISC_PX = 28;
 // v0.7.0.58: same 80×50 wrap treatment as CityPin so the "Home" label
 // doesn't get clipped by iOS marker bbox. centerOffset on the Marker
 // call site moves the view center down 11px so the disc lands on
 // the coord exactly.
 const WRAP_W = 80;
 const WRAP_H = 50;

 return (
 <Animated.View style={[pinStyles.wrap, { width: WRAP_W, height: WRAP_H }, animStyle]}>
 <View
 style={{
 width: DISC_PX,
 height: DISC_PX,
 borderRadius: DISC_PX / 2,
 backgroundColor: colors.paper,
 borderWidth: 1.5,
 borderColor: colors.ink,
 alignItems: "center",
 justifyContent: "center",
 shadowColor: "#2B1A08",
 shadowOffset: { width: 0, height: 1.5 },
 shadowOpacity: 0.35,
 shadowRadius: 2.5,
 }}
 >
 {/* v0.7.0.55: replaced 🏠 emoji (juvenile, inconsistent with the
 line-art / paper-stamp identity used everywhere else) with a
 refined SVG house outline. Strokes match the brand ink color
 and the 1.5-weight line-art seen in the How It Works icons. */}
 <Svg width={DISC_PX * 0.58} height={DISC_PX * 0.58} viewBox="0 0 24 24" fill="none">
 {/* House: gabled roof + body + door */}
 <Path
 d="M3.5 11.2 L12 4 L20.5 11.2 V20 H3.5 Z"
 stroke={colors.ink}
 strokeWidth={1.7}
 strokeLinejoin="round"
 strokeLinecap="round"
 fill="none"
 />
 {/* Door */}
 <Path
 d="M10 20 V14.2 H14 V20"
 stroke={colors.ink}
 strokeWidth={1.5}
 strokeLinejoin="round"
 strokeLinecap="round"
 fill="none"
 />
 {/* Tiny chimney detail. subtle, but signals "house" beyond a generic shape */}
 <Path
 d="M16.6 7.4 V5 H18 V8.6"
 stroke={colors.ink}
 strokeWidth={1.5}
 strokeLinecap="round"
 fill="none"
 />
 </Svg>
 </View>
 <View style={pinStyles.labelWrap}>
 <Text style={pinStyles.label} numberOfLines={1}>
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
 // v0.7.0.55 BUGFIX (line endpoint alignment): the wrap previously laid
 // out the pin SVG + label in normal flow. The label added ~15px to the
 // bottom of the Marker's bounding box, which shifted the (0.82, 0.92)
 // anchor down INTO the label. so Polyline endpoints (which target the
 // lat/lng = anchor) landed on the label, not at the pin needle tip.
 // Fix: absolute-position the label so it floats below the pin without
 // expanding the wrap's bbox. Now the Marker bbox = pin SVG only, and
 // (0.82, 0.92) correctly hits the needle tip at (23.2, 33.4).
 wrap: { alignItems: "center", position: "relative" },
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
 // v0.7.0.50 Simplified Atlas: dotAccent/coreAccent are still
 // referenced by the CityDot compact preview on the My Card screen.
 // The main map uses a constant pin size + the reciprocation ring as
 // the only differentiation; CityPin doesn't apply these anymore.
 dotAccent: {
 width: 18,
 height: 18,
 borderRadius: 9,
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
 // v0.7.0.50: reciprocation ring. gold dashed circle around the pin
 // for cities where we've both sent AND received. The "yes you have a
 // pen pal" signal, the whole point of the product. Rendered as an
 // absolute child of a dot-sized container so it centers on the dot
 // (earlier draft anchored to the wrap's left edge. wrong).
 recipRing: {
 position: "absolute",
 borderWidth: 1.6,
 borderColor: colors.gold,
 borderStyle: "dashed",
 backgroundColor: "transparent",
 },
 // v0.7.0.50: selection halo. a small dashed ink ring around the pin
 // when its area is selected. Pairs with the polyline going solid +
 // thicker, so the user can clearly see which dot the line attaches to.
 selectionHalo: {
 position: "absolute",
 borderWidth: 1.2,
 borderColor: "#2B1A08",
 borderStyle: "dashed",
 backgroundColor: "transparent",
 },
 labelWrap: {
 // v0.7.0.58: was position:absolute,top:100%. paired with the 28×36
 // wrap that's now 80×50. With the wider wrap, the label fits in the
 // bottom region in normal flex flow (wrap has alignItems:center, so
 // children stack centered vertically). Normal flow means iOS won't
 // clip the label anymore.
 marginTop: 2,
 paddingHorizontal: 4,
 paddingVertical: 1,
 alignSelf: "center",
 maxWidth: 80,
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
});

// ────────────────────────────────────────────────────────────────
// Overlay decorations
// ────────────────────────────────────────────────────────────────

/**
 * Parchment frame. a soft inner shadow + corner ticks + vignette around
 * the live map, so it reads as a postcard cutout rather than a modern UI.
 *
 * Overlay sits on top of the live MapView to push Apple's standard tiles
 * into vintage parchment territory:
 * • paper-grain dot pattern (subtle texture)
 * • deeper edge vignette so the center feels framed
 * • age stains in opposing corners
 * • corner survey ticks (compositional touch)
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

 {/* Age stains. corners + scattered */}
 {!compact && (
 <G>
 <Ellipse cx="12" cy="12" rx="22" ry="9" fill="url(#map-stain)" />
 <Ellipse cx="86" cy="8" rx="18" ry="6" fill="url(#map-stain)" />
 <Ellipse cx="92" cy="92" rx="14" ry="10" fill="url(#map-stain)" />
 <Ellipse cx="40" cy="95" rx="28" ry="5" fill="url(#map-stain)" />
 </G>
 )}

 {/* Corner survey ticks. set apart from the bezel */}
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

 {/* Vignette. darken edges */}
 <Rect x="0" y="0" width="100" height="100" fill="url(#map-vignette)" />
 </Svg>
 );
}

/**
 * 8-point vintage compass rose. drawn fully in SVG, positioned in the
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
 * MAILROOM cartouche. vintage ribbon-style badge sitting bottom-left.
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
