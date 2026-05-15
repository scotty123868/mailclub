import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Postcard } from "@/src/types/mail";
import type { VoidReply } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * WeeklyJournal — week-by-week postcard gallery.
 *
 * Designed for the My Card tab. Groups all the user&apos;s postcards
 * (sent + received void replies) by ISO week, sorts weeks newest-first,
 * renders each week as a horizontal strip of mini-cards. The final tile
 * in the current week is always a "+" tile that taps through to the
 * send flow — empty weeks are <i>invitations</i>, not voids.
 *
 * v0.7 magical-moment hooks (D.3, D.4) wire in here later:
 *   • Reciprocation badge: gold ring + "Your pen pal" stamp when an
 *     inbound card is from someone the user mailed first. Requires
 *     `senderId` on Postcard, which the type doesn&apos;t carry yet
 *     (TODO when the postcardFromRow mapper exposes it).
 *   • Empty-week whisper: trailing tile in the current week morphs
 *     from a quiet "+" into "Mail someone →" if no card has been
 *     sent in the last 7 days. Hook: `lastSentAt` prop.
 *
 * Both moments are scaffolded — see comments inline.
 */

type CardItem = {
  id: string;
  kind: "sent" | "received";
  date: Date;
  /** Short label (recipient name or sender name). */
  label?: string;
  photoUri?: string;
  /** Whether this is a queued (send-link, not yet shipped) card. */
  queued?: boolean;
  /** v0.7 D.3 — gold ring + "Your pen pal" overlay if reciprocated. */
  reciprocated?: boolean;
};

type WeekBucket = {
  /** Week-of date string ("This week" or "Apr 26"). */
  label: string;
  /** Sort key: Sunday-of-week ISO date. */
  weekStart: Date;
  /** Whether this bucket represents the current week (gets the empty CTA). */
  isCurrent: boolean;
  cards: CardItem[];
};

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  // ISO week = Monday-anchored. We use Monday so "this week" matches
  // the user&apos;s mental model better than Sunday in most US locales
  // for habit tracking.
  const day = out.getDay(); // 0 = Sun
  const diff = (day === 0 ? -6 : 1 - day);
  out.setDate(out.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

function sameWeek(a: Date, b: Date): boolean {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}

function formatWeekLabel(weekStart: Date, now: Date): string {
  if (sameWeek(weekStart, now)) return "This week";
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  if (sameWeek(weekStart, lastWeek)) return "Last week";
  const month = weekStart.toLocaleString("en-US", { month: "short" });
  return `${month} ${weekStart.getDate()}`;
}

function bucketByWeek(items: CardItem[], now: Date): WeekBucket[] {
  // Group by Monday-start week.
  const map = new Map<number, CardItem[]>();
  for (const item of items) {
    const key = startOfWeek(item.date).getTime();
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }

  // Always include the current week even if empty so the empty-state
  // "+" tile renders. That tile is the invitation to send.
  const currentKey = startOfWeek(now).getTime();
  if (!map.has(currentKey)) map.set(currentKey, []);

  const buckets: WeekBucket[] = [];
  for (const [key, cards] of map.entries()) {
    const weekStart = new Date(key);
    cards.sort((a, b) => b.date.getTime() - a.date.getTime());
    buckets.push({
      weekStart,
      label: formatWeekLabel(weekStart, now),
      isCurrent: key === currentKey,
      cards,
    });
  }
  buckets.sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());
  return buckets;
}

export type WeeklyJournalProps = {
  postcards: Postcard[];
  voidReplies: VoidReply[];
  /** Current user id. Used to classify cards as inbound vs outbound by
   *  comparing against `Postcard.senderId`. v0.7.1: when senderId is
   *  absent (older mock data, pre-migration rows), card defaults to
   *  outbound — that&apos;s the historical assumption. */
  currentUserId?: string | null;
  /**
   * Map of friendId → friend name. Used to label inbound cards with
   * the sender&apos;s name + decide whether a card is reciprocated
   * (i.e. both an inbound AND outbound card exist for the same friend).
   */
  friendNamesById?: Map<string, string>;
  /** Tap a card → open its detail (today: opens the mail-history sheet). */
  onPressCard?: (cardId: string) => void;
  /** Tap a trailing empty "+" or "Mail someone →" tile → start the send flow. */
  onPressEmptyTile?: () => void;
  /** Optional override for testing — defaults to new Date(). */
  now?: Date;
};

export function WeeklyJournal({
  postcards,
  voidReplies,
  currentUserId,
  friendNamesById,
  onPressCard,
  onPressEmptyTile,
  now,
}: WeeklyJournalProps) {
  const today = now ?? new Date();

  // v0.7.1 reciprocation detection: scan the postcards array twice —
  // once to identify which friendIds have BOTH inbound + outbound cards
  // from/to the user. Those friends&apos; cards get the gold ring + "Your
  // pen pal" stamp overlay.
  const reciprocatedFriends = (() => {
    if (!currentUserId) return new Set<string>();
    const outboundTo = new Set<string>();
    const inboundFrom = new Set<string>();
    for (const p of postcards) {
      const isOutbound = p.senderId
        ? p.senderId === currentUserId
        : true; // legacy assumption: postcards without senderId are outbound
      if (isOutbound) {
        if (p.toFriendId && p.toFriendId !== "void") outboundTo.add(p.toFriendId);
      } else if (p.senderId) {
        inboundFrom.add(p.senderId);
      }
    }
    const both = new Set<string>();
    outboundTo.forEach((id) => { if (inboundFrom.has(id)) both.add(id); });
    return both;
  })();

  // Merge sent postcards + received void replies into one timeline.
  const items: CardItem[] = [
    ...postcards.map<CardItem>((p) => {
      const isOutbound = p.senderId
        ? p.senderId === currentUserId
        : true;
      // For inbound cards:
      //   - From a known friend: use friend name
      //   - From a stranger (Postcrossing-matched): "Pen pal" (+ city
      //     if known) since we don't expose the sender's identity
      //   - Unknown: "Someone" fallback
      // For outbound: label = recipient city (existing).
      //
      // v0.7.0.28: detect stranger via toFriendId === "void". When a
      // pen pal card is matched server-side, the postcard row has
      // to_kind='void' (postcardFromRow maps this to
      // toFriendId="void"). Inbound + toFriendId==="void" === a
      // matched stranger card. Show "Pen pal" so the user knows it's
      // from the Postcrossing loop, optionally followed by the
      // sender's city if we have it.
      let label: string | undefined;
      if (isOutbound) {
        label = p.toCity || undefined;
      } else if (p.toFriendId === "void") {
        // Matched stranger card (inbound).
        label = p.fromCity ? `Pen pal · ${p.fromCity}` : "Pen pal";
      } else if (p.senderId && friendNamesById) {
        label = friendNamesById.get(p.senderId) ?? "Someone";
      } else {
        label = "Someone";
      }
      // Reciprocation flag: inbound card from a friend the user has
      // ALSO mailed (i.e. the friend reciprocated the loop). Gold ring
      // overlay = D.3 magical moment.
      const otherSide = isOutbound ? p.toFriendId : p.senderId;
      const reciprocated =
        !!otherSide && otherSide !== "void" && reciprocatedFriends.has(otherSide);
      return {
        id: p.id,
        kind: isOutbound ? "sent" : "received",
        date: new Date(p.sentAt),
        label,
        photoUri: p.photoUri,
        queued: p.toFriendId === "",
        reciprocated,
      };
    }),
    ...voidReplies.map<CardItem>((v) => ({
      id: v.id,
      kind: "received",
      date: new Date(v.receivedAt),
      label: v.from,
    })),
  ];

  const buckets = bucketByWeek(items, today);

  // v0.7 D.4: empty-week whisper. If the current week has zero cards,
  // the trailing tile morphs from a quiet "+" into "Mail someone →".
  // Same for any week where the user&apos;s been quiet for 7+ days.
  const currentWeek = buckets.find((b) => b.isCurrent);
  const currentWeekEmpty = currentWeek && currentWeek.cards.length === 0;

  if (buckets.length === 0) {
    // Should never happen — bucketByWeek always inserts the current
    // week. But TS doesn&apos;t know that.
    return null;
  }

  return (
    <View testID="weekly-journal">
      {buckets.map((bucket) => (
        <View key={bucket.weekStart.toISOString()} style={styles.weekRow}>
          <Text style={styles.weekLabel}>{bucket.label.toUpperCase()}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cardsRow}
          >
            {bucket.cards.map((card) => (
              <CardTile
                key={card.id}
                item={card}
                onPress={() => onPressCard?.(card.id)}
              />
            ))}
            {bucket.isCurrent ? (
              <EmptyTile
                whisper={!!currentWeekEmpty}
                onPress={onPressEmptyTile}
              />
            ) : null}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

function CardTile({ item, onPress }: { item: CardItem; onPress: () => void }) {
  const isInbound = item.kind === "received";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isInbound && styles.cardInbound,
        item.queued && styles.cardQueued,
        item.reciprocated && styles.cardReciprocated,
        pressed && styles.cardPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${isInbound ? "Received" : "Sent"} postcard${item.label ? ` to ${item.label}` : ""}`}
      testID={`journal-card-${item.id}`}
    >
      {item.photoUri ? (
        <Image source={{ uri: item.photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cardPlaceholderBg]} />
      )}
      {/* Stamp dot — red for sent, blue for received. */}
      <View
        style={[
          styles.stampDot,
          { backgroundColor: isInbound ? colors.postalBlue : colors.postalRed },
        ]}
      />
      {item.label ? (
        <Text style={styles.cardLabel} numberOfLines={1}>
          {item.label}
        </Text>
      ) : null}
      {item.queued ? (
        <View style={styles.queuedBadge}>
          <Text style={styles.queuedText}>QUEUED</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function EmptyTile({
  whisper,
  onPress,
}: {
  whisper: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        whisper ? styles.emptyTileWhisper : styles.emptyTile,
        pressed && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={whisper ? "Mail someone" : "Add a postcard"}
      testID={whisper ? "journal-empty-whisper" : "journal-empty-add"}
    >
      <Text style={whisper ? styles.emptyTileWhisperText : styles.emptyTileText}>
        {whisper ? "Mail someone →" : "+"}
      </Text>
    </Pressable>
  );
}

const TILE_W = 88;
const TILE_H = 60;

const styles = StyleSheet.create({
  weekRow: {
    paddingBottom: 14,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  weekLabel: {
    color: colors.mutedInk,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  cardsRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 16,
  },

  card: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: 6,
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  cardInbound: {
    // Blue ring for received cards.
    borderColor: colors.postalBlue,
    borderWidth: 1.6,
  },
  cardQueued: {
    borderStyle: "dashed",
    borderColor: colors.postalBlue,
    borderWidth: 1.5,
    backgroundColor: colors.paper,
  },
  cardReciprocated: {
    // v0.7 D.3 magical-moment gold ring.
    borderColor: "#D0AB55",
    borderWidth: 2,
    shadowColor: "#B89A60",
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  cardPressed: { opacity: 0.85 },
  cardPlaceholderBg: {
    backgroundColor: colors.paperDark,
  },

  stampDot: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 11,
    height: 13,
    borderRadius: 2,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
  },
  cardLabel: {
    position: "absolute",
    bottom: 4,
    left: 6,
    right: 6,
    color: "white",
    fontFamily: fonts.script,
    fontSize: 12,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  queuedBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    backgroundColor: "rgba(60,110,143,0.95)",
    borderRadius: 2,
  },
  queuedText: {
    color: "white",
    fontFamily: fonts.sansBold,
    fontSize: 7,
    letterSpacing: 0.6,
  },

  emptyTile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: 6,
    borderColor: colors.line,
    borderStyle: "dashed",
    borderWidth: 1.5,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTileText: {
    color: colors.mutedInk,
    fontFamily: fonts.serif,
    fontSize: 22,
    lineHeight: 22,
  },
  emptyTileWhisper: {
    width: TILE_W * 1.4,
    height: TILE_H,
    borderRadius: 6,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  emptyTileWhisperText: {
    color: colors.paper,
    fontFamily: fonts.serifSemi,
    fontSize: 13,
    letterSpacing: -0.2,
  },
});
