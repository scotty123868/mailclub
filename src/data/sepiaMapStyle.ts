/**
 * Google Maps style JSON that turns a live Google Maps view into a sepia /
 * parchment vintage map. Roads, transit, POIs, and labels are all hidden so
 * we can paint our own Mailroom overlay on top.
 *
 * Tunable — feel free to nudge the hex values to taste. The current palette
 * comes from the Mailroom design tokens:
 *   parchment fill     #E8D5A8
 *   sepia ocean        #C2A56D
 *   ink stroke         #4A3520
 *   faded brown text   #6B5535
 *
 * This style applies only when `provider={PROVIDER_GOOGLE}` is set, which
 * itself requires a configured Google Maps SDK key in `app.json`. On Apple
 * Maps (the fallback path) only the tint overlay is applied.
 */
export const sepiaMapStyle = [
  // ── Global desaturation so any color that slips through reads vintage ──
  {
    stylers: [
      { saturation: -85 },
      { lightness: -8 },
    ],
  },

  // ── Hide every modern feature category ──
  { featureType: "road", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.neighborhood", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.province", elementType: "labels", stylers: [{ visibility: "off" }] },

  // ── Land: paint a parchment cream over everything ──
  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#E8D5A8" }],
  },
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#E8D5A8" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#E8D5A8" }],
  },

  // ── Water: deep sepia. Lakes get the same treatment as oceans. ──
  {
    featureType: "water",
    elementType: "geometry.fill",
    stylers: [{ color: "#C2A56D" }],
  },
  {
    featureType: "water",
    elementType: "geometry.stroke",
    stylers: [{ color: "#8B6B25" }, { weight: 0.4 }],
  },
  {
    featureType: "water",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },

  // ── State / country borders: dark brown ink, thin ──
  {
    featureType: "administrative.country",
    elementType: "geometry.stroke",
    stylers: [{ color: "#4A3520" }, { weight: 1.2 }],
  },
  {
    featureType: "administrative.country",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6B5535" }],
  },
  {
    featureType: "administrative.country",
    elementType: "labels.text.stroke",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative.province",
    elementType: "geometry.stroke",
    stylers: [{ color: "#6B5535" }, { weight: 0.5 }],
  },
];
