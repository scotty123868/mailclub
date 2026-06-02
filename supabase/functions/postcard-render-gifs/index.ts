// postcard-render-gifs — server-side visual generation for the Mailed
// celebration gallery. Called synchronously from lob-send-postcard
// right after the Lob API returns front + back thumbnail URLs.
//
// Produces the three-part gallery the sender sees inline in iMessage:
//
//   1. their photo        — the raw camera-roll shot (the human moment)
//   2. flip.gif           — front ↔ back card animation (the artifact)
//   3. route.png          — a NATIVE Apple Maps snapshot of the journey
//                           from sender city → recipient city, with a
//                           burgundy route line + endpoint pins
//                           (the journey)
//
// Why a static Apple Maps PNG and not an animated map GIF: Apple itself
// only ever shows static map snapshots inside Messages (shared
// locations, etc). A full-color native snapshot reads as native and
// timeless; a 256-color animated GIF of a map reads as posterized and
// gimmicky. The motion in the gallery lives in the card flip. The map
// is still, full-color, and unmistakably Apple Maps.
//
// Apple Maps auth (two mechanisms, both off the same .p8 key we already
// use for MapKit JS):
//   - Geocoding (city name → lat/lng): MapKit JS JWT → exchanged for a
//     short-lived access token at maps-api.apple.com/v1/token, then
//     Bearer-auth against /v1/geocode.
//   - Snapshot: the request path "/api/v1/snapshot?...&teamId=&keyId="
//     is ES256-signed and the base64url signature appended as
//     &signature=. (Reference: Apple's documented Maps Web Snapshots
//     signing, mirrored by the python `mapsnap` library.)
//
// Everything degrades gracefully: missing MapKit creds, geocode miss,
// or snapshot failure → route.png is skipped and the gallery falls back
// to [photo, flip] or [photo, front, back].
//
// Auth (inbound): x-mailroom-internal header must match
// MAILROOM_INTERNAL_SECRET. Only called from lob-send-postcard.

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  Frame,
  GIF,
  Image,
  decode,
} from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";

// Apple Maps credentials (same secrets the mapkit-token function uses).
const MAPKIT_TEAM_ID = Deno.env.get("MAPKIT_TEAM_ID") ?? "";
const MAPKIT_KEY_ID = Deno.env.get("MAPKIT_KEY_ID") ?? "";
const MAPKIT_PRIVATE_KEY = Deno.env.get("MAPKIT_PRIVATE_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Mailroom palette (Apple snapshot wants hex WITHOUT the #). These match
// the in-app /c/ MapKit map exactly: burgundy sender dot + route line,
// blue recipient dot.
const BRAND_HEX = "b8483a";       // burgundy — route line (+ sender dot, drawn manually)

// =============================================================================
// Geo helpers — arc + distance (ported 1:1 from the /c/ MapKit page)
// =============================================================================

type LatLng = { lat: number; lng: number };

// Quadratic-Bézier arc between two points. Control point pushed
// perpendicular to the chord so the line bows off the straight path —
// the "air mail" curve. Same formula + 0.22 height factor the in-app
// map uses, so the snapshot and the app render an identical arc.
function generateArc(start: LatLng, end: LatLng, n: number): LatLng[] {
  const dLat = end.lat - start.lat;
  const dLng = end.lng - start.lng;
  const dist = Math.hypot(dLat, dLng);
  const perpLat = -dLng;
  const perpLng = dLat;
  const norm = Math.hypot(perpLat, perpLng) || 1;
  const arcHeight = dist * 0.22;
  const ctrlLat = (start.lat + end.lat) / 2 + (perpLat / norm) * arcHeight;
  const ctrlLng = (start.lng + end.lng) / 2 + (perpLng / norm) * arcHeight;
  const out: LatLng[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      lat: u * u * start.lat + 2 * u * t * ctrlLat + t * t * end.lat,
      lng: u * u * start.lng + 2 * u * t * ctrlLng + t * t * end.lng,
    });
  }
  return out;
}

// Great-circle distance in statute miles.
function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// =============================================================================
// Anti-aliased disc drawing — used to replicate the app's makeDotPin
// endpoint markers (soft halo + cream ring + filled disc) directly on
// the snapshot, instead of Apple's generic annotation markers.
// =============================================================================

type RGB = { r: number; g: number; b: number };

const CREAM: RGB = { r: 253, g: 250, b: 241 }; // #fdfaf1 ring
const SENDER_RGB: RGB = { r: 184, g: 72, b: 58 };   // #b8483a
const RECIPIENT_RGB: RGB = { r: 60, g: 110, b: 143 }; // #3c6e8f

// imagescript pixels are 1-indexed and packed 0xRRGGBBAA. Source-over
// blend `color` at coverage `a` (0..1) onto the existing pixel.
function blendPixel(img: Image, x: number, y: number, c: RGB, a: number): void {
  if (a <= 0) return;
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const px = x + 1, py = y + 1;
  const existing = img.getPixelAt(px, py); // 0xRRGGBBAA
  const dr = (existing >>> 24) & 0xff;
  const dg = (existing >>> 16) & 0xff;
  const db = (existing >>> 8) & 0xff;
  const da = (existing & 0xff) / 255;
  const sa = Math.min(1, a);
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  const outR = Math.round((c.r * sa + dr * da * (1 - sa)) / outA);
  const outG = Math.round((c.g * sa + dg * da * (1 - sa)) / outA);
  const outB = Math.round((c.b * sa + db * da * (1 - sa)) / outA);
  const packed =
    ((outR & 0xff) * 0x1000000) +
    ((outG & 0xff) << 16) +
    ((outB & 0xff) << 8) +
    Math.round(outA * 255);
  img.setPixelAt(px, py, packed >>> 0);
}

// Filled disc, anti-aliased at the rim by a 1px coverage ramp.
function drawDiscAA(img: Image, cx: number, cy: number, r: number, c: RGB, alpha: number): void {
  const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.max(0, Math.min(1, r - d + 0.5)); // 1 inside, ramp at rim
      if (cov > 0) blendPixel(img, x, y, c, alpha * cov);
    }
  }
}

// The app's makeDotPin, replicated: faint halo (r≈2.3×disc, 18% alpha),
// cream ring, filled disc on top. discR is the inner-disc radius in px.
function drawMapDot(img: Image, cx: number, cy: number, color: RGB, discR: number): void {
  const haloR = discR * 2.3;
  const ringW = Math.max(2, discR * 0.32);
  drawDiscAA(img, cx, cy, haloR, color, 0.18);       // soft outer halo
  drawDiscAA(img, cx, cy, discR + ringW, CREAM, 1);  // cream ring
  drawDiscAA(img, cx, cy, discR, color, 1);          // inner disc
}

// =============================================================================
// Fetch helper
// =============================================================================

async function fetchBytes(url: string, init?: RequestInit): Promise<Uint8Array> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`fetch ${res.status} ${url.slice(0, 80)} ${body.slice(0, 120)}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// =============================================================================
// ES256 crypto (shared by the JWT mint and the snapshot path signature)
// =============================================================================

function base64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlJson(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function pemToPkcs8Der(pem: string): Uint8Array {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let _cryptoKey: CryptoKey | null = null;
async function getSigningKey(): Promise<CryptoKey> {
  if (_cryptoKey) return _cryptoKey;
  const keyData = pemToPkcs8Der(MAPKIT_PRIVATE_KEY);
  _cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return _cryptoKey;
}

// WebCrypto ECDSA output is raw r||s (64 bytes) — exactly the IEEE
// P1363 form both JWS ES256 and Apple's snapshot signature expect.
async function signES256(input: string): Promise<string> {
  const key = await getSigningKey();
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(input),
  );
  return base64url(sig);
}

// =============================================================================
// Apple Maps Server API — geocoding
// =============================================================================

// Plain MapKit token (no origin lock — the Server API doesn't need it).
async function mintMapKitJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "JWT", kid: MAPKIT_KEY_ID };
  const payload = { iss: MAPKIT_TEAM_ID, iat: now, exp: now + 600 };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const sig = await signES256(signingInput);
  return `${signingInput}.${sig}`;
}

let _accessToken: { token: string; exp: number } | null = null;
async function getMapsAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_accessToken && _accessToken.exp - 30 > now) return _accessToken.token;

  const jwt = await mintMapKitJwt();
  const res = await fetch("https://maps-api.apple.com/v1/token", {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`maps token exchange ${res.status} ${body.slice(0, 120)}`);
  }
  const json = await res.json();
  const token = json?.accessToken as string;
  const ttl = (json?.expiresInSeconds as number) ?? 1800;
  if (!token) throw new Error("maps token exchange: no accessToken in response");
  _accessToken = { token, exp: now + ttl };
  return token;
}

// City string → { lat, lng } | null. We append ", USA" to bias toward
// the right country and reduce ambiguous matches.
async function geocodeCity(query: string): Promise<{ lat: number; lng: number } | null> {
  if (!query || !query.trim()) return null;
  try {
    const accessToken = await getMapsAccessToken();
    const q = encodeURIComponent(`${query.trim()}, USA`);
    const res = await fetch(
      `https://maps-api.apple.com/v1/geocode?q=${q}&limit=1&lang=en-US`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      console.warn("[render-gifs] geocode http", res.status, query);
      return null;
    }
    const json = await res.json();
    const coord = json?.results?.[0]?.coordinate;
    if (typeof coord?.latitude === "number" && typeof coord?.longitude === "number") {
      return { lat: coord.latitude, lng: coord.longitude };
    }
    console.warn("[render-gifs] geocode no coordinate", query);
    return null;
  } catch (e: any) {
    console.warn("[render-gifs] geocode threw", e?.message ?? e, query);
    return null;
  }
}

// =============================================================================
// Apple Maps Web Snapshot — native static route map
// =============================================================================
//
// Builds a signed snapshot URL framing both cities, with a burgundy
// route line (overlay) and two endpoint markers (annotations: origin
// dot, destination balloon so the direction reads). Returns the raw
// PNG bytes. Mercator-aware center + span computation so both cities
// sit comfortably inside the frame with padding.

async function generateRouteMapPng(opts: {
  fromCity: string;
  toCity: string;
}): Promise<{ bytes: Uint8Array; miles: number } | null> {
  if (!MAPKIT_TEAM_ID || !MAPKIT_KEY_ID || !MAPKIT_PRIVATE_KEY) {
    console.warn("[render-gifs] MapKit creds missing, skipping route map");
    return null;
  }

  const a = await geocodeCity(opts.fromCity);
  const b = await geocodeCity(opts.toCity);
  if (!a || !b) {
    console.warn("[render-gifs] geocode failed", { from: !!a, to: !!b });
    return null;
  }

  const miles = haversineMiles(a, b);

  // The route is a curved Bézier arc — identical to the in-app map. We
  // sample it densely and hand ALL points to Apple as the overlay
  // polyline so the snapshot draws the same crisp dashed curve.
  const arc = generateArc(a, b, 48);

  // Frame the region in (lng, mercatorY) space — both degree-like, so
  // an aspect-ratio fit is straightforward and the snapshot's pixel
  // mapping is linear here. Frame over the WHOLE arc (not just the two
  // endpoints) so the bow never clips the top of the image.
  const W = 600, H = 360;
  const aspect = W / H;
  const mercY = (lat: number) =>
    (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
  const invMercY = (y: number) =>
    ((Math.atan(Math.exp((y * Math.PI) / 180)) - Math.PI / 4) * 2 * 180) / Math.PI;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of arc) {
    const x = p.lng, y = mercY(p.lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // 32% padding around the arc bbox (the arc bow already adds spread),
  // with a floor so two close cities don't zoom to street level.
  const padX = Math.max((maxX - minX) * 0.32, 1.0);
  const padY = Math.max((maxY - minY) * 0.32, 1.0);
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;

  // Fit to image aspect ratio so Apple renders the exact region we
  // expect (keeps our card-on-the-line projection aligned).
  const bw = maxX - minX, bh = maxY - minY;
  if (bw / bh < aspect) {
    const nw = bh * aspect, cx = (minX + maxX) / 2;
    minX = cx - nw / 2; maxX = cx + nw / 2;
  } else {
    const nh = bw / aspect, cy = (minY + maxY) / 2;
    minY = cy - nh / 2; maxY = cy + nh / 2;
  }

  const cLng = (minX + maxX) / 2;
  const cLat = invMercY((minY + maxY) / 2);
  const spanLng = maxX - minX;
  const spanLat = invMercY(maxY) - invMercY(minY);

  const params = new URLSearchParams();
  params.set("teamId", MAPKIT_TEAM_ID);
  params.set("keyId", MAPKIT_KEY_ID);
  params.set("center", `${cLat.toFixed(6)},${cLng.toFixed(6)}`);
  params.set("spn", `${Math.abs(spanLat).toFixed(6)},${Math.abs(spanLng).toFixed(6)}`);
  params.set("size", `${W}x${H}`);
  params.set("scale", "2");
  params.set("t", "mutedStandard"); // clean cartography, low chrome
  params.set("colorScheme", "light");
  params.set("poi", "0"); // hide points-of-interest clutter
  params.set("lang", "en-US");
  // NO Apple annotation markers — their generic dots don't match the
  // app. We composite our own (makeDotPin replica) below. We DO use
  // Apple's vector overlay for the dashed arc: crisp, anti-aliased,
  // and honoring the app's exact lineDash [6,4] + width 2.5.
  params.set(
    "overlays",
    JSON.stringify([
      {
        points: arc.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`),
        strokeColor: BRAND_HEX,
        lineWidth: 3,
        lineDash: [6, 4],
      },
    ]),
  );

  // Sign the exact path+query we will request, byte-for-byte.
  const qs = params.toString();
  const completePath = `/api/v1/snapshot?${qs}`;
  const signature = await signES256(completePath);
  const url = `https://snapshot.apple-mapkit.com${completePath}&signature=${signature}`;

  // Let snapshot fetch errors propagate (caller logs them) so a bad
  // request surfaces instead of silently degrading to "no map."
  const mapBytes = await fetchBytes(url);

  // Composite the endpoint dots ourselves — exact makeDotPin replica
  // (halo + cream ring + disc), burgundy sender, blue recipient. We
  // project the two cities into the SAME aspect-fitted bbox we sent
  // Apple, so the dots land exactly on the ends of Apple's vector arc.
  try {
    const pxW = W * 2, pxH = H * 2;
    const mapImg = (await decode(mapBytes)) as Image;
    const projX = (lng: number) => (pxW * (lng - minX)) / (maxX - minX);
    const projY = (lat: number) => (pxH * (maxY - mercY(lat))) / (maxY - minY);
    // Disc radius scaled to image width (matches the app's proportion:
    // ~7/375 of viewport → a touch under 2% here, *2 for the @2x image).
    const discR = Math.max(7, Math.round(pxW * 0.0095));
    drawMapDot(mapImg, projX(a.lng), projY(a.lat), SENDER_RGB, discR);
    drawMapDot(mapImg, projX(b.lng), projY(b.lat), RECIPIENT_RGB, discR);
    return { bytes: await mapImg.encode(), miles };
  } catch (e: any) {
    console.warn("[render-gifs] dot composite failed, using bare map", e?.message ?? e);
    return { bytes: mapBytes, miles };
  }
}

// =============================================================================
// Flip GIF — front ↔ back, 2 frames
// =============================================================================

async function generateFlipGif(
  frontUrl: string,
  backUrl: string,
): Promise<Uint8Array> {
  const W = 600, H = 400;
  const [frontBytes, backBytes] = await Promise.all([
    fetchBytes(frontUrl),
    fetchBytes(backUrl),
  ]);
  const frontImg = (await decode(frontBytes)) as Image;
  const backImg = (await decode(backBytes)) as Image;
  const frontResized = frontImg.resize(W, H);
  const backResized = backImg.resize(W, H);

  const frontFrame = new Frame(W, H, 1500);
  frontFrame.composite(frontResized, 0, 0);
  const backFrame = new Frame(W, H, 1500);
  backFrame.composite(backResized, 0, 0);

  const gif = new GIF([frontFrame, backFrame]);
  return await gif.encode();
}

// =============================================================================
// Upload helper
// =============================================================================

async function uploadAsset(
  postcardId: string,
  filename: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const path = `${postcardId}/${filename}`;
  const { error } = await admin.storage
    .from("postcard-renders")
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`upload: ${error.message}`);
  const { data: pub } = admin.storage.from("postcard-renders").getPublicUrl(path);
  const url = pub?.publicUrl ?? "";
  if (!url) throw new Error("no public url after upload");
  return url;
}

// =============================================================================
// HTTP handler
// =============================================================================

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }
  const internal = req.headers.get("x-mailroom-internal");
  if (!INTERNAL_SECRET || internal !== INTERNAL_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const postcardId = body?.postcard_id as string | undefined;
  if (!postcardId) {
    return new Response(JSON.stringify({ ok: false, error: "missing postcard_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const notify = body?.notify === true;
  const { data: postcard, error } = await admin
    .from("postcards")
    .select("id, lob_front_thumbnail_url, lob_back_thumbnail_url, from_city, to_city, from_phone, mailed_imessage_id")
    .eq("id", postcardId)
    .maybeSingle();
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: `lookup: ${error.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!postcard) {
    return new Response(JSON.stringify({ ok: false, error: "postcard_not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results: {
    flip_gif_url?: string;
    route_map_url?: string;
    route_miles?: number;
    errors: string[];
  } = { errors: [] };

  // Flip GIF (needs both thumbnails).
  if (postcard.lob_front_thumbnail_url && postcard.lob_back_thumbnail_url) {
    try {
      const flipBytes = await generateFlipGif(
        postcard.lob_front_thumbnail_url,
        postcard.lob_back_thumbnail_url,
      );
      results.flip_gif_url = await uploadAsset(postcardId, "flip.gif", flipBytes, "image/gif");
    } catch (e: any) {
      console.error("[render-gifs] flip failed", e?.message ?? e);
      results.errors.push(`flip: ${e?.message ?? "unknown"}`);
    }
  } else {
    results.errors.push("flip: missing_thumbnails");
  }

  // Native Apple Maps route snapshot (needs from + to cities). The card
  // front is composited onto the arc, so pass it through if we have it.
  if (postcard.from_city && postcard.to_city) {
    try {
      const route = await generateRouteMapPng({
        fromCity: postcard.from_city,
        toCity: postcard.to_city,
      });
      if (route) {
        results.route_map_url = await uploadAsset(postcardId, "route.png", route.bytes, "image/png");
        results.route_miles = Math.round(route.miles);
      } else {
        results.errors.push("route: generation_skipped");
      }
    } catch (e: any) {
      console.error("[render-gifs] route map failed", e?.message ?? e);
      results.errors.push(`route: ${e?.message ?? "unknown"}`);
    }
  } else {
    results.errors.push("route: missing_cities");
  }

  // Persist whichever URLs succeeded.
  if (results.flip_gif_url || results.route_map_url) {
    const update: Record<string, unknown> = {};
    if (results.flip_gif_url) update.flip_gif_url = results.flip_gif_url;
    if (results.route_map_url) update.route_map_url = results.route_map_url;
    if (results.route_miles != null) update.route_miles = results.route_miles;
    await admin.from("postcards").update(update).eq("id", postcardId);
  }

  // FOLLOW-UP. When the caller asked for it (immediate sends), text the
  // finished gallery to the sender. The bot already fired a fast
  // "Postmarked + photo" celebration; this lands a few seconds later with
  // the animated card flip + the route map, so the send feels instant AND
  // gets the rich reveal. Threaded under the Mailed bubble when we have it.
  const LOOP_API_KEY = Deno.env.get("LOOPMESSAGE_API_KEY") ?? "";
  const LOOP_SENDER_ID = Deno.env.get("LOOPMESSAGE_SENDER_ID") ?? "";
  const gallery: string[] = [];
  if (results.flip_gif_url) gallery.push(results.flip_gif_url);
  if (results.route_map_url) gallery.push(results.route_map_url);
  if (notify && LOOP_API_KEY && postcard.from_phone && gallery.length) {
    try {
      const sendBody: Record<string, unknown> = {
        contact: postcard.from_phone,
        text: results.route_miles
          ? `Here's your card, and the ${results.route_miles}-mile trip it's taking.`
          : `Here's your card, front to back, and the route it's taking.`,
        attachments: gallery,
      };
      if (LOOP_SENDER_ID) sendBody.sender = LOOP_SENDER_ID;
      if (postcard.mailed_imessage_id) sendBody.reply_to_id = postcard.mailed_imessage_id;
      const r = await fetch("https://a.loopmessage.com/api/v1/message/send/", {
        method: "POST",
        headers: { Authorization: LOOP_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(sendBody),
      });
      if (!r.ok) console.warn("[render-gifs] gallery follow-up failed", r.status);
    } catch (e: any) {
      console.warn("[render-gifs] gallery follow-up threw", e?.message ?? e);
    }
  }

  return new Response(
    JSON.stringify({
      ok: !!(results.flip_gif_url || results.route_map_url),
      flip_gif_url: results.flip_gif_url ?? null,
      route_map_url: results.route_map_url ?? null,
      route_miles: results.route_miles ?? null,
      errors: results.errors.length ? results.errors : undefined,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
