import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { ArrowLeft, ArrowRight, Camera, Check, Link as LinkIcon, Mail, MapPin, Send, User as UserIcon, Users as UsersIcon } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { PrimaryButton } from "@/src/components/Buttons";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { Header } from "@/src/components/Header";
import { MessageEditorSheet } from "@/src/components/MessageEditorSheet";
import { PostcardBackPreview, PostcardFrontPreview } from "@/src/components/PostcardPreview";
import { AddressFields } from "@/src/components/AddressFields";
import {
  AddressDraft,
  EMPTY_ADDRESS,
  isAddressComplete,
} from "@/src/types/address";
import { createReciprocationToken } from "@/src/services/api";
import { SuccessModal } from "@/src/components/SuccessModal";
import { CARD_COST_PHOTO } from "@/src/data/credits";
import { capturePostcardForPrint, humanizeLobError, lobRenderDimensions, submitToLob } from "@/src/services/lob";
import { refundPostcardCredit, uploadPostcardPhoto } from "@/src/services/api";
import { useMailClub } from "@/src/state/MailClubContext";
import { getSelfAddress, setSelfAddress } from "@/src/state/selfAddress";
import { colors } from "@/src/theme/colors";
import { fonts, type } from "@/src/theme/typography";
import type { Friend } from "@/src/types/mail";

/**
 * Send screen — v0.7.0.25 multi-step flow (dynamic per recipient kind).
 *
 * Step 1 is always the recipient TYPE picker (friend / yourself / pen pal).
 * After step 1 the flow forks by kind, because each kind needs different
 * downstream steps:
 *
 *   • Friend:  Type → Name → Cover → Inside → Delivery        (5 steps)
 *     Name now lives on its own page (was inline on step 1) so the user
 *     gets focus on choosing a friend without the type tiles distracting.
 *
 *   • Yourself: Type → [SelfAddress] → Cover → Inside          (3 or 4 steps)
 *     First-time self-senders fill their mailing address; we cache it on-
 *     device and skip the step on every subsequent self-send. Editable
 *     from Settings (My Card → Address) — build 38+. No delivery step at
 *     all — we already know the destination (your mailbox).
 *
 *   • Pen pal: Type → Cover → Inside                           (3 steps)
 *     Card goes to a random stranger in the Mailroom network via
 *     sendIntoVoid. No delivery step — the network picks the recipient.
 *
 * The dynamic `stepsForKind` array is the source of truth; `step` is a
 * 1-based index into it. `currentStepName` derives from there. canAdvance,
 * progress dots, and the action-row button label all read from the array
 * so adding/removing a step only requires updating one map.
 *
 * Lob capture happens off-screen at 1875px wide after a successful direct
 * send. The send-via-link flow defers Lob capture until the recipient
 * claims via the magic link.
 */

type StepName = "type" | "name" | "selfAddress" | "cover" | "inside" | "delivery";
type DeliveryMode = "friend" | "link" | "address";
type RecipientKind = "friend" | "self" | "penpal";

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

/**
 * Build the step array for the active recipient kind. Pure function of
 * (kind, hasSavedSelfAddress) so we can call it both inside render and
 * inside event handlers without worrying about stale closures.
 */
function stepsForKind(
  kind: RecipientKind | null,
  hasSavedSelfAddress: boolean,
): StepName[] {
  if (kind === "friend") return ["type", "name", "cover", "inside", "delivery"];
  if (kind === "self") {
    return hasSavedSelfAddress
      ? ["type", "cover", "inside"]
      : ["type", "selfAddress", "cover", "inside"];
  }
  if (kind === "penpal") return ["type", "cover", "inside"];
  return ["type"];
}

/** Human-readable label for the step crumb. */
function labelForStep(name: StepName): string {
  switch (name) {
    case "type":
      return "Recipient";
    case "name":
      return "Friend";
    case "selfAddress":
      return "Your address";
    case "cover":
      return "Cover";
    case "inside":
      return "Inside";
    case "delivery":
      return "Delivery";
  }
}

export default function SendScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ friendId?: string; mode?: string }>();
  const {
    friends,
    credits,
    currentUser,
    sendPostcard,
    sendPostcardViaLink,
    sendIntoVoid,
    addFriendByAddress,
    showCelebration,
    refreshProfile,
  } = useMailClub();

  // v0.7.0.30: pre-upload state. When the user picks a photo on the
  // Cover step we kick off the Storage upload IMMEDIATELY in the
  // background. By the time they finish writing their note and tap
  // Send, the upload has usually already completed and the pre-
  // uploaded storage path is in the cache. The Send tap then skips
  // the (1-3s) upload step and goes straight to the RPC + Lob hand-
  // off. Cuts perceived send time roughly in half.
  //
  // Keyed by the local file:// URI so multiple photo changes don't
  // confuse the cache. If user picks photo A, switches to B, we want
  // the cache to track B's upload (A's is throwaway).
  const photoUploadCacheRef = useRef<{ uri: string; path: Promise<string | null> } | null>(null);

  // -- Step machine -------------------------------------------------------
  // `step` is a 1-based INDEX into the dynamic step array. Use
  // `currentStepName` below to branch on what the user is actually seeing.
  const [step, setStep] = useState<number>(1);

  // -- Compose state ------------------------------------------------------
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  // -- Recipient state ----------------------------------------------------
  const [recipientKind, setRecipientKind] = useState<RecipientKind | null>(null);
  // Name input is only used when recipientKind === "friend".
  const [recipientName, setRecipientName] = useState("");
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);

  // -- Delivery state -----------------------------------------------------
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("link");
  const [address, setAddress] = useState<AddressDraft>(EMPTY_ADDRESS);

  // -- Self-address state -------------------------------------------------
  // The address the user enters once on their first self-send, then reuses
  // forever. Hydrated from AsyncStorage on mount (see effect below). When
  // null/incomplete, the dynamic step array includes a "selfAddress" step;
  // when complete, we skip straight to cover/inside/send.
  const [savedSelfAddress, setSavedSelfAddress] = useState<AddressDraft | null>(null);
  // Draft state for the selfAddress step. Pre-filled from savedSelfAddress
  // (lets the user edit and save back) or from currentUser.city/state when
  // first-time.
  const [selfAddressDraft, setSelfAddressDraft] = useState<AddressDraft>(EMPTY_ADDRESS);

  // -- Send + modal state -------------------------------------------------
  const [sending, setSending] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [success, setSuccess] = useState({ visible: false, title: "", subtitle: "" });
  const [seededFriend, setSeededFriend] = useState<string | undefined>(undefined);

  const [printSnapshot, setPrintSnapshot] = useState<PrintSnapshot | null>(null);

  // -- Refs ---------------------------------------------------------------
  const printFrontRef = useRef<View>(null);
  const printBackRef = useRef<View>(null);
  const sendingLockRef = useRef(false);
  const { width: PRINT_W } = lobRenderDimensions();

  // -- Hydrate saved self-address on mount -------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const a = await getSelfAddress();
      if (cancelled) return;
      if (a && isAddressComplete(a)) {
        setSavedSelfAddress(a);
        setSelfAddressDraft(a);
      } else {
        // First-time self-sender: seed the draft with whatever the user
        // already gave us during onboarding (name + city/state).
        setSelfAddressDraft({
          ...EMPTY_ADDRESS,
          name: currentUser.name || "",
          city: currentUser.city || "",
          state: currentUser.state || "",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // We only hydrate on mount; currentUser may not be set yet but the
    // address persists across compose sessions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Derived: dynamic step array ---------------------------------------
  const steps = useMemo<StepName[]>(
    () => stepsForKind(recipientKind, !!savedSelfAddress),
    [recipientKind, savedSelfAddress],
  );
  const totalSteps = steps.length;
  const currentStepName: StepName = steps[step - 1] ?? "type";

  // -- Param seeding ------------------------------------------------------

  // Seed recipient from ?friendId=... when navigated from a friend sheet.
  useEffect(() => {
    const friendParam = params?.friendId as string | undefined;
    if (!friendParam || seededFriend === friendParam) return;
    const friend = friends.find((f) => f.id === friendParam);
    if (friend) {
      setRecipientKind("friend");
      setSelectedFriendId(friend.id);
      setRecipientName(friend.name);
      setDeliveryMode(friend.addressLine1 ? "friend" : "link");
      if (photoUri && message.trim().length > 0) {
        // Jump to delivery (last step in friend flow).
        const friendSteps = stepsForKind("friend", !!savedSelfAddress);
        const deliveryIdx = friendSteps.indexOf("delivery") + 1;
        if (deliveryIdx > 0) setStep(deliveryIdx);
      }
    }
    setSeededFriend(friendParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.friendId, friends, seededFriend]);

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

  const friendMatches: Friend[] = useMemo(() => {
    const q = recipientName.trim().toLowerCase();
    if (!q) return [];
    return friends
      .filter((f) => f.name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [recipientName, friends]);

  const recipientForPreview = useMemo(() => {
    // Self-send: render the user's own saved address.
    if (recipientKind === "self") {
      const a = savedSelfAddress ?? selfAddressDraft;
      return {
        name: a.name || currentUser.name || "You",
        city: a.city,
        state: a.state,
        addressLine1: a.line1,
        addressLine2: a.line2,
        zip: a.zip,
      };
    }
    if (recipientKind === "penpal") {
      return { name: "A stranger in the network", city: "", state: "" };
    }
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
  }, [recipientKind, savedSelfAddress, selfAddressDraft, deliveryMode, address, selectedFriend, recipientName, currentUser]);

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
      aspect: [3, 2],
      quality: 0.92,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      // v0.7.0.30: kick off the upload immediately in the background.
      // The promise resolves to a Supabase Storage path that the send
      // action can use directly without re-uploading. We don't await
      // it here — user keeps moving through compose steps while the
      // upload runs in parallel.
      photoUploadCacheRef.current = {
        uri,
        path: uploadPostcardPhoto(uri, "photo.jpg").catch(() => null),
      };
    }
  }

  /**
   * Resolve a pre-uploaded photo path for the given local URI, falling
   * back to a fresh upload if the cache is missing or stale. Returns the
   * storage path the RPC expects (e.g. "<userId>/<ts>-photo.jpg") or
   * null if the upload failed.
   */
  async function resolveUploadedPath(localUri: string | null): Promise<string | null> {
    if (!localUri) return null;
    const cached = photoUploadCacheRef.current;
    if (cached && cached.uri === localUri) {
      // Cache hit — await the in-flight or already-resolved promise.
      // Almost always already resolved by the time user taps Send.
      return await cached.path;
    }
    // Cache miss (e.g. user manually changed the URI somehow). Fall
    // back to a fresh upload so we never silently drop the photo.
    return await uploadPostcardPhoto(localUri, "photo.jpg").catch(() => null);
  }

  // -- Step navigation ----------------------------------------------------

  function canAdvance(): { ok: true } | { ok: false; reason?: string } {
    switch (currentStepName) {
      case "type": {
        if (!recipientKind) {
          return { ok: false, reason: "Pick who this card is for." };
        }
        return { ok: true };
      }
      case "name": {
        if (recipientName.trim().length === 0) {
          return { ok: false, reason: "Type a name so we know which friend." };
        }
        return { ok: true };
      }
      case "selfAddress": {
        if (!isAddressComplete(selfAddressDraft)) {
          return {
            ok: false,
            reason: "Fill in your full address so we can mail it to you.",
          };
        }
        return { ok: true };
      }
      case "cover":
        return photoUri
          ? { ok: true }
          : { ok: false, reason: "Pick a photo first to keep moving." };
      case "inside":
        return message.trim().length > 0
          ? { ok: true }
          : { ok: false, reason: "Write a quick note for the back." };
      case "delivery":
        return { ok: true };
    }
  }

  function goBack() {
    if (step > 1) {
      setStep(step - 1);
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

    // Side effects on advance from specific steps:
    if (currentStepName === "selfAddress") {
      // Persist the draft. Future sends skip this step entirely.
      setSavedSelfAddress(selfAddressDraft);
      setSelfAddress(selfAddressDraft).catch(() => undefined);
    }

    if (step < totalSteps) {
      const next = step + 1;
      setStep(next);
      // When advancing to delivery with a locked friend who has an address,
      // default to "friend" delivery. Otherwise default to "link".
      const nextName = steps[next - 1];
      if (nextName === "delivery") {
        if (selectedFriend?.addressLine1) {
          setDeliveryMode("friend");
        } else if (deliveryMode === "friend") {
          setDeliveryMode("link");
        }
      }
    } else {
      // Last step → fire the send.
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
    // Only applies to the friend flow; self + penpal don't run a delivery
    // step at all.
    if (recipientKind === "friend" && deliveryMode === "address") {
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
    if (recipientKind === "friend" && deliveryMode === "friend" && !selectedFriend?.addressLine1) {
      sendingLockRef.current = false;
      Alert.alert(
        "No address on file",
        `We don't have a mailing address for ${selectedFriend?.name || "this friend"}. Pick "Magic link" or "I have their address" instead.`,
      );
      return;
    }

    setSending(true);
    // v0.7.0.30: resolve the pre-uploaded photo path ONCE up front so
    // every branch can hand it to the right action without re-running
    // the upload. The cache resolves instantly (Promise already settled)
    // in the common case where the user picked a photo on Cover step
    // ~10+ seconds before tapping Send.
    const resolvedPhotoPath = photoUri ? await resolveUploadedPath(photoUri) : null;
    try {
      // Penpal: card goes to a random user in our network. No delivery
      // step ever runs. sendIntoVoid handles recipient selection server-
      // side via the void claim queue.
      if (recipientKind === "penpal") {
        // v0.7.0.31 PHOTO BUGFIX: pass the LOCAL URI as photoUri (so the
        // optimistic insert in MailClubContext renders the photo
        // immediately, before fetchPostcards signs a working URL). Pass
        // the resolved Storage path as preUploadedPath so the api call
        // skips re-uploading.
        const result = await sendIntoVoid(
          message.trim(),
          photoUri ?? undefined,
          resolvedPhotoPath ?? undefined,
        );
        if (!result.ok) {
          Alert.alert("Couldn't send to pen pal", "Try again in a moment.");
          return;
        }
        // v0.7.0.30: fire the global envelope-balloon celebration
        // instead of the plain SuccessModal. Same animation the welcome
        // flow plays on first-card-sent. User feedback: "there should
        // also be a sent celebration after sending it normally in the
        // app, only a celebration at the end of the sign up flow."
        showCelebration({ kind: "penpal" });
        resetCompose();
        return;
      }

      // Self: address came from the cached self-address (or the just-
      // saved draft from the selfAddress step). We create-or-update the
      // "(me)" friend record with this address and send via the friend
      // path. The (me) friend stays filtered from every visible UI
      // surface by the visibleFriends gate in MailClubContext.
      if (recipientKind === "self") {
        const a = savedSelfAddress ?? selfAddressDraft;
        if (!isAddressComplete(a)) {
          // Shouldn't happen — the step gate catches this — but defend
          // against a programming error rather than crashing on Lob.
          Alert.alert(
            "Your address isn't set",
            "Add your address on the previous step, then try sending to yourself again.",
          );
          return;
        }
        const firstName = (a.name || currentUser.name || "You").split(" ")[0];
        const selfRes = await addFriendByAddress({
          name: `${firstName} (me)`,
          city: a.city,
          state: a.state,
          addressLine1: a.line1,
          addressLine2: a.line2,
          addressCity: a.city,
          addressState: a.state,
          addressZip: a.zip,
          addressCountry: "US",
        });
        if (!selfRes.ok || !selfRes.friend) {
          Alert.alert("Couldn't save self-address", "Try setting your address in My Card first.");
          return;
        }
        const result = await sendPostcard({
          kind: "photo",
          friendId: selfRes.friend.id,
          // v0.7.0.31 PHOTO BUGFIX: photoUri = LOCAL URI (for the
          // optimistic-insert journal tile), preUploadedPath = Storage
          // path (skip upload). See MailClubContext.tsx:443 for full
          // rationale.
          photoUri: photoUri ?? "",
          preUploadedPath: resolvedPhotoPath ?? undefined,
          message: message.trim(),
          friend: selfRes.friend,
        });
        if (!result.ok) {
          Alert.alert("Couldn't send", "Try again in a moment.");
          return;
        }
        showCelebration({ kind: "self", recipientName: currentUser.name?.split(" ")[0] });
        resetCompose();
        return;
      }

      // Friend flow below ----------------------------------------------------
      if (deliveryMode === "link") {
        const result = await sendPostcardViaLink({
          category: "photo",
          message,
          // v0.7.0.31 PHOTO BUGFIX: LOCAL URI for optimistic render,
          // Storage path via preUploadedPath for the upload-skip.
          photoUri: photoUri ?? undefined,
          preUploadedPath: resolvedPhotoPath ?? undefined,
        });
        if (!result.ok || !result.claimUrl) {
          Alert.alert("Couldn't generate link", result.error ?? "Try again in a moment.");
          return;
        }
        // senderFirst removed in v0.7.0.28 — share message dropped the
        // self-reference. recipientFirst is still used in success modal copy.
        const recipientFirst = recipientName.trim().split(" ")[0] || "your friend";
        // v0.7.0.25: Slack + several iOS share extensions ignore the `url`
        // parameter when `message` is also present (or use the URL as the
        // attachment and discard the message). The user's complaint:
        // "Type a message here, if you'd like!" placeholder showing instead
        // of the friendly pre-fill. Fix: bake the URL INTO the message and
        // drop the separate `url` field. Every share target now gets the
        // full pre-filled text "I want to send you a postcard, address: <url>".
        // v0.7.0.28: rewritten for genuine first-person voice. Previous
        // version had third-person "${senderFirst} is using Mailroom"
        // which reads weirdly inside an iMessage/Slack thread where
        // the sender's identity is already obvious. Dropped the brand
        // mention + the corporate "we'll print and ship it for you"
        // tail. Three sentences, no exclamation, ends with the link.
        const shareMsg = `I'm sending you a postcard. Drop your address in here so it gets to you:\n\n${result.claimUrl}`;
        let shared = false;
        try {
          const shareResult = await Share.share({ message: shareMsg });
          // iOS returns { action: 'sharedAction' | 'dismissedAction', activityType?: string }
          // Android returns { action: 'sharedAction' | 'dismissedAction' }
          // The user complaint: we showed "Link sent" even when they
          // canceled the share sheet. Only flash the success modal when
          // the share actually completed.
          shared = shareResult.action === Share.sharedAction;
        } catch {
          // Real error opening the share sheet — treat as not shared.
          shared = false;
        }
        if (shared) {
          // v0.7.0.30: fire the global envelope-balloon celebration
          // after the share actually completes (consistent with the
          // welcome-flow link path landed in build 41).
          showCelebration({
            kind: "link",
            recipientName: recipientFirst,
            shareUrl: result.claimUrl,
          });
        } else {
          // User dismissed without sharing. The postcard row + claim URL
          // are already saved server-side (the credit was spent on
          // sendPostcardViaLink before the share sheet opened) and show
          // up in the journal as "AWAITING ADDRESS" with a "Share again"
          // button on PostcardDetailSheet. Surface the path so the user
          // knows where to find it. Then reset compose — re-tapping Send
          // here would create a DUPLICATE postcard (same photo/note
          // sent twice). Forcing them through Journal → Share Again is
          // both clearer and prevents the duplicate.
          Alert.alert(
            "Link not shared yet",
            "Your postcard is saved in your journal. Open My Card → tap the card to share the link again.",
          );
        }
        // Reset regardless of share success — the postcard is created in
        // both cases, so compose state has done its job and a fresh state
        // prevents accidental duplicate sends. (codex P0: build 37 had
        // this race surface as duplicate journal rows when users tapped
        // Send → dismiss → Send again.)
        resetCompose();
        return;
      }

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
        // v0.7.0.31 PHOTO BUGFIX: LOCAL URI for optimistic render,
        // Storage path via preUploadedPath for the upload-skip.
        photoUri: photoUri ?? "",
        preUploadedPath: resolvedPhotoPath ?? undefined,
        message,
        friend: targetFriend ?? undefined,
      });
      if (!result.ok) return;

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

      // v0.7.0.30: fire the global envelope-balloon celebration.
      showCelebration({ kind: "friend", recipientName: targetName?.split(" ")[0] });

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
        const postcardIdForLob = result.postcardId;
        submitPostcardToLob(postcardIdForLob)
          .catch(async (err) => {
            // v0.7.0.32 codex P1.5: previously this was console.warn only,
            // leaving orphan postcards (status=queued, no Lob ID) with the
            // user's credit gone and no feedback. Now refund the credit
            // via the RPC + alert the user with a humanized error. The
            // refund RPC also deletes the orphan row, so the user can
            // retry from scratch.
            const message = err?.message ?? String(err);
            // eslint-disable-next-line no-console
            console.warn("Lob submission failed:", message);
            try {
              await refundPostcardCredit(postcardIdForLob);
              await refreshProfile();
            } catch (refundErr) {
              // eslint-disable-next-line no-console
              console.warn("Refund failed:", refundErr);
            }
            Alert.alert(
              "Couldn't print your card",
              humanizeLobError(message) + "\n\nYour credit was returned. Try again when you're ready.",
            );
          })
          .finally(() => {
            setPrintSnapshot(null);
          });
      }

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
    setRecipientKind(null);
    setRecipientName("");
    setSelectedFriendId(null);
    setAddress(EMPTY_ADDRESS);
    setDeliveryMode("link");
    setStep(1);
    // Note: savedSelfAddress + selfAddressDraft persist on purpose — the
    // whole point of the cached self-address is to survive across compose
    // sessions. Resetting them would defeat the "ask once" UX.
  }

  // -- Render -------------------------------------------------------------

  const cantAfford = credits < CARD_COST_PHOTO;
  // Final action label depends on what the last step is for this kind.
  // - Friend ends on "delivery" with link/address/friend options.
  // - Self ends on "inside" — send goes straight to the user's mailbox.
  // - Penpal ends on "inside" — send goes into the void.
  //
  // The "type" step is never the last step. When `recipientKind` is null
  // the steps array is just ["type"] and `step === totalSteps`, but that
  // user has nowhere to send to yet — we need the Continue button (which
  // re-derives the array once they pick a kind), not the final Send CTA.
  const isLastStep = currentStepName !== "type" && step === totalSteps;
  const finalCtaLabel = sending
    ? "Sending..."
    : cantAfford
      ? "Buy stamps"
      : recipientKind === "friend" && deliveryMode === "link"
        ? "Share a link"
        : "Send postcard";
  const continueLabel = !isLastStep ? "Continue" : finalCtaLabel;

  return (
    <AppShell>
      <Header title="Send" />

      <StepHeader step={step} totalSteps={totalSteps} steps={steps} />

      {currentStepName === "type" && (
        <RecipientStep
          recipientKind={recipientKind}
          onPickKind={(k) => {
            setRecipientKind(k);
            // Reset friend lock + name when switching away from "friend"
            if (k !== "friend") {
              setRecipientName("");
              unlockFriend();
            }
          }}
          testID="send-step-1"
        />
      )}

      {currentStepName === "name" && (
        <NameStep
          name={recipientName}
          onNameChange={(t) => {
            setRecipientName(t);
            if (selectedFriend && t.trim().toLowerCase() !== selectedFriend.name.toLowerCase()) {
              unlockFriend();
            }
          }}
          matches={friendMatches}
          locked={selectedFriend}
          onLockFriend={lockFriend}
          onUnlockFriend={unlockFriend}
          testID="send-step-name"
        />
      )}

      {currentStepName === "selfAddress" && (
        <SelfAddressStep
          address={selfAddressDraft}
          onAddressChange={setSelfAddressDraft}
          testID="send-step-self-address"
        />
      )}

      {currentStepName === "cover" && (
        <CoverStep
          photoUri={photoUri}
          onPickPhoto={openPhotoPicker}
          testID="send-step-2"
        />
      )}

      {currentStepName === "inside" && (
        <InsideStep
          message={message}
          recipientForPreview={recipientForPreview}
          sender={{
            name: currentUser.name || "You",
            city: currentUser.city || "",
            state: currentUser.state || "",
          }}
          onOpenEditor={() => setEditorOpen(true)}
          testID="send-step-3"
        />
      )}

      {currentStepName === "delivery" && (
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
        {step > 1 ? (
          <Pressable
            onPress={goBack}
            style={styles.backBtn}
            testID="send-back-btn"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft color={colors.ink} size={18} strokeWidth={1.8} />
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
        ) : null}

        {isLastStep ? (
          <View style={styles.sendCol}>
            <Text style={styles.priceMain} numberOfLines={1}>1 stamp</Text>
            <Text style={styles.priceMeta} numberOfLines={1}>You have {credits}</Text>
            <PrimaryButton
              title={continueLabel}
              icon={Send}
              onPress={cantAfford ? () => setCreditsOpen(true) : onSend}
              disabled={sending}
              style={styles.sendBtn}
              testID="send-final-btn"
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
          // v0.7.0.28: Lob auto-prints recipient address + indicia + IMb.
          // forPrint hides our own renders of those so we don't fight Lob.
          forPrint
        />
      </View>
    </AppShell>
  );
}

// =============================================================================
// STEP HEADER  (progress dots + crumb)
// =============================================================================

function StepHeader({
  step,
  totalSteps,
  steps,
}: {
  step: number;
  totalSteps: number;
  steps: StepName[];
}) {
  const currentName = steps[step - 1] ?? "type";
  // Note: testID intentionally uses 1..N positional step indexes for the
  // friend flow (the canonical 5-step), so existing tests don't have to
  // be renamed. For self/penpal flows the testIDs are unique by step
  // name (`send-step-self-address`, etc).
  return (
    <View style={stepHeaderStyles.row} testID={`send-step-header-${step}`}>
      <Text style={stepHeaderStyles.crumb}>
        Step {step} of {totalSteps} ·{" "}
        <Text style={stepHeaderStyles.crumbActive}>{labelForStep(currentName)}</Text>
      </Text>
      <View style={stepHeaderStyles.dotsRow}>
        {Array.from({ length: totalSteps }).map((_, i) => {
          const idx = i + 1;
          return (
            <View
              key={i}
              style={[
                stepHeaderStyles.dot,
                idx === step && stepHeaderStyles.dotActive,
                idx < step && stepHeaderStyles.dotComplete,
              ]}
            />
          );
        })}
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
// COVER (pick your photo)
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
// INSIDE (write the note)
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
// RECIPIENT (TYPE picker — friend / yourself / pen pal)
// =============================================================================

function RecipientStep({
  recipientKind,
  onPickKind,
  testID,
}: {
  recipientKind: RecipientKind | null;
  onPickKind: (k: RecipientKind) => void;
  testID?: string;
}) {
  return (
    <View style={stepStyles.wrap} testID={testID}>
      <Text style={stepStyles.title}>Who's it for?</Text>
      <Text style={stepStyles.subtitle}>Pick a person — friend, yourself, or a pen pal stranger.</Text>

      {/* v0.7.0.25: TYPE picker ONLY. The inline name input has moved
          to its own step (NameStep) for the friend flow — the picker
          and the name selection now get their own page each, which
          feels less crowded and gives focus to whichever decision the
          user is making. */}
      <View style={typePickerStyles.tilesWrap}>
        <RecipientTile
          kind="friend"
          selected={recipientKind === "friend"}
          icon={UsersIcon}
          title="A friend"
          body="Send to someone in your rolodex (or add a new contact)"
          onSelect={() => onPickKind("friend")}
          testID="send-kind-friend"
        />
        <RecipientTile
          kind="self"
          selected={recipientKind === "self"}
          icon={UserIcon}
          title="Yourself"
          body="A postcard to your own mailbox"
          onSelect={() => onPickKind("self")}
          testID="send-kind-self"
        />
        <RecipientTile
          kind="penpal"
          selected={recipientKind === "penpal"}
          icon={Mail}
          title="A pen pal"
          body="Send anonymously to a stranger in our network"
          onSelect={() => onPickKind("penpal")}
          testID="send-kind-penpal"
        />
      </View>
    </View>
  );
}

function RecipientTile({
  selected,
  icon: Icon,
  title,
  body,
  onSelect,
  testID,
}: {
  kind: RecipientKind;
  selected: boolean;
  icon: typeof Mail;
  title: string;
  body: string;
  onSelect: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={[typePickerStyles.tile, selected && typePickerStyles.tileSelected]}
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={[typePickerStyles.tileIcon, selected && typePickerStyles.tileIconSelected]}>
        <Icon
          color={selected ? colors.paper : colors.ink}
          size={20}
          strokeWidth={1.8}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={typePickerStyles.tileTitle}>{title}</Text>
        <Text style={typePickerStyles.tileBody}>{body}</Text>
      </View>
      {selected ? (
        <Check color={colors.postalBlue} size={20} strokeWidth={2.2} />
      ) : null}
    </Pressable>
  );
}

const typePickerStyles = StyleSheet.create({
  tilesWrap: { gap: 10, marginTop: 18, marginBottom: 8 },
  tile: {
    alignItems: "center",
    backgroundColor: "rgba(245, 240, 230, 0.5)",
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1.2,
    flexDirection: "row",
    gap: 14,
    padding: 14,
  },
  tileSelected: {
    backgroundColor: "rgba(60, 110, 143, 0.08)",
    borderColor: colors.postalBlue,
    borderWidth: 1.6,
  },
  tileIcon: {
    alignItems: "center",
    backgroundColor: colors.paper,
    borderRadius: 999,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  tileIconSelected: {
    backgroundColor: colors.postalBlue,
  },
  tileTitle: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 17,
    marginBottom: 2,
  },
  tileBody: {
    color: colors.mutedInk,
    fontFamily: fonts.serif,
    fontSize: 13,
    lineHeight: 17,
  },
});

// =============================================================================
// NAME (friend-only: type a name + inline match list)
// =============================================================================

function NameStep({
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
      <Text style={stepStyles.title}>Who's the friend?</Text>
      <Text style={stepStyles.subtitle}>Type their name. We'll match against your rolodex as you go.</Text>

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
// SELF ADDRESS (first-time self-sender: capture their mailing address)
// =============================================================================

function SelfAddressStep({
  address,
  onAddressChange,
  testID,
}: {
  address: AddressDraft;
  onAddressChange: (a: AddressDraft) => void;
  testID?: string;
}) {
  return (
    <View style={stepStyles.wrap} testID={testID}>
      <Text style={stepStyles.title}>Your mailing address</Text>
      <Text style={stepStyles.subtitle}>
        We'll save this so you don't have to type it again. Edit anytime
        from Settings.
      </Text>

      <View style={{ marginTop: 18, gap: 8 }}>
        <AddressField
          label="Your name"
          value={address.name}
          onChange={(v) => onAddressChange({ ...address, name: v })}
          placeholder="Full name"
          autoCapitalize="words"
        />
        <AddressFields
          address={address}
          onChange={onAddressChange}
          testIDPrefix="send-self"
          label="Your address"
        />
      </View>
    </View>
  );
}

// =============================================================================
// DELIVERY (friend-only: link / address / saved-friend)
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
          <AddressFields
            address={address}
            onChange={onAddressChange}
            testIDPrefix="send"
            label="Their address"
          />
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
  actionRow: { alignItems: "flex-end", flexDirection: "row", gap: 14, marginTop: 24 },
  backBtn: { alignItems: "center", flexDirection: "row", gap: 4, paddingHorizontal: 4, paddingVertical: 10 },
  backBtnText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
  continueBtn: { flex: 1 },
  sendCol: { alignItems: "flex-end", flex: 1, gap: 2 },
  sendBtn: { alignSelf: "stretch", marginTop: 6 },
  priceMain: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16, lineHeight: 20 },
  priceMeta: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 14 },
  offscreen: { left: -10000, position: "absolute", top: -10000 },
});
