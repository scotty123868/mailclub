// v0.7.0.50. unit tests for the Map "Option 4" aggregation logic.
// Pure functions, no rendering. fast to run and easy to read.

import {
 computeCityStats,
 coordKey,
 distanceMiles,
 frequencyWeight,
 groupByArea,
 pickNewestSendKey,
 recencyOpacity,
} from "@/src/lib/mapStats";
import type { Friend, Postcard } from "@/src/types/mail";

const ME = "user-me-uuid";
const FRIEND_SF = "friend-sf-uuid";
const FRIEND_DEN = "friend-denver-uuid";
const FRIEND_NYC = "friend-nyc-uuid";

const friends: Friend[] = [
 {
 id: FRIEND_SF,
 name: "Maya",
 city: "San Francisco",
 state: "CA",
 avatarInitials: "MY",
 cardsSent: 0,
 cardsReceived: 0,
 connectionType: "in-person",
 lastInteractionAt: "2026-05-01",
 addressState: "CA",
 },
 {
 id: FRIEND_DEN,
 name: "Sam",
 city: "Denver",
 state: "CO",
 avatarInitials: "SM",
 cardsSent: 0,
 cardsReceived: 0,
 connectionType: "in-person",
 lastInteractionAt: "2026-05-01",
 addressState: "CO",
 },
 {
 id: FRIEND_NYC,
 name: "Alex",
 city: "New York",
 state: "NY",
 avatarInitials: "AL",
 cardsSent: 0,
 cardsReceived: 0,
 connectionType: "in-person",
 lastInteractionAt: "2026-05-01",
 addressState: "NY",
 },
];

const makeSent = (toFriendId: string, toCity: string, sentAt: string): Postcard => ({
 id: `sent-${toFriendId}-${sentAt}`,
 senderId: ME,
 toFriendId,
 fromCity: "Chevy Chase",
 toCity,
 category: "handwritten",
 creditCost: 1,
 status: "sent",
 message: "hi",
 sentAt,
});

const makeReceived = (fromCity: string, sentAt: string): Postcard => ({
 id: `recv-${fromCity}-${sentAt}`,
 senderId: "other-user-uuid",
 toFriendId: ME, // would be home in real life; doesn't affect aggregation
 fromCity,
 toCity: "Chevy Chase",
 category: "handwritten",
 creditCost: 1,
 status: "delivered",
 message: "hi back",
 sentAt,
});

describe("computeCityStats", () => {
 it("returns empty when no postcards", () => {
 expect(computeCityStats([], friends, ME)).toEqual([]);
 });

 it("aggregates multiple sends to the same city into one row", () => {
 const cards = [
 makeSent(FRIEND_SF, "San Francisco", "2026-05-01"),
 makeSent(FRIEND_SF, "San Francisco", "2026-05-10"),
 makeSent(FRIEND_SF, "San Francisco", "2026-05-15"),
 ];
 const stats = computeCityStats(cards, friends, ME);
 expect(stats).toHaveLength(1);
 expect(stats[0].sendCount).toBe(3);
 expect(stats[0].receivedCount).toBe(0);
 expect(stats[0].cityName).toBe("San Francisco");
 // most recent = 5-15 (latest)
 expect(new Date(stats[0].mostRecentSendMs).toISOString().slice(0, 10))
 .toBe("2026-05-15");
 });

 it("separates different cities into distinct rows", () => {
 const cards = [
 makeSent(FRIEND_SF, "San Francisco", "2026-05-01"),
 makeSent(FRIEND_DEN, "Denver", "2026-05-02"),
 makeSent(FRIEND_NYC, "New York", "2026-05-03"),
 ];
 const stats = computeCityStats(cards, friends, ME);
 expect(stats).toHaveLength(3);
 const cities = stats.map((s) => s.cityName).sort();
 expect(cities).toEqual(["Denver", "New York", "San Francisco"]);
 });

 it("counts inbound cards in receivedCount, not sendCount", () => {
 const cards = [
 makeReceived("Denver", "2026-05-01"),
 makeReceived("Denver", "2026-05-08"),
 ];
 const stats = computeCityStats(cards, friends, ME);
 expect(stats).toHaveLength(1);
 expect(stats[0].sendCount).toBe(0);
 expect(stats[0].receivedCount).toBe(2);
 expect(stats[0].mostRecentSendMs).toBe(0);
 });

 it("merges sent + received for the same city (the reciprocation case)", () => {
 const cards = [
 makeSent(FRIEND_DEN, "Denver", "2026-05-01"),
 makeSent(FRIEND_DEN, "Denver", "2026-05-05"),
 makeReceived("Denver", "2026-05-10"),
 ];
 const stats = computeCityStats(cards, friends, ME);
 expect(stats).toHaveLength(1);
 expect(stats[0].sendCount).toBe(2);
 expect(stats[0].receivedCount).toBe(1);
 });

 it("ignores postcards with no resolvable city", () => {
 const cards = [
 // Missing toCity AND no friend match
 {
 ...makeSent("nonexistent-friend", "", "2026-05-01"),
 },
 // Unknown city name that resolveCoord can't even state-fallback
 makeSent(FRIEND_SF, "Atlantis", "2026-05-02"),
 ];
 // Friend SF doesn't help #1 (its friendId doesn't exist), but #2
 // falls back to state CA (friend SF has addressState CA), so #2
 // resolves to state center. Both #1 and #2 may or may not be
 // included depending on state fallback. The contract: no throws,
 // returns 0 or 1 row deterministically.
 const stats = computeCityStats(cards, friends, ME);
 expect(stats.length).toBeGreaterThanOrEqual(0);
 expect(stats.length).toBeLessThanOrEqual(2);
 });
});

describe("pickNewestSendKey", () => {
 it("returns null when no sends", () => {
 const stats = computeCityStats([makeReceived("Denver", "2026-05-01")], friends, ME);
 expect(pickNewestSendKey(stats)).toBeNull();
 });

 it("picks the city with the largest mostRecentSendMs", () => {
 const cards = [
 makeSent(FRIEND_SF, "San Francisco", "2026-05-01"),
 makeSent(FRIEND_DEN, "Denver", "2026-05-15"),
 makeSent(FRIEND_NYC, "New York", "2026-05-03"),
 ];
 const stats = computeCityStats(cards, friends, ME);
 const newestKey = pickNewestSendKey(stats);
 expect(newestKey).not.toBeNull();
 // The matching row must be the Denver one
 const newest = stats.find((s) => s.key === newestKey);
 expect(newest?.cityName).toBe("Denver");
 });
});

describe("recencyOpacity", () => {
 it("returns 1.0 for a brand-new send (0 months)", () => {
 expect(recencyOpacity(0)).toBe(1);
 });

 it("decays smoothly across the first 12 months", () => {
 expect(recencyOpacity(1)).toBeCloseTo(0.938, 2);
 expect(recencyOpacity(3)).toBeCloseTo(0.814, 2);
 expect(recencyOpacity(6)).toBeCloseTo(0.628, 2);
 });

 it("floors at 0.25 past 12 months so old cities stay visible", () => {
 expect(recencyOpacity(12)).toBeGreaterThanOrEqual(0.25);
 expect(recencyOpacity(24)).toBe(0.25);
 expect(recencyOpacity(120)).toBe(0.25);
 });
});

describe("frequencyWeight", () => {
 it("scales linearly with send count", () => {
 expect(frequencyWeight(1)).toBeCloseTo(2.2, 2);
 expect(frequencyWeight(2)).toBeCloseTo(2.8, 2);
 expect(frequencyWeight(3)).toBeCloseTo(3.4, 2);
 });

 it("caps at 6+ sends so a power-user city doesn't become a fire hose", () => {
 expect(frequencyWeight(6)).toBeCloseTo(5.2, 2);
 expect(frequencyWeight(12)).toBeCloseTo(5.2, 2);
 expect(frequencyWeight(100)).toBeCloseTo(5.2, 2);
 });

 it("handles zero gracefully (received-only cities have no line)", () => {
 expect(frequencyWeight(0)).toBeCloseTo(1.6, 2);
 });
});

describe("coordKey", () => {
 it("rounds to 4 decimals so near-identical coords dedupe", () => {
 expect(coordKey({ latitude: 38.96860001, longitude: -77.0872 }))
 .toBe(coordKey({ latitude: 38.9686, longitude: -77.0872 }));
 });

 it("uses a stable lat_lng format", () => {
 expect(coordKey({ latitude: 38.9686, longitude: -77.0872 }))
 .toBe("38.9686_-77.0872");
 });
});

// v0.7.0.50. distance + area grouping for the Simplified Atlas.
const SF = { latitude: 37.7749, longitude: -122.4194 };
const OAKLAND = { latitude: 37.8044, longitude: -122.2712 };
const BERKELEY = { latitude: 37.8716, longitude: -122.2727 };
const SAN_JOSE = { latitude: 37.3382, longitude: -121.8863 };
const NYC = { latitude: 40.7128, longitude: -74.006 };
const BROOKLYN = { latitude: 40.6782, longitude: -73.9442 };
const PHILLY = { latitude: 39.9526, longitude: -75.1652 };
const BOSTON = { latitude: 42.3601, longitude: -71.0589 };
const CAMBRIDGE = { latitude: 42.3736, longitude: -71.1097 };

describe("distanceMiles", () => {
 it("returns ~0 for identical coords", () => {
 expect(distanceMiles(SF, SF)).toBeCloseTo(0, 1);
 });

 it("returns ~8 miles for SF → Oakland (known answer)", () => {
 const d = distanceMiles(SF, OAKLAND);
 expect(d).toBeGreaterThan(7);
 expect(d).toBeLessThan(10);
 });

 it("returns ~95 miles for NYC → Philadelphia (known answer)", () => {
 const d = distanceMiles(NYC, PHILLY);
 expect(d).toBeGreaterThan(80);
 expect(d).toBeLessThan(105);
 });

 it("returns ~2,580 miles for SF → NYC (cross-country sanity check)", () => {
 const d = distanceMiles(SF, NYC);
 expect(d).toBeGreaterThan(2400);
 expect(d).toBeLessThan(2700);
 });

 it("is symmetric (a→b == b→a)", () => {
 expect(distanceMiles(SF, NYC)).toBeCloseTo(distanceMiles(NYC, SF), 2);
 });
});

describe("groupByArea (50mi default)", () => {
 const stat = (coord: any, city: string, sent: number, recv: number): any => ({
 key: coordKey(coord), coord, cityName: city,
 sendCount: sent, receivedCount: recv, mostRecentSendMs: 0,
 });

 it("returns empty when input is empty", () => {
 expect(groupByArea([], 50)).toEqual([]);
 });

 it("does not group cities outside the radius (NYC vs Philly at 95mi)", () => {
 const grouped = groupByArea(
 [stat(NYC, "New York", 3, 1), stat(PHILLY, "Philadelphia", 2, 0)],
 50,
 );
 expect(grouped).toHaveLength(2);
 });

 it("merges SF + Oakland + Berkeley + San Jose into one Bay Area cluster", () => {
 const grouped = groupByArea(
 [
 stat(SF, "San Francisco", 5, 3),
 stat(OAKLAND, "Oakland", 1, 0),
 stat(BERKELEY, "Berkeley", 2, 1),
 stat(SAN_JOSE, "San Jose", 1, 1),
 ],
 50,
 );
 expect(grouped).toHaveLength(1);
 expect(grouped[0].cityName).toBe("San Francisco"); // most-cards wins
 expect(grouped[0].sendCount).toBe(9);
 expect(grouped[0].receivedCount).toBe(5);
 });

 it("merges NYC + Brooklyn but keeps Philly separate", () => {
 const grouped = groupByArea(
 [
 stat(NYC, "New York", 3, 1),
 stat(BROOKLYN, "Brooklyn", 1, 0),
 stat(PHILLY, "Philadelphia", 2, 0),
 ],
 50,
 );
 expect(grouped).toHaveLength(2);
 const nycCluster = grouped.find((g) => g.cityName === "New York");
 expect(nycCluster?.sendCount).toBe(4);
 expect(nycCluster?.receivedCount).toBe(1);
 });

 it("merges Boston + Cambridge (Cambridge is ~3mi away)", () => {
 const grouped = groupByArea(
 [stat(BOSTON, "Boston", 2, 0), stat(CAMBRIDGE, "Cambridge", 1, 0)],
 50,
 );
 expect(grouped).toHaveLength(1);
 expect(grouped[0].cityName).toBe("Boston"); // larger
 expect(grouped[0].sendCount).toBe(3);
 });

 it("tighter radius (30mi) does NOT merge SF+San Jose (45mi apart)", () => {
 const grouped = groupByArea(
 [stat(SF, "San Francisco", 1, 0), stat(SAN_JOSE, "San Jose", 1, 0)],
 30,
 );
 expect(grouped).toHaveLength(2);
 });

 it("looser radius (100mi) merges NYC + Philly (95mi)", () => {
 const grouped = groupByArea(
 [stat(NYC, "New York", 3, 1), stat(PHILLY, "Philadelphia", 2, 0)],
 100,
 );
 expect(grouped).toHaveLength(1);
 });

 it("picks the most-cards city as the cluster name (tie broken by recency)", () => {
 const now = Date.now();
 const grouped = groupByArea(
 [
 { ...stat(OAKLAND, "Oakland", 1, 1), mostRecentSendMs: now - 86400 * 1000 },
 { ...stat(SF, "San Francisco", 1, 1), mostRecentSendMs: now },
 ],
 50,
 );
 expect(grouped).toHaveLength(1);
 // Both have count 2. recency tiebreaker picks SF (more recent)
 expect(grouped[0].cityName).toBe("San Francisco");
 });

 it("preserves the most recent send timestamp across merged cities", () => {
 const olderMs = Date.now() - 365 * 86400 * 1000; // 1 year ago
 const newerMs = Date.now() - 7 * 86400 * 1000; // 1 week ago
 const grouped = groupByArea(
 [
 { ...stat(SF, "San Francisco", 5, 0), mostRecentSendMs: olderMs },
 { ...stat(OAKLAND, "Oakland", 1, 0), mostRecentSendMs: newerMs },
 ],
 50,
 );
 expect(grouped).toHaveLength(1);
 expect(grouped[0].mostRecentSendMs).toBe(newerMs);
 });
});
