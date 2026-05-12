import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera, Edit3, Image as ImageIcon, Send, RotateCw } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { PrimaryButton } from "@/src/components/Buttons";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { FlipCard, FlipCardHandle } from "@/src/components/FlipCard";
import { Header } from "@/src/components/Header";
import { MessageEditorSheet } from "@/src/components/MessageEditorSheet";
import { PostcardBackPreview, PostcardFrontPreview } from "@/src/components/PostcardPreview";
import {
  AddressDraft,
  EMPTY_ADDRESS,
  isAddressComplete,
  RecipientMode,
  RecipientPicker,
} from "@/src/components/RecipientPicker";
import { SuccessModal } from "@/src/components/SuccessModal";
import { CARD_COST_PHOTO } from "@/src/data/credits";
import { capturePostcardForPrint, lobRenderDimensions, submitToLob } from "@/src/services/lob";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Send screen — the MVP "photo + note on the back" flow.
 *
 * Architecture:
 *   • Big flippable postcard preview at the top. Tap to flip.
 *   • Two action buttons: "Photo" opens the library; "Note" opens the
 *     message editor sheet. Each auto-flips the card to the relevant face.
 *   • Recipient picker has three modes: friend / ask (send-a-link) / address.
 *   • Send button at the bottom shows the cost (1 credit) and dispatches the
 *     right action based on the recipient mode.
 *
 * Lob capture happens off-screen at 1875px wide after a successful direct
 * send. The send-a-link flow defers Lob capture until the recipient claims.
 */

const PREVIEW_WIDTH = 320;

export default function SendScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ friendId?: string; mode?: string }>();
  const {
    friends,
    credits,
    currentUser,
    sendPostcard,
    sendPostcardViaLink,
    addFriendByAddress,
  } = useMailClub();

  // -- Compose state ------------------------------------------------------
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  // -- Recipient state ----------------------------------------------------
  const [mode, setMode] = useState<RecipientMode>("friend");
  const [friendIndex, setFriendIndex] = useState(0);
  const [address, setAddress] = useState<AddressDraft>(EMPTY_ADDRESS);

  // -- Send + modal state -------------------------------------------------
  const [sending, setSending] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [success, setSuccess] = useState({ visible: false, title: "", subtitle: "" });
  const [seededFriend, setSeededFriend] = useState<string | undefined>(undefined);

  // -- Refs ---------------------------------------------------------------
  const flipRef = useRef<FlipCardHandle>(null);
  const printFrontRef = useRef<View>(null);
  const printBackRef = useRef<View>(null);
  // Synchronous lock against double-tap. React state (`sending`) only
  // flips after the next render, so two taps within the same event-loop
  // tick could both pass `if (sending) return`. A useRef latch flips
  // synchronously and is the authoritative gate.
  const sendingLockRef = useRef(false);
  const { width: PRINT_W } = lobRenderDimensions();

  // Seed recipient from ?friendId=... when navigated from a friend sheet
  useEffect(() => {
    const friendParam = params?.friendId as string | undefined;
    if (!friendParam || seededFriend === friendParam) return;
    const idx = friends.findIndex((f) => f.id === friendParam);
    if (idx >= 0) {
      setFriendIndex(idx);
      setMode("friend");
    }
    setSeededFriend(friendParam);
  }, [params?.friendId, friends, seededFriend]);

  // Seed recipient mode from ?mode=... when navigated from a "Send your first
  // card" prompt on an empty Friends rolodex. Bypasses the "No friends yet"
  // state inside the picker and lands the user on the right tab immediately.
  // (codex P2, Phase 2 review.)
  useEffect(() => {
    const m = params?.mode as RecipientMode | undefined;
    if (m === "link" || m === "address" || m === "friend") {
      setMode(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.mode]);

  const friend = useMemo(
    () => (friends.length ? friends[Math.min(friendIndex, friends.length - 1)] : null),
    [friends, friendIndex],
  );

  // Address kind: friends mode → friend address; address mode → typed; link → recipient-supplied
  const recipientForPreview = useMemo(() => {
    if (mode === "address") {
      return {
        name: address.name || "Recipient",
        city: address.city,
        state: address.state,
        addressLine1: address.line1,
        addressLine2: address.line2,
        zip: address.zip,
      };
    }
    if (mode === "link") {
      return { name: "Awaiting address...", city: "", state: "" };
    }
    if (friend) {
      return {
        name: friend.name,
        city: friend.addressCity || friend.city,
        state: friend.addressState || friend.state,
        addressLine1: friend.addressLine1,
        addressLine2: friend.addressLine2,
        zip: friend.addressZip,
      };
    }
    return { name: "", city: "", state: "" };
  }, [mode, address, friend]);

  // -- Actions ------------------------------------------------------------

  async function openPhotoPicker() {
    // expo-image-picker defaults to the photo library — that's exactly what we
    // want for MVP. Camera-first felt wrong: people want to send saved photos.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Photo access needed",
        "Mailroom needs photo access to attach an image to your postcard. You can enable this in Settings.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      // Postcards are 3:2 aspect; cropping to match avoids surprises in print.
      aspect: [3, 2],
      quality: 0.92,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setPhotoUri(result.assets[0].uri);
      // Flip back to front so they see the photo land on the card
      flipRef.current?.flipTo("front");
    }
  }

  function openMessageEditor() {
    flipRef.current?.flipTo("back");
    setEditorOpen(true);
  }

  // -- Validation ---------------------------------------------------------

  function validate(): { ok: true } | { ok: false; reason: string } {
    if (!photoUri) return { ok: false, reason: "Pick a photo for the front first." };
    if (message.trim().length === 0) return { ok: false, reason: "Write a quick note on the back." };
    if (credits < CARD_COST_PHOTO) return { ok: false, reason: "You're out of credits. Tap to buy more." };

    if (mode === "friend") {
      if (!friend) return { ok: false, reason: "Pick a friend to send to, or use Ask / Address." };
      if (!friend.addressLine1) {
        return {
          ok: false,
          reason: `We don't have ${friend.name}'s mailing address. Switch to "Ask" to request it.`,
        };
      }
    }
    if (mode === "address" && !isAddressComplete(address)) {
      return { ok: false, reason: "Fill in the full mailing address (street, city, state, ZIP)." };
    }
    return { ok: true };
  }

  // -- Send ---------------------------------------------------------------

  async function onSend() {
    // Synchronous lock first — defeats the double-tap race where two presses
    // in one event-loop tick both observe `sending === false` because React
    // hasn't committed the next render yet.
    if (sendingLockRef.current || sending) return;
    sendingLockRef.current = true;
    const v = validate();
    if (!v.ok) {
      sendingLockRef.current = false;
      if (v.reason.includes("out of credits")) {
        setCreditsOpen(true);
        return;
      }
      Alert.alert("Not quite ready", v.reason);
      return;
    }
    setSending(true);
    try {
      if (mode === "link") {
        const result = await sendPostcardViaLink({
          category: "photo",
          message,
          photoUri: photoUri ?? undefined,
        });
        if (!result.ok || !result.claimUrl) {
          Alert.alert("Couldn't generate link", result.error ?? "Try again in a moment.");
          return;
        }
        const senderFirst = (currentUser.name || "Someone").split(" ")[0];
        const shareMsg = `${senderFirst} sent you a postcard via Mailroom. Open this link to share your address so we can deliver it:\n\n${result.claimUrl}`;
        try {
          await Share.share({ message: shareMsg, url: result.claimUrl });
        } catch {
          // user dismissed the share sheet — link is still valid
        }
        setSuccess({
          visible: true,
          title: "Link sent.",
          subtitle:
            "When they tap the link and share their address, we'll print and ship your postcard. You'll get a notification when it's on its way.",
        });
        resetCompose();
        return;
      }

      // For "address" mode, we silently create a friend first, then send to them.
      // This means subsequent sends to the same person have the address saved.
      let targetFriendId: string;
      let targetName: string;
      if (mode === "address") {
        const result = await addFriendByAddress({
          name: address.name,
          city: address.city,
          state: address.state,
          addressLine1: address.line1,
          addressLine2: address.line2,
          addressCity: address.city,
          addressState: address.state,
          addressZip: address.zip,
          addressCountry: "US",
        });
        if (!result.ok || !result.friend) {
          Alert.alert("Couldn't save address", "Try again in a moment.");
          return;
        }
        targetFriendId = result.friend.id;
        targetName = result.friend.name;
      } else {
        if (!friend) return;
        targetFriendId = friend.id;
        targetName = friend.name;
      }

      const result = await sendPostcard({
        kind: "photo",
        friendId: targetFriendId,
        photoUri: photoUri ?? "",
        message,
      });
      if (!result.ok) return;

      setSuccess({
        visible: true,
        title: `Your postcard is on the way!`,
        subtitle: `Heading to ${targetName} via USPS First Class Mail. It should arrive in about 1–2 weeks.`,
      });

      // Fire-and-forget Lob capture/upload. Capturing the off-screen 1875px
      // PNGs + uploading can take a few seconds, so we don't block the
      // success modal. If it fails, the server-side webhook handles retries.
      if (result.postcardId) {
        submitPostcardToLob(result.postcardId).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("Lob submission failed (will retry server-side):", err);
        });
      }

      resetCompose();
    } finally {
      setSending(false);
      sendingLockRef.current = false;
    }
  }

  async function submitPostcardToLob(postcardId: string): Promise<void> {
    // Give the print-scale views a beat to mount + layout before capture.
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!printFrontRef.current || !printBackRef.current) {
      throw new Error("Print-scale postcard views not mounted");
    }
    const captured = await capturePostcardForPrint(printFrontRef, printBackRef);
    const result = await submitToLob({
      postcardId,
      frontUri: captured.frontUri,
      backUri: captured.backUri,
    });
    if (!result.ok) throw new Error(result.error);
    // eslint-disable-next-line no-console
    console.log("Lob submission ok", result.lobId);
  }

  function resetCompose() {
    setPhotoUri(null);
    setMessage("");
    setAddress(EMPTY_ADDRESS);
    flipRef.current?.flipTo("front");
  }

  // -- Render -------------------------------------------------------------

  const cantAfford = credits < CARD_COST_PHOTO;

  const sendLabel = sending
    ? "Sending..."
    : mode === "link"
      ? "Share a link"
      : cantAfford
        ? "Buy credits"
        : "Send postcard";

  return (
    <AppShell>
      <Header title="Send Mail" />

      <View style={styles.previewBlock}>
        <FlipCard
          ref={flipRef}
          testID="postcard-flip"
          style={styles.flipWrap}
          front={
            <View style={styles.faceWrap}>
              <PostcardFrontPreview
                photoUri={photoUri ?? undefined}
                width={PREVIEW_WIDTH}
                testID="preview-front"
              />
              {!photoUri ? (
                <View style={styles.frontHint} pointerEvents="none">
                  <Camera color={colors.mutedInk} size={28} strokeWidth={1.6} />
                  <Text style={styles.frontHintText}>Tap the Photo button to choose one</Text>
                </View>
              ) : null}
            </View>
          }
          back={
            <View style={styles.faceWrap}>
              <PostcardBackPreview
                message={message || "Tap the Note button below to write your message..."}
                recipient={recipientForPreview}
                sender={{
                  name: currentUser.name || "You",
                  city: currentUser.city || "",
                  state: currentUser.state || "",
                }}
                width={PREVIEW_WIDTH}
                testID="preview-back"
              />
            </View>
          }
        />
        <View style={styles.flipBadgeRow}>
          <RotateCw color={colors.mutedInk} size={13} strokeWidth={1.8} />
          <Text style={styles.flipBadgeText}>Tap the card to flip</Text>
        </View>
      </View>

      <View style={styles.composeRow}>
        <Pressable
          onPress={openPhotoPicker}
          style={[styles.composeBtn, photoUri && styles.composeBtnFilled]}
          testID="compose-photo-btn"
          accessibilityRole="button"
          accessibilityLabel="Choose a photo"
        >
          <ImageIcon color={photoUri ? colors.white : colors.ink} size={20} strokeWidth={1.7} />
          <Text style={[styles.composeBtnText, photoUri && styles.composeBtnTextFilled]}>
            {photoUri ? "Change photo" : "Photo"}
          </Text>
        </Pressable>
        <Pressable
          onPress={openMessageEditor}
          style={[styles.composeBtn, message.trim() && styles.composeBtnFilled]}
          testID="compose-note-btn"
          accessibilityRole="button"
          accessibilityLabel="Write a note"
        >
          <Edit3 color={message.trim() ? colors.white : colors.ink} size={20} strokeWidth={1.7} />
          <Text style={[styles.composeBtnText, message.trim() && styles.composeBtnTextFilled]}>
            {message.trim() ? "Edit note" : "Note"}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.toHeading}>To</Text>
      <RecipientPicker
        mode={mode}
        onModeChange={setMode}
        friends={friends}
        friendIndex={friendIndex}
        onFriendIndexChange={setFriendIndex}
        address={address}
        onAddressChange={setAddress}
        onAddFriend={() => router.push("/friends")}
      />

      <View style={styles.sendRow}>
        <View style={styles.priceCol}>
          <Text style={styles.priceMain} numberOfLines={1}>1 stamp</Text>
          <Text style={styles.priceMeta} numberOfLines={1}>You have {credits}</Text>
          {cantAfford ? (
            <Pressable onPress={() => setCreditsOpen(true)} testID="send-buy-more">
              <Text style={styles.buyMore}>Buy more</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.sendBtnCol}>
          <PrimaryButton
            title={sendLabel}
            icon={Send}
            onPress={cantAfford ? () => setCreditsOpen(true) : onSend}
            disabled={sending}
          />
        </View>
      </View>

      <MessageEditorSheet
        visible={editorOpen}
        initial={message}
        onSave={(msg) => {
          setMessage(msg);
          setEditorOpen(false);
        }}
        onCancel={() => setEditorOpen(false)}
      />

      <SuccessModal
        visible={success.visible}
        title={success.title}
        subtitle={success.subtitle}
        onClose={() => setSuccess({ visible: false, title: "", subtitle: "" })}
      />

      <CreditsSheet visible={creditsOpen} onClose={() => setCreditsOpen(false)} />

      {/*
        Off-screen 1875×1250 renders for Lob capture. We position these way
        off-screen so they don't appear in the UI but DO mount + layout +
        paint — which is what react-native-view-shot needs.

        Don't use display:none or opacity:0 here; view-shot captures those as
        blank. The `left: -10000` trick keeps the view rendered.
      */}
      <View
        style={styles.offscreen}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <PostcardFrontPreview
          ref={printFrontRef}
          photoUri={photoUri ?? undefined}
          width={PRINT_W}
        />
        <PostcardBackPreview
          ref={printBackRef}
          message={message}
          recipient={recipientForPreview}
          sender={{
            name: currentUser.name || "You",
            city: currentUser.city || "",
            state: currentUser.state || "",
          }}
          width={PRINT_W}
        />
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  previewBlock: { alignItems: "center", gap: 6, marginTop: 6 },
  flipWrap: { height: PREVIEW_WIDTH / 1.5, width: PREVIEW_WIDTH },
  faceWrap: { alignItems: "center", justifyContent: "center" },
  frontHint: { alignItems: "center", backgroundColor: "rgba(245, 240, 230, 0.92)", borderRadius: 12, gap: 6, paddingHorizontal: 18, paddingVertical: 14, position: "absolute" },
  frontHintText: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, textAlign: "center" },
  flipBadgeRow: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 4 },
  flipBadgeText: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 1.1, textTransform: "uppercase" },

  composeRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  composeBtn: { alignItems: "center", borderColor: colors.ink, borderRadius: 10, borderWidth: 1.2, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 12 },
  composeBtnFilled: { backgroundColor: colors.ink, borderColor: colors.ink },
  composeBtnText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
  composeBtnTextFilled: { color: colors.white },

  toHeading: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22, marginBottom: -6, marginTop: 8 },

  sendRow: { alignItems: "center", flexDirection: "row", gap: 14, marginTop: 16 },
  // v0.5.0: stack "1 stamp" over "You have N" so the row never wraps on
  // narrow phones or with double-digit balances. Previously the two pieces
  // ran inline with separator " · " and clipped awkwardly.
  priceCol: { flexShrink: 1, minWidth: 90 },
  sendBtnCol: { flex: 1 },
  priceMain: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 18, lineHeight: 22 },
  priceMeta: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 16 },
  buyMore: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 13, marginTop: 2, textDecorationLine: "underline" },

  offscreen: { left: -10000, position: "absolute", top: -10000 },
});
