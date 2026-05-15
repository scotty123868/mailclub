import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { ChevronRight, MapPin, Send, X } from "lucide-react-native";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMailClub } from "@/src/state/MailClubContext";
import type { Postcard } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * PostcardPreviewSheet — shared bottom-sheet used by Map (pin tap) and
 * Constellation (edge tap) to surface "what postcards happened here."
 *
 * v0.7.0.4 C.3 + constellation edge-tap polish:
 *   - Native-feel bottom sheet via @gorhom/bottom-sheet (gesture-handler
 *     dependency, drag-to-dismiss, spring physics)
 *   - Shows up to N postcards filtered to the tap context (e.g., postcards
 *     to/from a city, OR postcards exchanged with a specific friend)
 *   - Each row: photo thumbnail + recipient/sender + city + date + status
 *     dot. Tap row → routes to the send tab (re-send same recipient)
 *
 * Imperative API: parent holds a ref, calls `open({ context })` to surface
 * the sheet, `close()` to dismiss. The sheet auto-computes the postcards
 * to show from `context` against the current `postcards` array.
 *
 * Two contexts supported in v0.7.0.4:
 *   - { kind: "city", cityName }       — for the Map pin tap
 *   - { kind: "friend", friendId, friendName } — for the Constellation edge tap
 */

export type PostcardPreviewContext =
  | { kind: "city"; cityName: string }
  | { kind: "friend"; friendId: string; friendName: string };

export type PostcardPreviewSheetRef = {
  open: (ctx: PostcardPreviewContext) => void;
  close: () => void;
};

export const PostcardPreviewSheet = forwardRef<PostcardPreviewSheetRef>(
  (_, ref) => {
    const router = useRouter();
    const sheetRef = useRef<BottomSheet>(null);
    const { postcards, authedUserId } = useMailClub();

    // Hold the active context in state so changing it triggers a
    // re-render of the body's filtered list.
    const [ctx, setCtx] = useState<PostcardPreviewContext | null>(null);

    const snapPoints = useMemo(() => ["52%", "85%"], []);

    useImperativeHandle(
      ref,
      () => ({
        open: (nextCtx) => {
          setCtx(nextCtx);
          // v0.7.0.27: same snap-race fix that PostcardDetailSheet got
          // in build 39. setCtx() schedules a re-render; calling
          // snapToIndex synchronously fires against the still-empty
          // (index=-1) sheet from before the re-render, and the snap
          // is dropped. Map dot taps surfaced this — onCityPress
          // would set state but no sheet would rise. requestAnimationFrame
          // defers the snap until the re-render commits.
          requestAnimationFrame(() => {
            sheetRef.current?.snapToIndex(0);
          });
        },
        close: () => {
          sheetRef.current?.close();
        },
      }),
      [],
    );

    // Derive postcards relevant to the current context. For "city": any
    // outbound postcard whose toCity matches, plus inbound from that city.
    // For "friend": any postcard between current user and that friend.
    const items = useMemo(() => {
      if (!ctx) return [];
      const matches: Array<{ postcard: Postcard; otherSide: string; isOutbound: boolean }> = [];
      const norm = (s: string) => s.trim().toLowerCase();
      for (const p of postcards) {
        const isOutbound = p.senderId ? p.senderId === authedUserId : true;
        if (ctx.kind === "city") {
          const target = norm(ctx.cityName);
          const matchesCity =
            norm(p.toCity ?? "") === target ||
            norm(p.fromCity ?? "") === target;
          if (!matchesCity) continue;
          matches.push({
            postcard: p,
            otherSide: isOutbound ? p.toCity : p.fromCity,
            isOutbound,
          });
        } else {
          // friend context
          const otherId = isOutbound ? p.toFriendId : p.senderId;
          if (otherId !== ctx.friendId) continue;
          matches.push({
            postcard: p,
            otherSide: ctx.friendName,
            isOutbound,
          });
        }
      }
      matches.sort(
        (a, b) =>
          new Date(b.postcard.sentAt).getTime() - new Date(a.postcard.sentAt).getTime(),
      );
      return matches;
    }, [ctx, postcards, authedUserId]);

    const title = useMemo(() => {
      if (!ctx) return "";
      if (ctx.kind === "city") return ctx.cityName;
      return `You & ${ctx.friendName}`;
    }, [ctx]);

    const subtitle = useMemo(() => {
      if (!ctx) return "";
      const n = items.length;
      if (n === 0) return "No postcards yet.";
      const sent = items.filter((m) => m.isOutbound).length;
      const recv = n - sent;
      const parts: string[] = [];
      if (sent > 0) parts.push(`${sent} sent`);
      if (recv > 0) parts.push(`${recv} received`);
      return parts.join(" · ");
    }, [items]);

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.4}
          pressBehavior="close"
        />
      ),
      [],
    );

    function onTapCard(_postcardId: string) {
      // For v0.7.0.4 the card row routes to the send tab, pre-seeded
      // with the recipient (existing flow). Postcard detail screen
      // is a v0.7.1 future.
      sheetRef.current?.close();
      router.push("/send");
    }

    return (
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.bgPanel}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetView style={styles.body}>
          {/* Header row */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.kicker}>
                {ctx?.kind === "city" ? "MAILED FROM/TO" : "POSTCARDS BETWEEN"}
              </Text>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <Pressable
              onPress={() => sheetRef.current?.close()}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              testID="postcard-preview-close"
            >
              <X color={colors.ink} size={20} strokeWidth={1.8} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollBody}
            showsVerticalScrollIndicator={false}
          >
            {items.length === 0 ? (
              <View style={styles.emptyState}>
                <MapPin color={colors.mutedInk} size={28} strokeWidth={1.4} />
                <Text style={styles.emptyTitle}>No postcards yet.</Text>
                <Text style={styles.emptyBody}>
                  Send the first one. It only takes a minute.
                </Text>
                <Pressable
                  onPress={() => {
                    sheetRef.current?.close();
                    router.push("/send");
                  }}
                  style={styles.emptyCta}
                  testID="postcard-preview-empty-cta"
                >
                  <Send color={colors.paper} size={14} strokeWidth={1.8} />
                  <Text style={styles.emptyCtaText}>Mail a card</Text>
                </Pressable>
              </View>
            ) : (
              items.map((m, i) => (
                <Pressable
                  key={m.postcard.id}
                  onPress={() => onTapCard(m.postcard.id)}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && styles.rowBorder,
                    pressed && { opacity: 0.6 },
                  ]}
                  testID={`postcard-preview-row-${m.postcard.id}`}
                >
                  {/* Photo thumb or color block */}
                  {m.postcard.photoUri ? (
                    <Image
                      source={{ uri: m.postcard.photoUri }}
                      style={styles.thumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPlaceholder]}>
                      <View
                        style={[
                          styles.stampDot,
                          {
                            backgroundColor: m.isOutbound
                              ? colors.postalRed
                              : colors.postalBlue,
                          },
                        ]}
                      />
                    </View>
                  )}

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {m.isOutbound ? `To ${m.otherSide}` : `From ${m.otherSide}`}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {formatDate(m.postcard.sentAt)}
                      {" · "}
                      {statusLabel(m.postcard.status)}
                    </Text>
                    {m.postcard.message ? (
                      <Text style={styles.rowMessage} numberOfLines={2}>
                        “{m.postcard.message}”
                      </Text>
                    ) : null}
                  </View>

                  <ChevronRight color={colors.mutedInk} size={18} strokeWidth={1.6} />
                </Pressable>
              ))
            )}

            {/* Footer CTA: always offer "Mail another" if there's at least one */}
            {items.length > 0 ? (
              <Pressable
                onPress={() => {
                  sheetRef.current?.close();
                  router.push("/send");
                }}
                style={styles.footerCta}
                testID="postcard-preview-mail-another"
              >
                <Send color={colors.paper} size={15} strokeWidth={1.8} />
                <Text style={styles.footerCtaText}>
                  {ctx?.kind === "city"
                    ? "Mail another here"
                    : `Mail ${ctx?.kind === "friend" ? ctx.friendName : "them"}`}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </BottomSheetView>
      </BottomSheet>
    );
  },
);

PostcardPreviewSheet.displayName = "PostcardPreviewSheet";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function statusLabel(status: Postcard["status"]): string {
  switch (status) {
    case "sent":
      return "in transit";
    case "delivered":
      return "delivered";
    case "draft":
      return "draft";
    default:
      return status;
  }
}

const styles = StyleSheet.create({
  bgPanel: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleIndicator: {
    backgroundColor: colors.line,
    width: 44,
    height: 4,
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingBottom: 12,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kicker: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 24,
    letterSpacing: -0.3,
  },
  subtitle: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 100,
    backgroundColor: colors.paperDark,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollBody: {
    paddingTop: 8,
    paddingBottom: 32,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  rowBorder: {
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 56,
    height: 42,
    borderRadius: 4,
    backgroundColor: colors.paperDark,
    overflow: "hidden",
    position: "relative",
  },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  stampDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 10,
    height: 12,
    borderRadius: 2,
  },
  rowTitle: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 15,
  },
  rowMeta: {
    color: colors.mutedInk,
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.3,
    marginTop: 2,
    textTransform: "uppercase",
  },
  rowMessage: {
    color: colors.ink,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    lineHeight: 17,
    marginTop: 4,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 36,
    gap: 8,
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 18,
    marginTop: 8,
  },
  emptyBody: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    textAlign: "center",
    maxWidth: 260,
  },
  emptyCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 100,
    marginTop: 8,
  },
  emptyCtaText: {
    color: colors.paper,
    fontFamily: fonts.serifSemi,
    fontSize: 14,
  },
  footerCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.ink,
    paddingVertical: 13,
    borderRadius: 100,
    marginTop: 16,
  },
  footerCtaText: {
    color: colors.paper,
    fontFamily: fonts.serifSemi,
    fontSize: 15,
  },
});
