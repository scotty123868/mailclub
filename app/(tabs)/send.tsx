import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { ArrowLeft, ArrowRight, Camera, Check, Link as LinkIcon, MapPin, Send } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { PrimaryButton } from "@/src/components/Buttons";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { Header } from "@/src/components/Header";
import { MessageEditorSheet } from "@/src/components/MessageEditorSheet";
import { PostcardBackPreview, PostcardFrontPreview } from "@/src/components/PostcardPreview";
import {
  AddressDraft,
  EMPTY_ADDRESS,
  isAddressComplete,
} from "@/src/types/address";
import { createReciprocationToken } from "@/src/services/api";
import { SuccessModal } from "@/src/components/SuccessModal";
import { CARD_COST_PHOTO } from "@/src/data/credits";
import { capturePostcardForPrint, lobRenderDimensions, submitToLob } from "@/src/services/lob";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts, type } from "@/src/theme/typography";
import type { Friend } from "@/src/types/mail";

/**
 * Send screen — v0.5.0 multi-step flow (gallery decision).
 *
 * Four sequential pages, one decision per page:
 *   1. Cover         — pick your photo
 *   2. Inside        — write your note
 *   3. Recipient     — who's it for? (name + inline friend match)
 *   4. Delivery      — how does it get to them? (magic link default)
 *
 * Step state lives in this component (single route, internal step machine).
 * Back navigates one step, or exits to the previous tab on step 1.
 *
 * Lob capture happens off-screen at 1875px wide after a successful direct
 * send, just like before. The send-via-link flow still defers Lob capture
 * until the recipient claims via the magic link.
 */

type Step = 1 | 2 | 3 | 4;
// "self" delivery (send to your own address) is deferred to 0.5.1 — needs
// proper user address storage on CurrentUser, which we don't have yet.
type DeliveryMode = "friend" | "link" | "address";

type PrintRecipient = {
  name: string;
  city: string;
  state: string;
  addressLine1?: string;
  addressLine2?: string;
  zip?: string;
};
type PrintSnapshot = {
  photoUri: string;
  message: string;
  recipient: PrintRecipient;
  sender: { name: string; city: string; state: string };
  /**
   * URL encoded into the QR on the back, minted right after sendPostcard
   * returns the postcardId. Lives on the snapshot (not live state) so the
   * offscreen Lob views capture the QR even if the user dismisses success
   * and starts a new compose. Optional because token minting can fail
   * gracefully (printed card without QR is still a card).
   */
  reciprocationUrl?: string;
};

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

  // -- Step machine -------------------------------------------------------
  const [step, setStep] = useState<Step>(1);

  // -- Compose state ------------------------------------------------------
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  // -- Recipient state ----------------------------------------------------
  // The user types a name on step 3. If it matches a friend in the rolodex,
  // we surface the match and let them tap to lock the friend reference.
  const [recipientName, setRecipientName] = useState("");
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);

  // -- Delivery state -----------------------------------------------------
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("link");
  const [address, setAddress] = useState<AddressDraft>(EMPTY_ADDRESS);

  // -- Send + modal state -------------------------------------------------
  const [sending, setSending] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [success, setSuccess] = useState({ visible: false, title: "", subtitle: "" });
  const [seededFriend, setSeededFriend] = useState<string | undefined>(undefined);

  // Print snapshot: the photo/message/recipient frozen at the moment of send.
  // The offscreen Lob print views read from this if present, falling back to
  // live compose state. This decouples Lob's async capture from the user
  // starting a new postcard. (codex P1, Phase 2.6 review: without this,
  // `resetCompose()` in submitPostcardToLob's .finally could wipe the next
  // postcard's state mid-edit.)
  const [printSnapshot, setPrintSnapshot] = useState<PrintSnapshot | null>(null);

  // -- Refs ---------------------------------------------------------------
  const printFrontRef = useRef<View>(null);
  const printBackRef = useRef<View>(null);
  // Synchronous lock against double-tap on the final Send button. React
  // state (`sending`) only flips after the next render, so two presses in
  // the same event-loop tick could both pass the gate. A useRef latch is
  // the authoritative double-press defender.
  const sendingLockRef = useRef(false);
  const { width: PRINT_W } = lobRenderDimensions();

  // -- Param seeding ------------------------------------------------------

  // Seed recipient from ?friendId=... when navigated from a friend sheet.
  // Pre-fills the name + selectedFriendId AND jumps to step 4 so the user
  // doesn't have to walk through cover/inside/recipient just to pick a
  // friend they already chose. They still pick a photo + write a note,
  // but on their next pass the flow starts at delivery for that friend.
  // (codex P1: comment now matches behavior — setStep(4) is called.)
  useEffect(() => {
    const friendParam = params?.friendId as string | undefined;
    if (!friendParam || seededFriend === friendParam) return;
    const friend = friends.find((f) => f.id === friendParam);
    if (friend) {
      setSelectedFriendId(friend.id);
      setRecipientName(friend.name);
      setDeliveryMode(friend.addressLine1 ? "friend" : "link");
      // Only jump to step 4 if the user already has a photo + message
      // queued; otherwise let them assemble the card first.
      if (photoUri && message.trim().length > 0) {
        setStep(4);
      }
    }
    setSeededFriend(friendParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.friendId, friends, seededFriend]);

  // Seed delivery mode from ?mode=... — used by the empty-rolodex
  // "Send your first card" CTA on the Friends tab to bias toward link mode.
  useEffect(() => {
    const m = params?.mode as DeliveryMode | undefined;
    if (m === "link" || m === "address" || m === "friend") {
      setDeliveryMode(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.mode]);

  // -- Derived values -----------------------------------------------------

  const selectedFriend: Friend | null = useMemo(() => {
    if (!selectedFriendId) return null;
    return friends.find((f) => f.id === selectedFriendId) ?? null;
  }, [friends, selectedFriendId]);

  // Friends matching the typed recipient name. Case-insensitive prefix and
  // substring match. Top 5 results. Hidden once the user locks a specific
  // friend by tapping a result row (then we show a single confirmation row).
  const friendMatches: Friend[] = useMemo(() => {
    const q = recipientName.trim().toLowerCase();
    if (!q) return [];
    return friends
      .filter((f) => f.name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [recipientName, friends]);

  // Recipient block used by both the BackPreview and the off-screen Lob
  // capture. Always reflects the latest source-of-truth: locked friend's
  // address if present, manual address if in address mode, "awaiting" copy
  // if delivery is by magic link.
  const recipientForPreview = useMemo(() => {
    if (deliveryMode === "address") {
      return {
        name: address.name || recipientName || "Recipient",
        city: address.city,
        state: address.state,
        addressLine1: address.line1,
        addressLine2: address.line2,
        zip: address.zip,
      };
    }
    if (deliveryMode === "link") {
      return { name: recipientName || "Awaiting address...", city: "", state: "" };
    }
    if (selectedFriend) {
      return {
        name: selectedFriend.name,
        city: selectedFriend.addressCity || selectedFriend.city,
        state: selectedFriend.addressState || selectedFriend.state,
        addressLine1: selectedFriend.addressLine1,
        addressLine2: selectedFriend.addressLine2,
        zip: selectedFriend.addressZip,
      };
    }
    return { name: recipientName || "", city: "", state: "" };
  }, [deliveryMode, address, selectedFriend, recipientName, currentUser]);

  // -- Photo picker -------------------------------------------------------

  async function openPhotoPicker() {
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
    }
  }

  // -- Step navigation ----------------------------------------------------

  function canAdvance(): { ok: true } | { ok: false; reason?: string } {
    if (step === 1) {
      return photoUri
        ? { ok: true }
        : { ok: false, reason: "Pick a photo first to keep moving." };
    }
    if (step === 2) {
      return message.trim().length > 0
        ? { ok: true }
        : { ok: false, reason: "Write a quick note for the back." };
    }
    if (step === 3) {
      return recipientName.trim().length > 0
        ? { ok: true }
        : { ok: false, reason: "Type a name so we know who it's for." };
    }
    return { ok: true };
  }

  function goBack() {
    if (step > 1) {
      setStep((step - 1) as Step);
    } else {
      router.back();
    }
  }

  function goNext() {
    const v = canAdvance();
    if (!v.ok) {
      if (v.reason) Alert.alert("Not quite ready", v.reason);
      return;
    }
    if (step < 4) {
      const next = (step + 1) as Step;
      setStep(next);
      // When advancing to step 4 with a locked friend who has an address,
      // default to "friend" delivery (their saved address). Otherwise default
      // to "link" so the user doesn't have to type an address they don't have.
      if (next === 4 && selectedFriend?.addressLine1) {
        setDeliveryMode("friend");
      } else if (next === 4 && deliveryMode === "friend") {
        // The previously-selected friend has no address; flip to link as the
        // sensible default rather than leaving them on a broken option.
        setDeliveryMode("link");
      }
    } else {
      onSend();
    }
  }

  function lockFriend(friend: Friend) {
    setSelectedFriendId(friend.id);
    setRecipientName(friend.name);
  }

  function unlockFriend() {
    setSelectedFriendId(null);
  }

  // -- Send ---------------------------------------------------------------

  async function onSend() {
    if (sendingLockRef.current || sending) return;
    sendingLockRef.current = true;

    if (credits < CARD_COST_PHOTO) {
      sendingLockRef.current = false;
      setCreditsOpen(true);
      return;
    }

    // Delivery-mode-specific gate before we kick off the network round-trip.
    // codex P1: validate against the RESOLVED address (name falls back to
    // recipientName) — otherwise an "address-mode" send with a name from
    // step 3 but no separate edit in step 4 would falsely fail validation.
    if (deliveryMode === "address") {
      const resolved: AddressDraft = {
        ...address,
        name: address.name || recipientName,
      };
      if (!isAddressComplete(resolved)) {
        sendingLockRef.current = false;
        Alert.alert("Address incomplete", "Fill in name, street, city, state, and ZIP before sending.");
        return;
      }
    }
    if (deliveryMode === "friend" && !selectedFriend?.addressLine1) {
      sendingLockRef.current = false;
      Alert.alert(
        "No address on file",
        `We don't have a mailing address for ${selectedFriend?.name || "this friend"}. Pick "Magic link" or "I have their address" instead.`,
      );
      return;
    }

    setSending(true);
    try {
      if (deliveryMode === "link") {
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
        const recipientFirst = recipientName.trim().split(" ")[0] || "your friend";
        const shareMsg = `Hi ${recipientFirst}, ${senderFirst} sent you a postcard via Mailroom. Open this link to share your address so we can deliver it:\n\n${result.claimUrl}`;
        try {
          await Share.share({ message: shareMsg, url: result.claimUrl });
        } catch {
          // user dismissed share sheet — link is still valid
        }
        setSuccess({
          visible: true,
          title: "Link sent.",
          subtitle:
            `When ${recipientFirst} taps the link and shares their address, we'll print and ship your postcard. You'll get a notification when it's on its way.`,
        });
        resetCompose();
        return;
      }

      // For "address" mode: silently create the friend first, then send.
      // For "self" mode: addr is the current user's address (we'd already
      // have it from onboarding; otherwise fall through to address flow).
      // codex Phase 6 P1: pass the just-created friend object explicitly
      // to sendPostcard so the action doesn't rely on a stale `friends`
      // closure that doesn't yet include this friend.
      let targetFriendId: string;
      let targetName: string;
      let targetFriend: import("@/src/types/mail").Friend | null = null;
      if (deliveryMode === "address") {
        const result = await addFriendByAddress({
          name: address.name || recipientName,
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
        targetFriend = result.friend;
      } else {
        if (!selectedFriend) return;
        targetFriendId = selectedFriend.id;
        targetName = selectedFriend.name;
        targetFriend = selectedFriend;
      }

      const result = await sendPostcard({
        kind: "photo",
        friendId: targetFriendId,
        photoUri: photoUri ?? "",
        message,
        friend: targetFriend ?? undefined,
      });
      if (!result.ok) return;

      // Mint a reciprocation token for the QR on the back. Best-effort —
      // if the migration hasn't been deployed yet or the RPC fails, we
      // ship the postcard without the QR rather than blocking the send.
      // (Phase 3.)
      let reciprocationUrl: string | undefined;
      if (result.postcardId) {
        try {
          const tk = await createReciprocationToken(result.postcardId);
          reciprocationUrl = tk.url;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("Couldn't mint reciprocation token (printing without QR):", err);
        }
      }

      setSuccess({
        visible: true,
        title: `Your postcard is on the way!`,
        subtitle: `Heading to ${targetName} via USPS First Class Mail. It should arrive in about 1–2 weeks.`,
      });

      // Freeze the print inputs into a snapshot BEFORE we reset compose
      // state. The offscreen Lob views render from `printSnapshot` if set,
      // so capture works on stable frozen data even if the user dismisses
      // the success modal and starts a new postcard mid-flight.
      // (codex P1, Phase 2.6 review.) Also carries the reciprocation URL
      // so the QR renders into the Lob-captured back PNG.
      setPrintSnapshot({
        photoUri: photoUri ?? "",
        message,
        recipient: recipientForPreview,
        sender: {
          name: currentUser.name || "You",
          city: currentUser.city || "",
          state: currentUser.state || "",
        },
        reciprocationUrl,
      });

      if (result.postcardId) {
        submitPostcardToLob(result.postcardId)
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn("Lob submission failed (will retry server-side):", err);
          })
          .finally(() => {
            // Snapshot served its purpose — release it so the offscreen
            // views go back to mirroring live compose state.
            setPrintSnapshot(null);
          });
      }

      // Safe to reset immediately. The success modal overlays the screen,
      // so the user doesn't see the compose blanks. The printSnapshot above
      // is what Lob captures against.
      resetCompose();
    } finally {
      setSending(false);
      sendingLockRef.current = false;
    }
  }

  async function submitPostcardToLob(postcardId: string): Promise<void> {
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
    setRecipientName("");
    setSelectedFriendId(null);
    setAddress(EMPTY_ADDRESS);
    setDeliveryMode("link");
    setStep(1);
  }

  // -- Render -------------------------------------------------------------

  const cantAfford = credits < CARD_COST_PHOTO;
  // codex P2: distinguish "Send postcard" (we print + mail today) from
  // "Share a link" (the recipient claims it before we print). Same Lob spend
  // either way, but the immediate action is different so the button label
  // should match.
  const finalCtaLabel = sending
    ? "Sending..."
    : cantAfford
      ? "Buy stamps"
      : deliveryMode === "link"
        ? "Share a link"
        : "Send postcard";
  const continueLabel = step < 4 ? "Continue" : finalCtaLabel;

  return (
    <AppShell>
      <Header title="Send" />

      <StepHeader step={step} onBack={goBack} />

      {step === 1 && (
        <CoverStep
          photoUri={photoUri}
          onPickPhoto={openPhotoPicker}
          testID="send-step-1"
        />
      )}

      {step === 2 && (
        <InsideStep
          message={message}
          recipientForPreview={recipientForPreview}
          sender={{
            name: currentUser.name || "You",
            city: currentUser.city || "",
            state: currentUser.state || "",
          }}
          onOpenEditor={() => setEditorOpen(true)}
          testID="send-step-2"
        />
      )}

      {step === 3 && (
        <RecipientStep
          name={recipientName}
          onNameChange={(t) => {
            setRecipientName(t);
            // Clear locked friend if the user edits the name away
            if (selectedFriend && t.trim().toLowerCase() !== selectedFriend.name.toLowerCase()) {
              unlockFriend();
            }
          }}
          matches={friendMatches}
          locked={selectedFriend}
          onLockFriend={lockFriend}
          onUnlockFriend={unlockFriend}
          testID="send-step-3"
        />
      )}

      {step === 4 && (
        <DeliveryStep
          recipientName={recipientName}
          selectedFriend={selectedFriend}
          deliveryMode={deliveryMode}
          onModeChange={setDeliveryMode}
          address={address}
          onAddressChange={setAddress}
          testID="send-step-4"
        />
      )}

      <View style={styles.actionRow}>
        <Pressable
          onPress={goBack}
          style={styles.backBtn}
          testID="send-back-btn"
          accessibilityRole="button"
          accessibilityLabel={step === 1 ? "Cancel" : "Go back"}
        >
          <ArrowLeft color={colors.ink} size={18} strokeWidth={1.8} />
          <Text style={styles.backBtnText}>{step === 1 ? "Cancel" : "Back"}</Text>
        </Pressable>

        {step === 4 ? (
          <View style={styles.sendCol}>
            <Text style={styles.priceMain} numberOfLines={1}>1 stamp</Text>
            <Text style={styles.priceMeta} numberOfLines={1}>You have {credits}</Text>
            <PrimaryButton
              title={continueLabel}
              icon={Send}
              onPress={cantAfford ? () => setCreditsOpen(true) : onSend}
              disabled={sending}
              style={styles.sendBtn}
            />
          </View>
        ) : (
          <PrimaryButton
            title={continueLabel}
            icon={ArrowRight}
            onPress={goNext}
            style={styles.continueBtn}
            testID="send-continue-btn"
          />
        )}
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
        Off-screen 1875×1250 renders for Lob capture. Positioned way
        off-screen but mounted so layout + paint complete, which is what
        react-native-view-shot needs.

        Renders from `printSnapshot` if set (frozen at send time) — that's
        the source of truth during the async Lob capture. Falls back to
        live compose state when no send is in flight, so the offscreen
        views stay warm and ready (laid out, painted, ref-able).
      */}
      <View
        style={styles.offscreen}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <PostcardFrontPreview
          ref={printFrontRef}
          photoUri={printSnapshot?.photoUri || photoUri || undefined}
          width={PRINT_W}
        />
        <PostcardBackPreview
          ref={printBackRef}
          message={printSnapshot?.message ?? message}
          recipient={printSnapshot?.recipient ?? recipientForPreview}
          sender={
            printSnapshot?.sender ?? {
              name: currentUser.name || "You",
              city: currentUser.city || "",
              state: currentUser.state || "",
            }
          }
          width={PRINT_W}
          reciprocationUrl={printSnapshot?.reciprocationUrl}
        />
      </View>
    </AppShell>
  );
}

// =============================================================================
// STEP HEADER  (progress dots + back affordance is rendered separately)
// =============================================================================

function StepHeader({ step, onBack: _onBack }: { step: Step; onBack: () => void }) {
  const labels = ["Cover", "Inside", "Recipient", "Delivery"];
  return (
    <View style={stepHeaderStyles.row} testID={`send-step-header-${step}`}>
      <Text style={stepHeaderStyles.crumb}>
        Step {step} of 4 · <Text style={stepHeaderStyles.crumbActive}>{labels[step - 1]}</Text>
      </Text>
      <View style={stepHeaderStyles.dotsRow}>
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={[
              stepHeaderStyles.dot,
              i === step && stepHeaderStyles.dotActive,
              i < step && stepHeaderStyles.dotComplete,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const stepHeaderStyles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  crumb: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13 },
  crumbActive: { color: colors.ink, fontFamily: fonts.serifSemi, fontStyle: "normal" },
  dotsRow: { flexDirection: "row", gap: 6 },
  dot: { backgroundColor: colors.line, borderRadius: 4, height: 7, width: 7 },
  dotActive: { backgroundColor: colors.ink, width: 22 },
  dotComplete: { backgroundColor: colors.postalBlue },
});

// =============================================================================
// STEP 1 — COVER (pick your photo)
// =============================================================================

function CoverStep({
  photoUri,
  onPickPhoto,
  testID,
}: {
  photoUri: string | null;
  onPickPhoto: () => void;
  testID?: string;
}) {
  return (
    <View style={stepStyles.wrap} testID={testID}>
      <Text style={stepStyles.title}>Pick your photo</Text>
      <Text style={stepStyles.subtitle}>Tonight's dinner. Last weekend. The dog. Any photo works.</Text>

      <Pressable
        onPress={onPickPhoto}
        style={({ pressed }) => [coverStyles.target, pressed && coverStyles.targetPressed]}
        testID="send-photo-target"
        accessibilityRole="button"
        accessibilityLabel={photoUri ? "Change photo" : "Choose a photo"}
      >
        {photoUri ? (
          <PostcardFrontPreview photoUri={photoUri} width={300} testID="preview-front" />
        ) : (
          <View style={coverStyles.empty}>
            <Camera color={colors.mutedInk} size={36} strokeWidth={1.6} />
            <Text style={coverStyles.emptyTitle}>Tap to choose a photo</Text>
            <Text style={coverStyles.emptyHint}>Postcards print best in landscape.</Text>
          </View>
        )}
      </Pressable>

      {photoUri ? (
        <Pressable
          onPress={onPickPhoto}
          style={coverStyles.changeLink}
          testID="send-photo-change"
          accessibilityRole="button"
        >
          <Text style={coverStyles.changeLinkText}>Change photo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const coverStyles = StyleSheet.create({
  target: { alignItems: "center", marginTop: 18 },
  targetPressed: { opacity: 0.7 },
  empty: { alignItems: "center", aspectRatio: 3 / 2, backgroundColor: "rgba(245, 240, 230, 0.6)", borderColor: colors.line, borderRadius: 8, borderStyle: "dashed", borderWidth: 1.5, gap: 8, justifyContent: "center", width: 300 },
  emptyTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16 },
  emptyHint: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12 },
  changeLink: { alignSelf: "center", marginTop: 14 },
  changeLinkText: { color: colors.postalBlue, fontFamily: fonts.serifSemi, fontSize: 14, textDecorationLine: "underline" },
});

// =============================================================================
// STEP 2 — INSIDE (write the note)
// =============================================================================

function InsideStep({
  message,
  recipientForPreview,
  sender,
  onOpenEditor,
  testID,
}: {
  message: string;
  recipientForPreview: { name: string; city: string; state: string; addressLine1?: string; addressLine2?: string; zip?: string };
  sender: { name: string; city: string; state: string };
  onOpenEditor: () => void;
  testID?: string;
}) {
  return (
    <View style={stepStyles.wrap} testID={testID}>
      <Text style={stepStyles.title}>Write your note</Text>
      <Text style={stepStyles.subtitle}>Up to 300 characters. About 50 words. Brevity is the postcard's whole point.</Text>

      <Pressable
        onPress={onOpenEditor}
        style={({ pressed }) => [insideStyles.target, pressed && { opacity: 0.7 }]}
        testID="send-message-target"
        accessibilityRole="button"
        accessibilityLabel={message ? "Edit your note" : "Write your note"}
      >
        <PostcardBackPreview
          message={message || "Tap to start writing..."}
          recipient={recipientForPreview}
          sender={sender}
          width={300}
          testID="preview-back"
        />
      </Pressable>

      <Pressable
        onPress={onOpenEditor}
        style={insideStyles.editLink}
        testID="send-message-edit"
        accessibilityRole="button"
      >
        <Text style={insideStyles.editLinkText}>{message ? "Edit note" : "Write note"}</Text>
      </Pressable>
    </View>
  );
}

const insideStyles = StyleSheet.create({
  target: { alignItems: "center", marginTop: 18 },
  editLink: { alignSelf: "center", marginTop: 14 },
  editLinkText: { color: colors.postalBlue, fontFamily: fonts.serifSemi, fontSize: 14, textDecorationLine: "underline" },
});

// =============================================================================
// STEP 3 — RECIPIENT (name + friend match)
// =============================================================================

function RecipientStep({
  name,
  onNameChange,
  matches,
  locked,
  onLockFriend,
  onUnlockFriend,
  testID,
}: {
  name: string;
  onNameChange: (t: string) => void;
  matches: Friend[];
  locked: Friend | null;
  onLockFriend: (f: Friend) => void;
  onUnlockFriend: () => void;
  testID?: string;
}) {
  return (
    <View style={stepStyles.wrap} testID={testID}>
      <Text style={stepStyles.title}>Who's it for?</Text>
      <Text style={stepStyles.subtitle}>Just a name. We'll figure out delivery on the next page.</Text>

      <TextInput
        value={name}
        onChangeText={onNameChange}
        placeholder="Recipient's name"
        placeholderTextColor={colors.mutedInk}
        style={recipientStyles.input}
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
        testID="send-name-input"
      />

      {locked ? (
        <View style={recipientStyles.lockedRow} testID="send-friend-locked">
          <Check color={colors.postalBlue} size={18} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={recipientStyles.lockedName}>{locked.name}</Text>
            <Text style={recipientStyles.lockedMeta}>
              From your rolodex · {locked.addressLine1 ? `${locked.city || locked.addressCity}` : "no address on file"}
            </Text>
          </View>
          <Pressable
            onPress={onUnlockFriend}
            style={recipientStyles.unlockBtn}
            testID="send-friend-unlock"
            accessibilityRole="button"
            accessibilityLabel="Unlink this friend"
          >
            <Text style={recipientStyles.unlockText}>Clear</Text>
          </Pressable>
        </View>
      ) : matches.length > 0 ? (
        <View style={recipientStyles.matchesList}>
          <Text style={recipientStyles.matchesLabel}>FROM YOUR ROLODEX</Text>
          {matches.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => onLockFriend(m)}
              style={({ pressed }) => [recipientStyles.matchRow, pressed && { opacity: 0.7 }]}
              testID={`send-friend-match-${m.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Send to ${m.name}`}
            >
              <View style={recipientStyles.matchAvatar}>
                <Text style={recipientStyles.matchInitial}>{m.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={recipientStyles.matchName}>{m.name}</Text>
                <Text style={recipientStyles.matchMeta}>
                  {m.addressLine1 ? `${m.city || m.addressCity}` : "no address on file"}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : name.trim() ? (
        <Text style={recipientStyles.noMatchHelper}>
          No one in your rolodex by that name. That's fine — we'll send them a private link on the next page.
        </Text>
      ) : null}
    </View>
  );
}

const recipientStyles = StyleSheet.create({
  input: {
    backgroundColor: "rgba(245, 240, 230, 0.6)",
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1.2,
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 24,
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  lockedRow: { alignItems: "center", backgroundColor: "rgba(60,110,143,0.08)", borderColor: colors.postalBlue, borderRadius: 10, borderWidth: 1.2, flexDirection: "row", gap: 12, marginTop: 14, padding: 14 },
  lockedName: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17 },
  lockedMeta: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 2 },
  unlockBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  unlockText: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 13 },
  matchesList: { gap: 6, marginTop: 16 },
  matchesLabel: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  matchRow: { alignItems: "center", backgroundColor: "rgba(245, 240, 230, 0.6)", borderColor: colors.line, borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 12, padding: 12 },
  matchAvatar: { alignItems: "center", backgroundColor: colors.paper, borderColor: colors.line, borderRadius: 18, borderWidth: 1, height: 36, justifyContent: "center", width: 36 },
  matchInitial: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16 },
  matchName: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16 },
  matchMeta: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, marginTop: 1 },
  noMatchHelper: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 18, marginTop: 14 },
});

// =============================================================================
// STEP 4 — DELIVERY (how does it get to them?)
// =============================================================================

function DeliveryStep({
  recipientName,
  selectedFriend,
  deliveryMode,
  onModeChange,
  address,
  onAddressChange,
  testID,
}: {
  recipientName: string;
  selectedFriend: Friend | null;
  deliveryMode: DeliveryMode;
  onModeChange: (m: DeliveryMode) => void;
  address: AddressDraft;
  onAddressChange: (a: AddressDraft) => void;
  testID?: string;
}) {
  const friendHasAddress = !!selectedFriend?.addressLine1;
  const recipientFirst = (recipientName || "Your friend").split(" ")[0];

  return (
    <View style={stepStyles.wrap} testID={testID}>
      <Text style={stepStyles.title}>Delivery details</Text>
      <Text style={stepStyles.subtitle}>How does it get to {recipientFirst}?</Text>

      <View style={deliveryStyles.options}>
        {friendHasAddress && selectedFriend && (
          <DeliveryOption
            mode="friend"
            current={deliveryMode}
            onSelect={onModeChange}
            icon={Check}
            title={`Send to ${selectedFriend.name}'s saved address`}
            body={`${selectedFriend.addressLine1}, ${selectedFriend.addressCity || selectedFriend.city}`}
            testID="send-delivery-friend"
          />
        )}

        <DeliveryOption
          mode="link"
          current={deliveryMode}
          onSelect={onModeChange}
          icon={LinkIcon}
          title={`Text ${recipientFirst} a private link`}
          body="Your card stays secret. They fill in their own address."
          testID="send-delivery-link"
        />

        <DeliveryOption
          mode="address"
          current={deliveryMode}
          onSelect={onModeChange}
          icon={MapPin}
          title="I have their address"
          body="Type it in. We save it for next time."
          testID="send-delivery-address"
        />
      </View>

      {deliveryMode === "address" && (
        <View style={deliveryStyles.addressForm} testID="send-address-form">
          <AddressField
            label="Recipient name"
            value={address.name || recipientName}
            onChange={(v) => onAddressChange({ ...address, name: v })}
            placeholder="Full name"
            autoCapitalize="words"
          />
          <AddressField
            label="Street address"
            value={address.line1}
            onChange={(v) => onAddressChange({ ...address, line1: v })}
            placeholder="123 Bedford Ave"
            autoComplete="address-line1"
            textContentType="streetAddressLine1"
          />
          <AddressField
            label="Apt / Unit"
            value={address.line2 || ""}
            onChange={(v) => onAddressChange({ ...address, line2: v })}
            placeholder="Apt 4B (optional)"
            autoComplete="address-line2"
            textContentType="streetAddressLine2"
            required={false}
          />
          <View style={deliveryStyles.row}>
            <View style={{ flex: 2 }}>
              <AddressField
                label="City"
                value={address.city}
                onChange={(v) => onAddressChange({ ...address, city: v })}
                placeholder="Brooklyn"
                autoCapitalize="words"
                textContentType="addressCity"
              />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <AddressField
                label="State"
                value={address.state}
                onChange={(v) => onAddressChange({ ...address, state: v.toUpperCase().slice(0, 2) })}
                placeholder="NY"
                autoCapitalize="characters"
                maxLength={2}
                textContentType="addressState"
              />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <AddressField
                label="ZIP"
                value={address.zip}
                onChange={(v) => onAddressChange({ ...address, zip: v })}
                placeholder="11211"
                keyboardType="number-pad"
                maxLength={10}
                textContentType="postalCode"
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function DeliveryOption({
  mode,
  current,
  onSelect,
  icon: Icon,
  title,
  body,
  testID,
}: {
  mode: DeliveryMode;
  current: DeliveryMode;
  onSelect: (m: DeliveryMode) => void;
  icon: typeof LinkIcon;
  title: string;
  body: string;
  testID: string;
}) {
  const active = mode === current;
  return (
    <Pressable
      onPress={() => onSelect(mode)}
      style={[deliveryStyles.option, active && deliveryStyles.optionActive]}
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
    >
      <View style={[deliveryStyles.optionIcon, active && deliveryStyles.optionIconActive]}>
        <Icon color={active ? colors.white : colors.ink} size={18} strokeWidth={1.7} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[deliveryStyles.optionTitle, active && deliveryStyles.optionTitleActive]}>{title}</Text>
        <Text style={deliveryStyles.optionBody}>{body}</Text>
      </View>
      {active ? <Check color={colors.postalBlue} size={20} strokeWidth={2.4} /> : <View style={{ width: 20 }} />}
    </Pressable>
  );
}

type AutoCompleteHint =
  | "address-line1"
  | "address-line2"
  | "postal-code"
  | "country"
  | "name"
  | "off";

type TextContentHint =
  | "streetAddressLine1"
  | "streetAddressLine2"
  | "addressCity"
  | "addressState"
  | "postalCode"
  | "countryName"
  | "name"
  | "none";

function AddressField({
  label,
  value,
  onChange,
  placeholder,
  autoCapitalize = "none",
  autoComplete,
  textContentType,
  keyboardType,
  maxLength,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: AutoCompleteHint;
  textContentType?: TextContentHint;
  keyboardType?: "default" | "number-pad" | "email-address";
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <View style={addressStyles.field}>
      <Text style={addressStyles.label}>{label}{required ? "" : " (optional)"}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedInk}
        style={addressStyles.input}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        keyboardType={keyboardType || "default"}
        maxLength={maxLength}
      />
    </View>
  );
}

const deliveryStyles = StyleSheet.create({
  options: { gap: 10, marginTop: 16 },
  option: { alignItems: "center", backgroundColor: "rgba(245, 240, 230, 0.6)", borderColor: colors.line, borderRadius: 12, borderWidth: 1.2, flexDirection: "row", gap: 12, padding: 14 },
  optionActive: { backgroundColor: "rgba(60,110,143,0.06)", borderColor: colors.postalBlue },
  optionIcon: { alignItems: "center", backgroundColor: colors.paper, borderColor: colors.line, borderRadius: 18, borderWidth: 1, height: 36, justifyContent: "center", width: 36 },
  optionIconActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  optionTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
  optionTitleActive: { color: colors.ink },
  optionBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16, marginTop: 2 },
  addressForm: { gap: 8, marginTop: 14 },
  row: { flexDirection: "row" },
});

const addressStyles = StyleSheet.create({
  field: { marginBottom: 4 },
  label: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.8, marginBottom: 6, textTransform: "uppercase" },
  input: { backgroundColor: colors.paper, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10 },
});

// =============================================================================
// SHARED STEP STYLES + ACTION ROW
// =============================================================================

const stepStyles = StyleSheet.create({
  wrap: { gap: 4, marginTop: 8 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: type.title, letterSpacing: -0.4, lineHeight: type.title + 4 },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 15, lineHeight: 21, marginTop: 4 },
});

const styles = StyleSheet.create({
  actionRow: { alignItems: "center", flexDirection: "row", gap: 14, marginTop: 24 },
  backBtn: { alignItems: "center", flexDirection: "row", gap: 4, paddingHorizontal: 4, paddingVertical: 10 },
  backBtnText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
  continueBtn: { flex: 1 },
  sendCol: { alignItems: "flex-end", flex: 1, gap: 2 },
  sendBtn: { alignSelf: "stretch", marginTop: 6 },
  priceMain: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16, lineHeight: 20 },
  priceMeta: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 14 },
  offscreen: { left: -10000, position: "absolute", top: -10000 },
});
