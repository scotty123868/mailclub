// v0.7.0.51 — unit tests for deterministic friend emoji.

import { emojiForFriendId, EMOJI_POOL_SIZE } from "@/src/lib/friendEmoji";

describe("emojiForFriendId", () => {
  it("returns the SAME emoji for the same id every call (stable)", () => {
    const id = "friend-abc-123";
    const e1 = emojiForFriendId(id);
    const e2 = emojiForFriendId(id);
    const e3 = emojiForFriendId(id);
    expect(e1).toBe(e2);
    expect(e2).toBe(e3);
  });

  it("returns DIFFERENT emojis for different ids (no obvious collisions)", () => {
    const ids = [
      "friend-a", "friend-b", "friend-c", "friend-d", "friend-e",
      "abc", "xyz", "11111", "22222",
    ];
    const seen = new Set<string>();
    for (const id of ids) seen.add(emojiForFriendId(id));
    // Allow some collisions over 9 inputs in a pool of ~96; but not all
    // mapping to the same emoji. At least 5 distinct outputs.
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it("returns a non-empty string for any input including empty/null", () => {
    expect(emojiForFriendId("").length).toBeGreaterThan(0);
    expect(emojiForFriendId(null).length).toBeGreaterThan(0);
    expect(emojiForFriendId(undefined).length).toBeGreaterThan(0);
  });

  it("falls back to a stable default for empty/null/undefined", () => {
    const e1 = emojiForFriendId("");
    const e2 = emojiForFriendId(null);
    const e3 = emojiForFriendId(undefined);
    expect(e1).toBe(e2);
    expect(e2).toBe(e3);
  });

  it("handles real-world UUID format ids", () => {
    const uuids = [
      "9f12c8d1-2a3b-4567-89ab-cdef01234567",
      "00000000-0000-0000-0000-000000000001",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ];
    const out = uuids.map(emojiForFriendId);
    out.forEach((e) => expect(e.length).toBeGreaterThan(0));
  });

  it("the pool has at least 50 emojis (enough variety)", () => {
    expect(EMOJI_POOL_SIZE).toBeGreaterThanOrEqual(50);
  });
});
