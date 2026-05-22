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
import { cancelPostcard, retryOrphanShipping } from "@/src/services/api";
import { humanizeLobError } from "@/src/services/lob";
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
    const { postcards, friends, currentUser, authedUserId, refreshPostcards } = useMailClub();
    const sheetRef = useRef<BottomSheet>(null);
    const [activeId, setActiveId] = useState<string | null>(null);

    const snapPoints = useMemo(() => ["72%", "92%"], []);

    useImperativeHandle(
      ref,
      () => ({
        open: (postcardId) => {
          setActiveId(postcardId);
          // v0.7.0.58: fire a background refetch of the postcard list the
          // moment the user opens a card. Realtime + AppState foreground
          // refresh should already keep the cache hot, but Realtime can
          // drop silently and the user's intent (tapping into a specific
          // card) is the perfect moment to guarantee fresh state. Bug
          // this closes: claim card stuck on "WAITING FOR THEIR ADDRESS"
          // long after the recipient redeemed, because Realtime missed
          // the event.
          refreshPostcards();
          // v0.7.0.25 BUGFIX: defer the snap until the next animation
          // frame. setActiveId() triggers a re-render; calling
          // snapToIndex(0) synchronously after the setState call fired
          // BEFORE the re-render, on the current BottomSheet (which was
          // the placeholder, see early-return removal below). The snap
          // got dropped on the floor — taps on journal tiles did nothing.
          requestAnimationFrame(() => {
            sheetRef.current?.snapToIndex(0);
          });
        },
        close: () => {
          sheetRef.current?.close();
        },
      }),
      [refreshPostcards],
    );

    const postcard = useMemo<Postcard | null>(
      () => postcards.find((p) => p.id === activeId) ?? null,
      [postcards, activeId],
    );

    // v0.7.0.58: "pending" means the claim hasn't been redeemed yet —
    // recipient hasn't filled in their address. Previously this was
    // toFriendId === "" alone, which is true for ALL claim cards
    // (claim cards never have a friend id), so even AFTER the recipient
    // claimed their card the sender's app kept saying "WAITING FOR
    // THEIR ADDRESS" forever. Status === "awaiting_address" flips to
    // something else as soon as redeem_postcard_claim runs.
    const isPending =
      !!postcard
      && postcard.toFriendId === ""
      && postcard.status === "awaiting_address";
    // v0.7.0.28: detect inbound (we received this) vs outbound (we sent
    // this). For Postcrossing-matched stranger cards the user receives,
    // the header should read "From [city]" rather than "To Pen pal
    // (anonymous)" (which made no sense for a card we received). For
    // outbound, behavior is unchanged.
    const isInbound = !!postcard && !!postcard.senderId && !!authedUserId && postcard.senderId !== authedUserId;
    const headerPrefix = isInbound ? "From" : "To";
    const recipientLabel = useMemo(() => {
      if (!postcard) return "";
      if (isPending) return "Awaiting recipient";
      if (isInbound) {
        // We received this. Label by sender identity.
        if (postcard.toFriendId === "void") {
          // Matched stranger card. Show city if known.
          return postcard.fromCity ? `Pen pal · ${postcard.fromCity}` : "Pen pal";
        }
        // Inbound from a known friend: friendNamesById lives in the
        // parent, but we have `friends` here. Look up by senderId.
        const friend = friends.find((f) => f.id === postcard.senderId);
        return friend?.name ?? postcard.fromCity ?? "Someone";
      }
      // Outbound — original behavior.
      // v0.7.0.49: differentiate "matching pending" from "matched + shipped".
      // A void card with no toCity is still in the matching queue (no recipient
      // yet); after matching the server populates toCity with the recipient's
      // location. Honest label so the user knows what's happening.
      if (postcard.toFriendId === "void") {
        return postcard.toCity ? "Pen pal (anonymous)" : "Finding a pen pal…";
      }
      if (postcard.toFriendId === "" && postcard.claimUrl) {
        if (postcard.claimedName) {
          return postcard.claimedCity
            ? `${postcard.claimedName} · ${postcard.claimedCity}`
            : postcard.claimedName;
        }
        return postcard.toCity ? `Recipient · ${postcard.toCity}` : "Recipient";
      }
      const friend = friends.find((f) => f.id === postcard.toFriendId);
      return friend?.name ?? postcard.toCity ?? "Recipient";
    }, [postcard, isPending, isInbound, friends]);

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
    //
    // v0.7.0.48 FIX (Codex P1.4b): the previous check required
    // `toFriendId !== ""`, which excluded ALL claim-mode cards (their
    // postcards.to_friend_id is never populated — the recipient address
    // lives on postcard_claims.claimed_*). Now we also surface retry for
    // claim cards once their status moves past "awaiting_address" (i.e.
    // the recipient redeemed and we tried to ship). Unclaimed cards
    // stay non-retryable — there's nothing to retry yet.
    const [retrying, setRetrying] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    // v0.7.0.59: cancel window. Lob lets us pull a card until it enters
    // production. Real-world that's typically a few hours after send, but
    // Lob's "batch print cutoff" varies by mail class and time of day, so
    // we surface the Cancel button only while lob_status is null/received
    // AND the card was sent in the last 30 min — that's a safe envelope
    // where Lob will almost always accept the cancellation. If Lob
    // rejects (already in production), the Edge Function returns a clear
    // error and no refund happens.
    const isCancellable = useMemo(() => {
      if (!postcard) return false;
      if (postcard.toFriendId === "" && !postcard.claimUrl) return false; // no claim, no friend
      if (postcard.status === "cancelled" || postcard.status === "delivered" || postcard.status === "expired") return false;
      const earlyLob = !postcard.lobStatus || postcard.lobStatus === "received";
      if (!earlyLob) return false;
      const sentMs = Date.parse(postcard.sentAt);
      if (Number.isNaN(sentMs)) return false;
      const elapsed = Date.now() - sentMs;
      return elapsed >= 0 && elapsed < 30 * 60 * 1000;
    }, [postcard]);

    const onCancel = useCallback(async () => {
      if (!postcard) return;
      Alert.alert(
        "Cancel this card?",
        "We'll ask the printer to pull it from the queue. If they've already started printing, we can't undo the send. If we catch it in time, your credit comes back.",
        [
          { text: "Keep sending", style: "cancel" },
          {
            text: "Cancel send",
            style: "destructive",
            onPress: async () => {
              setCancelling(true);
              try {
                const result = await cancelPostcard(postcard.id);
                if (result.ok) {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                  Alert.alert("Cancelled", result.refunded ? `Your ${result.refunded} credit is back in your wallet.` : "Postcard cancelled.");
                  // refreshPostcards will pull the new status; Realtime
                  // event from the row update should also flip the UI.
                  refreshPostcards();
                } else {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                  Alert.alert(
                    "Couldn't cancel",
                    result.error?.includes("production") || result.error?.includes("422")
                      ? "The printer's already started on this one. It's on its way."
                      : result.error ?? "Try again in a moment.",
                  );
                }
              } finally {
                setCancelling(false);
              }
            },
          },
        ],
      );
    }, [postcard, refreshPostcards]);
    const isClaimCardRedeemedAndOrphan =
      !!postcard
      && postcard.toFriendId === ""
      && !!postcard.claimUrl
      && postcard.status === "sent"
      && !postcard.lobId;
    const isFriendCardOrphan =
      !!postcard
      && postcard.toFriendId !== ""
      && postcard.toFriendId !== "void"
      && postcard.status === "sent"
      && !postcard.lobId;
    const isOrphan = isFriendCardOrphan || isClaimCardRedeemedAndOrphan;

    async function onShareAgain() {
      if (!postcard?.claimUrl) return;
      try {
        Haptics.selectionAsync().catch(() => {});
      } catch {
        /* no-op on simulators without haptics */
      }
      try {
        // v0.7.0.28: dropped third-person sender reference + brand
        // mention. The chat thread already shows who's sending; the
        // message just has to communicate intent + the link. User
        // feedback: previous copy felt "marketing-y, not genuine."
        // Also dropped the separate `url` param — many iOS share
        // extensions (Slack especially) ignore message when url is
        // present and surface only the URL. Baking the URL into the
        // message guarantees the full text pre-fills everywhere.
        await Share.share({
          message: `Hey, I want to send you a postcard but don't have your address. Share it securely here so you can receive the photo!\n\n${postcard.claimUrl}`,
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
        // v0.7.0.48 FIX (Codex bug 4): humanize the error. The retry-orphan
        // function now returns 200 with the real Lob error in the body
        // instead of non-2xx (which supabase-js wrapped as "Edge Function
        // returned a non-2xx status code" — the unreadable mess users saw).
        // Most common: failed_deliverability_strictness → USPS-can't-verify
        // message via humanizeLobError.
        Alert.alert(
          "Couldn't retry",
          humanizeLobError(result.error ?? "Try again in a minute."),
        );
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
                {/* v0.7.0.49 (Codex P2 #8): warm copy. Cold "AWAITING ADDRESS"
                    label felt like admin software; this app is emotional. */}
                {isPending ? "WAITING FOR THEIR ADDRESS" : statusKicker(postcard)}
              </Text>
              <Text style={styles.title} numberOfLines={1}>
                {headerPrefix} {recipientLabel}
              </Text>
              <Text style={styles.subtitle}>{formatDate(postcard.sentAt)}</Text>
              {/* v0.7.0.60: cancel button moved into the header subtitle
                  row so it's always visible without scrolling past the
                  photo. Was previously buried below the image where users
                  weren't finding it. Renders only while Lob's
                  cancellation window is open (lob_status null/"received"
                  AND sent_at within last 30 min). */}
              {isCancellable ? (
                <Pressable
                  onPress={onCancel}
                  disabled={cancelling}
                  style={({ pressed }) => [
                    styles.headerCancelBtn,
                    (cancelling || pressed) && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel postcard"
                  testID="postcard-detail-cancel"
                >
                  {cancelling ? (
                    <ActivityIndicator color={colors.postalRed} size="small" />
                  ) : null}
                  <Text style={styles.headerCancelBtnText}>
                    {cancelling ? "Cancelling…" : "Cancel send · refund credit"}
                  </Text>
                </Pressable>
              ) : null}
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
          {/* v0.7.0.48 FIX: previously an empty cream box rendered above
              the message whenever photoUri was missing. For handwritten
              cards (no photo expected) it looked like a broken/missing
              image; for photo cards it looked the same as a failed load.
              Now: handwritten cards skip the photo frame entirely (message
              gets the full card surface), and photo-category cards with
              a missing URI show an explicit "Photo unavailable" hint so
              the sender can tell the difference between intent and bug. */}
          <View style={styles.cardFrame}>
            {postcard.photoUri ? (
              <Image
                source={{ uri: postcard.photoUri }}
                style={styles.cardPhoto}
                resizeMode="cover"
              />
            ) : postcard.category !== "handwritten" ? (
              <View style={[styles.cardPhoto, styles.cardPhotoPlaceholder]}>
                <Text style={styles.cardPhotoHint}>Photo unavailable</Text>
              </View>
            ) : null}
            <View style={styles.cardMessageBox}>
              <Text style={styles.cardMessage} numberOfLines={6}>
                {postcard.message ? `"${postcard.message}"` : "(no message)"}
              </Text>
            </View>
          </View>

          {/* Share-again block — only for send-link cards that haven't
              been claimed yet. v0.7.0.58: once the recipient submits
              their address the claim_token is dead — re-sharing the
              link only shows "already claimed" to anyone else who taps
              it, so hide the share block entirely after redemption. */}
          {postcard.claimUrl && isPending ? (
            <View style={styles.shareBlock}>
              <Text style={styles.shareKicker}>SHARE THE ADDRESS LINK</Text>
              <Text style={styles.shareBlurb}>
                Send this link to your recipient. When they add their address, we drop the card in the post.
              </Text>
              {/* v0.7.0.49: expiry hint on unclaimed cards. Claims expire
                  30 days after creation; sender had no warning before. */}
              {isPending && postcard.claimExpiresAt ? (
                <ExpiryHint expiresAt={postcard.claimExpiresAt} />
              ) : null}
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
              {/* v0.7.0.49 (Codex audit): surface the actual reason. Was
                  persisted in postcards.lob_error but never read on retry. */}
              {postcard.lobError ? (
                <Text style={styles.orphanReason}>Last error: {postcard.lobError}</Text>
              ) : null}
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

          {/* v0.7.0.60: cancel button moved to the header row above;
              this slot intentionally left blank to keep diff small. */}
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  },
);

PostcardDetailSheet.displayName = "PostcardDetailSheet";

/**
 * v0.7.0.49: visible expiry hint on unclaimed Share-Link cards. Three
 * states: plenty (>7 days), soon (1-7 days), expired (≤0). The
 * yellow/red tone matches the existing postal palette.
 */
function ExpiryHint({ expiresAt }: { expiresAt: string }) {
  const expiresMs = new Date(expiresAt).getTime();
  const nowMs = Date.now();
  const daysLeft = Math.ceil((expiresMs - nowMs) / (1000 * 60 * 60 * 24));
  if (Number.isNaN(daysLeft)) return null;

  let label: string;
  let tone: "plenty" | "soon" | "expired";
  if (daysLeft <= 0) {
    label = "Link expired — reshare or recreate the card";
    tone = "expired";
  } else if (daysLeft <= 7) {
    label = `Link expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — share soon`;
    tone = "soon";
  } else {
    label = `Link expires in ${daysLeft} days`;
    tone = "plenty";
  }
  return (
    <View style={[expiryStyles.chip, expiryStyles[`${tone}Chip`]]}>
      <Text style={[expiryStyles.text, expiryStyles[`${tone}Text`]]}>{label}</Text>
    </View>
  );
}

const expiryStyles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    borderRadius: 8,
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  text: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  plentyChip: { backgroundColor: "rgba(155,175,155,0.18)" },
  plentyText: { color: "#3F5239" },
  soonChip: { backgroundColor: "rgba(217,180,110,0.24)" },
  soonText: { color: "#76561F" },
  expiredChip: { backgroundColor: "rgba(184,72,58,0.18)" },
  expiredText: { color: "#7B2D24" },
});

function statusKicker(postcard: Postcard): string {
  // v0.7.0.59: granular Lob state when the narrowed status is "sent".
  // Lob's webhook flips lob_status through several phases between accept
  // and delivery; surfacing them gives users live visibility instead of
  // a single "ON ITS WAY" for the entire week.
  if (postcard.status === "sent") {
    switch (postcard.lobStatus) {
      case "in_production":
        return "PRINTING";
      case "mailed":
        return "MAILED";
      case "in_transit":
        return "IN TRANSIT";
      case "processed_for_delivery":
        return "AT THEIR POST OFFICE";
      case "re-routed":
        return "RE-ROUTING";
      case "returned_to_sender":
        return "RETURNED TO SENDER";
      case "received":
      default:
        // null lob_status = pre-Lob queue. Anything else = "ON ITS WAY".
        return postcard.lobId ? "ON ITS WAY" : "QUEUED FOR PRINT";
    }
  }
  switch (postcard.status) {
    case "delivered":
      return "DELIVERED";
    case "draft":
      return "DRAFT";
    case "awaiting_address":
      return "WAITING FOR THEIR ADDRESS";
    case "expired":
      return "ADDRESS LINK EXPIRED";
    case "cancelled":
      return "CANCELLED — CREDIT REFUNDED";
    default:
      return "";
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
    alignItems: "center",
    justifyContent: "center",
  },
  cardPhotoHint: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    opacity: 0.7,
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
  // v0.7.0.49: rendered when postcard.lobError is present. Smaller +
  // italicized so it reads as detail, not as the primary failure copy.
  orphanReason: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 12,
    marginTop: -4,
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
  headerCancelBtn: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    paddingVertical: 2,
  },
  headerCancelBtnText: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
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
