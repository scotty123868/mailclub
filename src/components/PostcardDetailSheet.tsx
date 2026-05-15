import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { RotateCcw, Share2, X } from "lucide-react-native";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Alert, Image, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { retryOrphanShipping } from "@/src/services/api";
import { useMailClub } from "@/src/state/MailClubContext";
import type { Postcard } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * PostcardDetailSheet — single-card detail bottom sheet.
 *
 * v0.7.0.7 addition. Distinct from PostcardPreviewSheet (which lists
 * cards filtered by city/friend). This one renders a SINGLE postcard
 * in full: photo + message + recipient + status, plus the
 * "Share again" surface for send-by-link cards.
 *
 * Why this exists: the user wanted past cards to expose their claim
 * URL so they can resend the link forever. The send-claim-link Edge
 * Function path is intentionally not used — the SHARE comes from the
 * user's own number/email via iOS Share Sheet (higher trust than a
 * Twilio short code). This sheet is where that "Share Again" button
 * lives, alongside the URL itself in case the user wants to copy it.
 *
 * Imperative API: parent holds a ref, calls open(postcardId).
 */

export type PostcardDetailSheetRef = {
  open: (postcardId: string) => void;
  close: () => void;
};

export const PostcardDetailSheet = forwardRef<PostcardDetailSheetRef>(
  (_, ref) => {
    const { postcards, friends, currentUser } = useMailClub();
    const sheetRef = useRef<BottomSheet>(null);
    const [activeId, setActiveId] = useState<string | null>(null);

    const snapPoints = useMemo(() => ["72%", "92%"], []);

    useImperativeHandle(
      ref,
      () => ({
        open: (postcardId) => {
          setActiveId(postcardId);
          // v0.7.0.25 BUGFIX: defer the snap until the next animation
          // frame. setActiveId() triggers a re-render; calling
          // snapToIndex(0) synchronously after the setState call fired
          // BEFORE the re-render, on the current BottomSheet (which was
          // the placeholder, see early-return removal below). The snap
          // got dropped on the floor — taps on journal tiles did nothing.
          //
          // The cleaner fix was also to drop the conditional placeholder
          // BottomSheet (the if(!postcard) branch below was returning a
          // separate element, so the ref pointed at a stale instance for
          // exactly one render). Both changes ship together.
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

    const postcard = useMemo<Postcard | null>(
      () => postcards.find((p) => p.id === activeId) ?? null,
      [postcards, activeId],
    );

    const isPending = !!postcard && postcard.toFriendId === "";
    const recipientLabel = useMemo(() => {
      if (!postcard) return "";
      if (isPending) return "Awaiting recipient";
      if (postcard.toFriendId === "void") return "Pen pal (anonymous)";
      const friend = friends.find((f) => f.id === postcard.toFriendId);
      return friend?.name ?? postcard.toCity ?? "Recipient";
    }, [postcard, isPending, friends]);

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

    // v0.7.0.11: retry-orphan state. A postcard is an "orphan" when it
    // exists in the DB but `lob_id` is null — Lob never accepted it.
    // The user can tap "Retry shipping" to push it through again. The
    // server-side retry function generates HTML for the front + back
    // and submits to Lob, so it works for both friend-mode and
    // claim-mode orphans.
    const [retrying, setRetrying] = useState(false);
    const isOrphan = !!postcard && !postcard.lobId && postcard.toFriendId !== "" && postcard.toFriendId !== "void" && postcard.status === "sent";

    async function onShareAgain() {
      if (!postcard?.claimUrl) return;
      const senderFirst = currentUser?.name?.split(" ")[0] || "I";
      try {
        Haptics.selectionAsync().catch(() => {});
      } catch {
        /* no-op on simulators without haptics */
      }
      try {
        await Share.share({
          message: `${senderFirst} sent you a postcard on Mailroom. Tap to claim it — ${postcard.claimUrl}`,
          url: postcard.claimUrl,
        });
      } catch {
        /* user dismissed share sheet — no-op */
      }
    }

    async function onRetryShipping() {
      if (!postcard?.id || retrying) return;
      setRetrying(true);
      try {
        Haptics.selectionAsync().catch(() => {});
      } catch {
        /* no-op */
      }
      const result = await retryOrphanShipping(postcard.id);
      setRetrying(false);
      if (result.ok) {
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } catch {
          /* no-op */
        }
        Alert.alert(
          "Sent to print",
          "Your card is on its way to the press. We'll update the status when it ships.",
        );
        sheetRef.current?.close();
      } else {
        Alert.alert("Couldn't retry", result.error ?? "Try again in a minute.");
      }
    }

    // v0.7.0.25: removed the `if (!postcard) return <BottomSheet ... empty />`
    // early-return that previously rendered a SEPARATE BottomSheet element
    // when activeId was null. React/Reanimated treat that as a fresh
    // BottomSheet instance, so the ref's snap call fires against the wrong
    // sheet for one render — taps on journal tiles produced no visible
    // sheet. The single BottomSheet below stays mounted across renders
    // (index={-1} keeps it hidden); we conditionally render the rich
    // body only when a postcard is resolved.
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
        <BottomSheetScrollView contentContainerStyle={styles.body}>
          {!postcard ? (
            // Mounted but no card yet — render nothing visible.
            <View />
          ) : (
            <>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.kicker}>
                {isPending ? "AWAITING ADDRESS" : statusKicker(postcard.status)}
              </Text>
              <Text style={styles.title} numberOfLines={1}>
                To {recipientLabel}
              </Text>
              <Text style={styles.subtitle}>{formatDate(postcard.sentAt)}</Text>
            </View>
            <Pressable
              onPress={() => sheetRef.current?.close()}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              testID="postcard-detail-close"
            >
              <X color={colors.ink} size={20} strokeWidth={1.8} />
            </Pressable>
          </View>

          {/* Photo + message — the postcard itself */}
          <View style={styles.cardFrame}>
            {postcard.photoUri ? (
              <Image
                source={{ uri: postcard.photoUri }}
                style={styles.cardPhoto}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.cardPhoto, styles.cardPhotoPlaceholder]} />
            )}
            <View style={styles.cardMessageBox}>
              <Text style={styles.cardMessage} numberOfLines={6}>
                {postcard.message ? `"${postcard.message}"` : "(no message)"}
              </Text>
            </View>
          </View>

          {/* Share-again block — only for send-link cards */}
          {postcard.claimUrl ? (
            <View style={styles.shareBlock}>
              <Text style={styles.shareKicker}>
                {isPending ? "SOLICIT THEIR ADDRESS" : "SHARE LINK"}
              </Text>
              <Text style={styles.shareBlurb}>
                {isPending
                  ? "Send this link to the recipient. They'll add their mailing address, and we'll drop the card in the post."
                  : "This is the link you sent. Share again if they lost it."}
              </Text>
              <View style={styles.urlBox}>
                <Text style={styles.urlText} numberOfLines={2} ellipsizeMode="middle">
                  {postcard.claimUrl}
                </Text>
              </View>
              <Pressable
                onPress={onShareAgain}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Share link"
                testID="postcard-detail-share-again"
              >
                <Share2 color={colors.paper} size={16} strokeWidth={1.8} />
                <Text style={styles.primaryBtnText}>Share link</Text>
              </Pressable>
            </View>
          ) : null}

          {/* v0.7.0.11: orphan retry. A card with no lob_id has never
              reached Lob — usually because of the build 15-18
              capture-inside-Modal bug. Surface a retry button so the
              user can push it through without losing the row. */}
          {isOrphan ? (
            <View style={styles.orphanBlock}>
              <Text style={styles.orphanKicker}>NOT SHIPPED YET</Text>
              <Text style={styles.orphanBlurb}>
                Looks like this card didn&apos;t reach the printer. Tap below to send it again.
              </Text>
              <Pressable
                onPress={onRetryShipping}
                disabled={retrying}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  retrying && { opacity: 0.7 },
                  pressed && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Retry shipping"
                testID="postcard-detail-retry"
              >
                {retrying ? (
                  <ActivityIndicator color={colors.paper} size="small" />
                ) : (
                  <RotateCcw color={colors.paper} size={16} strokeWidth={1.8} />
                )}
                <Text style={styles.primaryBtnText}>
                  {retrying ? "Sending..." : "Retry shipping"}
                </Text>
              </Pressable>
            </View>
          ) : null}
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  },
);

PostcardDetailSheet.displayName = "PostcardDetailSheet";

function statusKicker(status: Postcard["status"]): string {
  switch (status) {
    case "delivered":
      return "DELIVERED";
    case "sent":
      return "IN TRANSIT";
    case "draft":
      return "DRAFT";
    case "awaiting_address":
      return "WAITING ON ADDRESS";
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
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
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 48,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingBottom: 14,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
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
  cardFrame: {
    backgroundColor: colors.white,
    borderRadius: 10,
    borderColor: colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  cardPhoto: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: colors.paperDark,
  },
  cardPhotoPlaceholder: {
    backgroundColor: colors.paperDark,
  },
  cardMessageBox: {
    padding: 16,
    backgroundColor: colors.white,
  },
  cardMessage: {
    color: colors.ink,
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    lineHeight: 22,
  },
  shareBlock: {
    marginTop: 20,
    padding: 16,
    backgroundColor: colors.paperDark,
    borderRadius: 12,
    borderColor: colors.line,
    borderWidth: StyleSheet.hairlineWidth,
  },
  orphanBlock: {
    marginTop: 16,
    padding: 16,
    backgroundColor: colors.paperDark,
    borderRadius: 12,
    borderColor: colors.postalRed,
    borderWidth: 1,
  },
  orphanKicker: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  orphanBlurb: {
    color: colors.ink,
    fontFamily: fonts.serif,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  shareKicker: {
    color: colors.postalBlue,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  shareBlurb: {
    color: colors.mutedInk,
    fontFamily: fonts.serif,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  urlBox: {
    backgroundColor: colors.white,
    borderRadius: 6,
    borderColor: colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  urlText: {
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.ink,
    paddingVertical: 12,
    borderRadius: 100,
  },
  primaryBtnText: {
    color: colors.paper,
    fontFamily: fonts.serifSemi,
    fontSize: 14,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 100,
  },
  secondaryBtnText: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 14,
  },
});
