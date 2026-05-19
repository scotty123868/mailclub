// v0.7.0.51 — deterministic emoji-per-friend.
//
// The previous avatar treatment (IllustratedAvatar with `friend.id as
// AvatarLook` cast) silently mapped every unknown friend to the same
// Sam palette, so newly-added friends all looked identical. The fix:
// every friend gets a unique emoji computed from their id via a stable
// hash, with the emoji rendered on the existing paper-cream avatar disc.
//
// Pool is curated for friendliness — animals, plants, weather, objects.
// No facial-expression emojis (those imply mood / could mismatch the
// person), no flags, no anything that could read as politically charged.
// Order is fixed; do NOT alphabetize or shuffle — the mapping is stable
// only as long as this array doesn't reorder. Appending new emojis to
// the end is safe and just expands the pool.

/**
 * 96 friendly emojis. Categorized in groups for readability but the
 * lookup is hash-mod-length so groups are not semantic.
 */
const POOL: readonly string[] = [
  // Mammals
  "🐶", "🐱", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮",
  "🐷", "🐵", "🐺", "🐴", "🦄", "🐗", "🐹", "🐭", "🦝", "🦡",
  "🦨", "🦦", "🦥", "🦘", "🦒", "🐘", "🦏", "🦛", "🐪", "🦔",
  // Birds + reptiles + sea
  "🐔", "🐧", "🦆", "🦉", "🦚", "🦜", "🐦", "🦢", "🐢", "🦎",
  "🐠", "🐬", "🐳", "🦈", "🐙", "🦀", "🐌", "🦋", "🐝", "🐞",
  // Plants + nature
  "🌹", "🌻", "🌷", "🌸", "🌼", "🌺", "🪻", "🌵", "🌴", "🌳",
  "🌲", "🍀", "🌾", "🌱", "🍄", "🌊", "🌅", "🌈", "⭐", "✨",
  // Food (gentle subset)
  "🍎", "🍊", "🍋", "🍓", "🍇", "🍑", "🥑", "🌶️", "🫐", "🍉",
  // Objects (postal + comforting)
  "✉️", "📮", "🎈", "🎁", "🖋️", "📚", "🪁", "🎨", "⛵", "🚲",
  "🗝️", "🕯️", "🎻", "🌍",
] as const;

/**
 * Stable string hash (djb2 variant). Plain `for` loop for speed; we
 * call this every render so it has to be O(n) in the id length with
 * no allocations.
 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff;
  }
  // The bitwise ops above produce a signed 32-bit int. Abs to feed
  // into mod cleanly.
  return Math.abs(h);
}

/**
 * Pick a deterministic emoji for a friend id. Same id always returns
 * the same emoji (across sessions and devices) so visual identity is
 * stable. Empty / null id falls back to the first pool entry.
 */
export function emojiForFriendId(id: string | null | undefined): string {
  if (!id) return POOL[0];
  return POOL[djb2(id) % POOL.length];
}

/** Exposed for unit tests + curated documentation. */
export const EMOJI_POOL_SIZE = POOL.length;
