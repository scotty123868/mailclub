// v0.7.0.50 — pure aggregation logic for the Map tab's "Option 4"
// (recency + frequency + reciprocation). Extracted from app/(tabs)/map.tsx
// so it can be unit-tested without rendering a MapView.
//
// Maps a flat postcards[] array into a per-city stats array that carries:
//   • sendCount      — how many cards we mailed to this city
//   • receivedCount  — how many cards came BACK from this city
//   • mostRecentSendMs — epoch ms of our latest send to this city (0 if none)
//
// The Map screen then derives:
//   • line weight    from sendCount
//   • line opacity   from (now - mostRecentSendMs)
//   • reciprocation  from (sendCount > 0 && receivedCount > 0)
//   • isNewest       by picking the row with the max mostRecentSendMs

import type { Friend, Postcard } from "@/src/types/mail";
import { resolveCoord, type Geo } from "@/src/components/MapPanel";

export type CityStat = {
  /** Coord-key (4-decimal lat_lng) used for dedupe across passes. */
  key: string;
  coord: Geo;
  cityName: string;
  sendCount: number;
  receivedCount: number;
  mostRecentSendMs: number;
};

export function coordKey(c: Geo): string {
  return `${c.latitude.toFixed(4)}_${c.longitude.toFixed(4)}`;
}

/**
 * v0.7.0.50: rough great-circle distance between two coords in miles.
 *
 * Equirectangular approximation (NOT haversine) — accurate to within ~1%
 * at the scale we care about (under 200 miles) and avoids the trig stack
 * haversine needs. For continental US distances we don't need more.
 */
export function distanceMiles(a: Geo, b: Geo): number {
  const MILES_PER_DEG_LAT = 69.0;
  const meanLatRad = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const dLat = (a.latitude - b.latitude) * MILES_PER_DEG_LAT;
  const dLng = (a.longitude - b.longitude) * MILES_PER_DEG_LAT * Math.cos(meanLatRad);
  return Math.hypot(dLat, dLng);
}

/**
 * v0.7.0.50: collapse nearby cities into single "areas" — the Bay Area
 * (SF + Oakland + Berkeley + San Jose) becomes one pin. NYC metro
 * (Manhattan + Brooklyn + Queens + Jersey City) becomes one pin.
 *
 * Algorithm: greedy single-pass. We sort cities by total card count
 * descending so the biggest city in a metro becomes the cluster's name
 * + coord. Each subsequent city either joins an existing cluster within
 * `radiusMiles` or starts a new one.
 *
 * Why greedy (not k-means or DBSCAN): for the data sizes we care about
 * (~10–50 cities per user) greedy is deterministic, fast, and produces
 * the "feels right" answer. Larger-scale clustering would need a real
 * algorithm but we're not there.
 *
 * Default radius 50mi merges metros without pulling adjacent cities
 * (NYC and Philly stay separate at 95mi apart, DC and Baltimore merge
 * at 40mi). Tunable per-call.
 */
export function groupByArea(
  stats: CityStat[],
  radiusMiles: number = 50,
): CityStat[] {
  // Sort descending by activity so the most-cards city wins the cluster
  // name + coord. Ties broken by mostRecentSendMs (newer wins).
  const sorted = [...stats].sort((a, b) => {
    const aTotal = a.sendCount + a.receivedCount;
    const bTotal = b.sendCount + b.receivedCount;
    if (bTotal !== aTotal) return bTotal - aTotal;
    return b.mostRecentSendMs - a.mostRecentSendMs;
  });

  const clusters: CityStat[] = [];
  for (const city of sorted) {
    const found = clusters.find((c) => distanceMiles(c.coord, city.coord) <= radiusMiles);
    if (found) {
      found.sendCount += city.sendCount;
      found.receivedCount += city.receivedCount;
      if (city.mostRecentSendMs > found.mostRecentSendMs) {
        found.mostRecentSendMs = city.mostRecentSendMs;
      }
    } else {
      // Shallow copy so mutations stay local to this cluster.
      clusters.push({ ...city });
    }
  }
  return clusters;
}

/**
 * Aggregate every postcard into per-city stats. Outbound cards (where the
 * user is the sender) drive sendCount + mostRecentSendMs; inbound cards
 * drive receivedCount.
 *
 * For "is this card ours?": we check senderId against authedUserId. If
 * senderId is missing on the row (legacy mock postcards, or local dev
 * before the senderId column was filled), we default to treating it as
 * outbound — that was the historical assumption before reciprocation
 * synthesis was added.
 */
export function computeCityStats(
  postcards: Postcard[],
  friends: Friend[],
  authedUserId: string | null,
): CityStat[] {
  const map = new Map<string, CityStat>();

  for (const p of postcards) {
    const friend = friends.find((f) => f.id === p.toFriendId);
    const isOurs = !p.senderId || (authedUserId && p.senderId === authedUserId);

    if (isOurs) {
      const cityName = p.toCity || friend?.city || "";
      if (!cityName) continue;
      const coord = resolveCoord(
        cityName,
        friend?.addressState || friend?.state,
      );
      if (!coord) continue;
      const key = coordKey(coord);
      const sentMs = p.sentAt ? new Date(p.sentAt).getTime() : 0;
      const existing = map.get(key);
      if (existing) {
        existing.sendCount += 1;
        if (sentMs > existing.mostRecentSendMs) {
          existing.mostRecentSendMs = sentMs;
        }
      } else {
        map.set(key, {
          key,
          coord,
          cityName,
          sendCount: 1,
          receivedCount: 0,
          mostRecentSendMs: sentMs,
        });
      }
    } else {
      if (!p.fromCity) continue;
      const coord = resolveCoord(
        p.fromCity,
        friend?.addressState || friend?.state,
      );
      if (!coord) continue;
      const key = coordKey(coord);
      const existing = map.get(key);
      if (existing) {
        existing.receivedCount += 1;
      } else {
        map.set(key, {
          key,
          coord,
          cityName: p.fromCity,
          sendCount: 0,
          receivedCount: 1,
          mostRecentSendMs: 0,
        });
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Pick the coord-key of the most-recently-sent destination. Returns null
 * when the user has never sent (cityStats has no rows with
 * mostRecentSendMs > 0). The Map screen uses this key to mark a single
 * pin as "isNewest" (gold pulse + solid line).
 */
export function pickNewestSendKey(stats: CityStat[]): string | null {
  let bestMs = 0;
  let bestKey: string | null = null;
  for (const s of stats) {
    if (s.mostRecentSendMs > bestMs) {
      bestMs = s.mostRecentSendMs;
      bestKey = s.key;
    }
  }
  return bestKey;
}

/**
 * Opacity curve for the recency fade. Calibrated so that:
 *   0 mo  → 1.000 (just sent — fully solid)
 *   1 mo  → 0.938
 *   3 mo  → 0.814
 *   6 mo  → 0.628
 *  12 mo  → 0.256 (just above the 0.25 floor)
 *  13+ mo → 0.250 (floor kicks in)
 *
 * Exported separately so tests can pin the curve to numeric expectations
 * without timezone funkiness.
 */
export function recencyOpacity(monthsAgo: number): number {
  return Math.max(0.25, Math.min(1, 1 - monthsAgo * 0.062));
}

/**
 * Line-thickness curve for frequency weighting:
 *   1 send  → 2.2 px
 *   3 sends → 3.4 px
 *   6+ sends → 5.2 px (capped — beyond 6 we don't keep getting bolder)
 */
export function frequencyWeight(sendCount: number): number {
  return 1.6 + Math.min(Math.max(sendCount, 0), 6) * 0.6;
}
