import * as AppleAuthentication from "expo-apple-authentication";
import * as ImagePicker from "expo-image-picker";
import { ArrowLeft, ArrowRight, Image as ImageIcon, Link as LinkIcon, User as UserIcon, Users as UsersIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { PrimaryButton } from "@/src/components/Buttons";
import {
  PostcardBackPreview,
  PostcardFrontPreview,
} from "@/src/components/PostcardPreview";
import {
  fetchAddressSuggestions,
  fetchPlaceDetails,
  newSessionToken,
  type AddressSuggestion,
} from "@/src/services/addressAutocomplete";
import { isAppleSignInAvailable } from "@/src/services/apple-auth";
import { lookupReciprocation, refundPostcardCredit } from "@/src/services/api";
import {
  capturePostcardForPrint,
  lobRenderDimensions,
  submitToLob,
} from "@/src/services/lob";
import { SUPABASE_CONFIGURED } from "@/src/services/supabase";
import { useMailClub } from "@/src/state/MailClubContext";
import { peekPendingInvite } from "@/src/state/pendingInvite";
import { colors } from "@/src/theme/colors";
import { fonts, type } from "@/src/theme/typography";

/**
 * WelcomeSheet — v0.7 forced signup→send flow.
 *
 * The keystone of v0.7. A user cannot enter the app until they have
 * mailed a postcard. The "form" they fill out IS a postcard. Every
 * field we need (name, address, photo, message, recipient) gets
 * collected naturally because they&apos;re literally addressing one.
 *
 * Step machine:
 *   1. hero        — Recraft brand art + Apple Sign In (primary) + email link
 *   1b. auth-email — Email + password fallback (sign-up or sign-in)
 *   2. photo       — Pick a photo from camera roll (3:2 crop)
 *   3. note        — Write a one-or-two-line message
 *   4. recipient   — Pick one: A friend / Send-link / Send to yourself / Pen pal
 *   5. their-info  — Their name + address (varies by recipient kind)
 *   6. your-info   — Your first name + address (sender side)
 *   7. mailed      — "MAILED" celebration → enter app
 *
 * Order of server-side calls on the final commit (step 7):
 *   a) completeSignup({ name, city, state })  — creates profile row
 *   b) For "friend" recipient: addFriendByAddress(...)  — creates friend row
 *   c) sendPostcard(...) OR sendPostcardViaLink(...)
 *      — flips hasSentFirstCard=true in MailClubContext, which un-gates
 *        the WelcomeGate so the user lands in My Card with the new card
 *        already in their journal.
 *
 * Failure handling: any error in (a/b/c) surfaces an alert and keeps
 * the user on the current step. The signup→send is treated as a single
 * intent — if it fails, we don&apos;t partial-commit a half-signed-up
 * user (matches codex audit finding Q1: atomicity-or-roll-back).
 *
 * Pen pal (Phase 7+): currently a disabled option on the recipient
 * picker. The matching backend ships in v0.7.5; the UI placeholder
 * lives here so users know the path exists.
 */

type Step =
  | "hero"
  | "auth-email"
  | "explain"      // NEW: brief "your first card is on us" interstitial
  | "photo"
  | "note"
  | "recipient"
  | "their-info"
  | "your-info"
  | "mailed";

type RecipientKind = "friend" | "link" | "self" | "penpal";

type AddressDraft = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
};

const EMPTY_ADDRESS: AddressDraft = { line1: "", line2: "", city: "", state: "", zip: "" };

const HERO_FOLK_MAP = require("@/assets/onboarding/hero-folk-map.png");
const HERO_MAILBOX = require("@/assets/onboarding/hero-mailbox.png");
// v0.7.0.24: user picked variant B from the Recraft hand-drawn gallery.
// Hot-air balloon shaped like an envelope, drifting over patterned green
// fields. Used as the MailedStep celebration hero, with a gentle
// floating animation that makes it feel like it's actually flying.
const HERO_ENVELOPE_BALLOON = require("@/assets/onboarding/hero-envelope-balloon.jpg");

// State validator: 2-char US state code. We don&apos;t validate against a
// full state list here — Lob does USPS verification server-side at send.
const STATE_RE = /^[A-Za-z]{2}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

export function WelcomeSheet({
  visible,
  onComplete,
}: {
  visible: boolean;
  onComplete: () => void;
}) {
  const {
    completeSignup,
    signInWithEmail,
    signInWithApple,
    resetPassword,
    addFriendByAddress,
    sendPostcard,
    sendPostcardViaLink,
    sendIntoVoid,
    refreshProfile,
    hasCompletedSignup,
    showCelebration,
  } = useMailClub();

  // ----- Step + linear nav --------------------------------------------------
  const [step, setStep] = useState<Step>("hero");

  // ----- Auth state ---------------------------------------------------------
  const [emailMode, setEmailMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [appleAvailable, setAppleAvailable] = useState(false);
  // True once Apple sign-in or email sign-up has succeeded. From this point
  // we collect profile+card fields and commit them together at "mailed".
  const [authed, setAuthed] = useState(false);
  // Name + email pre-filled by Apple if they shared them.
  const [presetFirstName, setPresetFirstName] = useState("");

  // ----- Card draft state ---------------------------------------------------
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  // ----- Recipient ----------------------------------------------------------
  const [recipientKind, setRecipientKind] = useState<RecipientKind | null>(null);
  const [theirName, setTheirName] = useState("");
  const [theirAddress, setTheirAddress] = useState<AddressDraft>(EMPTY_ADDRESS);
  // For "link" mode: contact (phone or email) instead of an address.
  const [theirContact, setTheirContact] = useState("");

  // ----- Your info ----------------------------------------------------------
  const [yourFirstName, setYourFirstName] = useState("");
  const [yourAddress, setYourAddress] = useState<AddressDraft>(EMPTY_ADDRESS);

  // ----- UX flags -----------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // v0.7.0.18: for the "Send a link" path, stash the claim URL here so
  // MailedStep can display + share it. iOS won't present a share sheet
  // over a fullScreen Modal, so we defer Share.share until the modal
  // dismisses (handled in MailedStep's onDismiss below).
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // ----- v0.7.0.8 Lob handoff: off-screen print-scale views -----------------
  // Mirrors the pattern from app/(tabs)/send.tsx. After the RPC creates a
  // postcards row, we capture these off-screen views to PNGs, upload them
  // to Storage, and call the lob-send-postcard Edge Function so Lob
  // actually prints + mails the card. Without this, the welcome flow only
  // creates a DB row — no physical postcard ever ships.
  //
  // The views read from `printSnapshot` if set (frozen at send time), so
  // capture works against stable data even if the user races to finish
  // the celebration screen.
  type WelcomePrintSnapshot = {
    photoUri: string;
    message: string;
    recipient: {
      name: string;
      city: string;
      state: string;
      addressLine1?: string;
      addressLine2?: string;
      zip?: string;
    };
    sender: { name: string; city: string; state: string };
  };
  const [printSnapshot, setPrintSnapshot] = useState<WelcomePrintSnapshot | null>(null);
  const printFrontRef = useRef<View>(null);
  const printBackRef = useRef<View>(null);
  const { width: PRINT_W } = lobRenderDimensions();

  // ----- Phase 3.5: pending invite ------------------------------------------
  const [pendingInviteCopy, setPendingInviteCopy] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    isAppleSignInAvailable().then((available) => {
      if (mounted) setAppleAvailable(available);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const pending = await peekPendingInvite();
        if (cancelled || !pending) return;
        const data = await lookupReciprocation(pending.token);
        if (cancelled || !data.ok) return;
        const first = (data.sender_name ?? "Someone").split(" ")[0];
        const place = data.sender_city ? ` in ${data.sender_city}` : "";
        setPendingInviteCopy(
          `${first}${place} sent you a postcard. We'll add them to your rolodex once you mail your first card.`,
        );
      } catch {
        // ignore — invite copy is nice-to-have
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Reset everything when the sheet hides so a sign-out → re-open starts
  // at hero with no leaked draft state.
  useEffect(() => {
    if (visible) return;
    setStep("hero");
    setEmail("");
    setPassword("");
    setEmailMode("signup");
    setAuthed(false);
    setPresetFirstName("");
    setPhotoUri(null);
    setMessage("");
    setRecipientKind(null);
    setTheirName("");
    setTheirAddress(EMPTY_ADDRESS);
    setTheirContact("");
    setYourFirstName("");
    setYourAddress(EMPTY_ADDRESS);
    setSaving(false);
    setError(null);
    setInfo(null);
  }, [visible]);

  // If hasCompletedSignup AND hasSentFirstCard become true while we&apos;re
  // mounted (e.g. a returning user who already onboarded), the WelcomeGate
  // closes us automatically. We don&apos;t need to do anything here.
  useEffect(() => {
    if (hasCompletedSignup && step === "hero") {
      // Returning user with profile but no first card yet. Skip auth, send
      // them straight to the photo step.
      setAuthed(true);
      setStep("photo");
    }
  }, [hasCompletedSignup, step]);

  // ----- Validators ---------------------------------------------------------

  const canAdvanceEmail =
    email.trim().includes("@") && password.length >= 8 && !saving;
  const canAdvancePhoto = !!photoUri;
  const canAdvanceNote = message.trim().length > 0;
  // v0.7.0.1: pen pal is unblocked. It wires to `sendIntoVoid` (the
  // existing anonymous "send to a stranger" backend), so users can
  // actually mail one — no matching backend needed in MVP. The card
  // queues, eventually a Mailroom-side moderator/match assigns it.
  const canAdvanceRecipient = recipientKind !== null;

  function isAddressComplete(a: AddressDraft): boolean {
    return (
      a.line1.trim().length > 0 &&
      a.city.trim().length > 0 &&
      STATE_RE.test(a.state.trim()) &&
      ZIP_RE.test(a.zip.trim())
    );
  }

  // v0.7.0.1: only the "friend" recipient kind needs full recipient info
  // (name + mailing address). All others skip their-info and go straight
  // to your-info:
  //   - link: dropped name + contact fields. The receiver enters their
  //     own info via the App Clip (build 39+) or the web fallback. Zero
  //     friction on the sender side — the iOS Share sheet during the
  //     mailed step delivers the claim URL with a pre-filled message.
  //   - self: uses the user's own address (collected on your-info).
  //   - penpal: anonymous, no recipient info. Routed through sendIntoVoid.
  //
  // v0.7.0.25 follow-up: an earlier build 38 attempt routed "link"
  // through their-info too, on the (wrong) theory that the bug "Send a
  // Link doesn't solicit the share" meant we needed to ask for the
  // recipient's name + phone. The real bug was the WelcomeGate race
  // that unmounted MailedStep before it could fire Share.share. With
  // the WelcomeGate latch in place, MailedStep mounts and the Share
  // sheet auto-opens — no need to harvest recipient info up front.
  // Sender-side friction is the whole reason link mode exists.
  const needsTheirInfo = recipientKind === "friend";

  const canAdvanceTheirInfo =
    recipientKind === "friend"
      ? theirName.trim().length > 0 && isAddressComplete(theirAddress)
      : true;

  // v0.7.0.17: only "self" sends need the user's full street address —
  // they ARE the recipient, so we need the full mailable address. For
  // friend / link / penpal, we just need a first name + city for the
  // "from your city" caption on the postcard back. Less typing for the
  // user; less data collected. Privacy by default.
  const needsFullYourAddress = recipientKind === "self";
  const canAdvanceYourInfo = needsFullYourAddress
    ? yourFirstName.trim().length > 0 && isAddressComplete(yourAddress)
    : yourFirstName.trim().length > 0 &&
      yourAddress.city.trim().length > 0 &&
      yourAddress.state.trim().length === 2;

  // ----- Hero actions -------------------------------------------------------

  async function onAppleSignIn() {
    // v0.7.0.8: guard against double-fire. The Apple button doesn't
    // visually debounce on its own — a fast double-tap can kick off two
    // signInWithApple() calls in parallel, leading to a confusing
    // experience where the second call's credential dialog auto-cancels
    // the first. Bail early if a sign-in is already in flight.
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const result = await signInWithApple();
      if (!result.ok) {
        if (result.cancelled) {
          // v0.7.0.8: first-time Apple Sign In on a device often shows
          // an iOS-level consent sheet ("Allow this app to use Sign in
          // with Apple?"). If the user dismisses or accepts that, the
          // SDK reports `cancelled: true` and no error. Previously we
          // silently did nothing, which felt like the button was
          // broken. Show a gentle hint so the second tap feels natural.
          setInfo("Tap Sign in with Apple again to continue.");
        } else {
          setError(result.error ?? "Apple sign-in didn&apos;t work.");
        }
        return;
      }
      setAuthed(true);
      // codex Phase 6 P1: trust hasCompletedSignup over isNewUser. Apple
      // only knows whether THIS Apple ID has used the relying party
      // before; it doesn&apos;t know whether the Mailroom profile is
      // complete. Always advance through the full flow unless the
      // profile is already done.
      if (result.fullName) {
        const first = result.fullName.split(/\s+/)[0] ?? "";
        setPresetFirstName(first);
        setYourFirstName(first);
      }
      // v0.7.0.1: insert the "explain" interstitial after auth so the
      // jump from sign-in to photo-pick isn&apos;t jarring. Returning
      // users (rare, since hasCompletedSignup+hasSentFirstCard=true
      // closes the sheet entirely) also see it briefly — not a problem.
      setStep("explain");
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function onSubmitEmailAuth() {
    if (!canAdvanceEmail) return;
    setError(null);
    setInfo(null);
    setSaving(true);
    try {
      if (emailMode === "signin") {
        const result = await signInWithEmail(email.trim(), password);
        if (!result.ok) {
          setError(result.error ?? "Couldn&apos;t sign in.");
          return;
        }
        setAuthed(true);
        setStep("explain");
        return;
      }
      // Sign-up path: defer the actual signup until "mailed" step so we
      // can commit profile + first card atomically. We just bank email +
      // password and move on.
      setAuthed(true);
      setStep("explain");
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function onForgotPassword() {
    setError(null);
    setInfo(null);
    if (!email.trim().includes("@")) {
      setError("Enter your email above first.");
      return;
    }
    const result = await resetPassword(email.trim());
    if (result.ok) {
      setInfo("Check your inbox for a reset link.");
    } else {
      setError(result.error ?? "Couldn&apos;t send the reset email.");
    }
  }

  // ----- Photo step --------------------------------------------------------

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Photo access needed",
        "Mailroom needs photo access to attach an image to your postcard. Enable it in iOS Settings → Mailroom.",
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
      setPhotoUri(result.assets[0].uri);
    }
  }

  // ----- v0.7.0.8 Lob submission helper -----------------------------------
  // Captures the off-screen print views (front + back) and forwards the
  // PNGs to the lob-send-postcard Edge Function. Awaited inline so the
  // user sees "Mailing..." until Lob actually has the card; the fold
  // animation on the mailed step then plays against real success.
  //
  // Returns true on success, false otherwise. Callers swallow the false
  // case so a slow Lob/upload doesn't block the celebration screen — the
  // DB row exists either way, and a server-side reconcile job can catch
  // stragglers later (TODO Phase 7).
  // v0.7.0.17: returns { ok, error } instead of bare boolean so callers
  // can surface the actual Lob failure to the user. Retrying with the same
  // address doesn't help if Lob rejected the address itself — the user
  // needs to know to fix the input or contact us.
  async function submitWelcomePostcardToLob(
    postcardId: string,
    snapshot: WelcomePrintSnapshot,
  ): Promise<{ ok: boolean; error?: string }> {
    setPrintSnapshot(snapshot);
    // Two ticks for layout + paint. send.tsx uses 250ms; we use the same.
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!printFrontRef.current || !printBackRef.current) {
      // eslint-disable-next-line no-console
      console.warn("[WelcomeSheet] print refs not mounted; skipping Lob submit");
      return { ok: false, error: "Couldn't capture the postcard preview. Try again." };
    }
    try {
      const captured = await capturePostcardForPrint(printFrontRef, printBackRef);
      const result = await submitToLob({
        postcardId,
        frontUri: captured.frontUri,
        backUri: captured.backUri,
      });
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.warn("[WelcomeSheet] Lob submit failed:", result.error);
        return { ok: false, error: result.error };
      }
      // v0.7.0.10: the lob-send-postcard Edge Function persists the
      // rendered front PNG URL into postcards.photo_path on success,
      // so the journal + map tiles get a stable thumbnail. (RLS blocks
      // the client from updating that column directly, but the Edge
      // Function runs with service-role.)
      // eslint-disable-next-line no-console
      console.log("[WelcomeSheet] Lob submit ok", result.lobId);
      return { ok: true };
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn("[WelcomeSheet] Lob submit threw:", err?.message ?? err);
      return { ok: false, error: err?.message ?? "Network error talking to our print service." };
    } finally {
      // Release the snapshot so the off-screen views go quiet.
      setPrintSnapshot(null);
    }
  }

  // v0.7.0.17: translate raw Lob errors into actionable user messages.
  // Lob's strictness rejections look opaque ("does not meet your minimum
  // deliverability strictness") — we surface a hint about what to do.
  function humanizeLobError(raw: string | undefined): string {
    if (!raw) return "Couldn't print your card. Tap Mail it again — we'll retry.";
    const lower = raw.toLowerCase();
    if (lower.includes("deliverability strictness") || lower.includes("undeliverable")) {
      return "USPS couldn't verify that address. Double-check the street number, ZIP, and apt/suite — even one digit off and we can't ship.";
    }
    if (lower.includes("address") && (lower.includes("invalid") || lower.includes("not found"))) {
      return "That address didn't validate. Double-check the street number, city, and ZIP.";
    }
    if (lower.includes("network") || lower.includes("fetch")) {
      return "Couldn't reach our print service. Check your connection and tap Mail it again.";
    }
    // Fallback: surface the raw error so we can debug from the user's screen.
    return `Couldn't print your card: ${raw}`;
  }

  // ----- Final commit ------------------------------------------------------

  async function commitSignupAndSend() {
    setError(null);
    setSaving(true);
    try {
      // 1) Profile must exist server-side before postcard FKs can resolve.
      //    completeSignup also handles the email signup case (creates the
      //    auth user if we banked email+password earlier).
      await completeSignup({
        name: yourFirstName.trim(),
        city: yourAddress.city.trim(),
        state: yourAddress.state.trim().toUpperCase(),
        email: email.trim() || undefined,
        password: password || undefined,
      });

      // 2) Recipient creation + send. The action types don&apos;t carry
      //    structured error fields, so we surface generic messages and
      //    rely on the action itself to have logged + alerted the user
      //    with specifics (e.g. INSUFFICIENT_CREDITS).
      if (recipientKind === "friend") {
        const result = await addFriendByAddress({
          name: theirName.trim(),
          city: theirAddress.city.trim(),
          state: theirAddress.state.trim().toUpperCase(),
          addressLine1: theirAddress.line1.trim(),
          addressLine2: theirAddress.line2.trim() || undefined,
          addressCity: theirAddress.city.trim(),
          addressState: theirAddress.state.trim().toUpperCase(),
          addressZip: theirAddress.zip.trim(),
          addressCountry: "US",
        });
        if (!result.ok || !result.friend) {
          throw new Error("Couldn't add your friend.");
        }
        const sendRes = await sendPostcard({
          kind: "photo",
          friendId: result.friend.id,
          photoUri: photoUri ?? "",
          message: message.trim(),
          friend: result.friend,
        });
        if (!sendRes.ok) {
          throw new Error("Couldn't mail the card.");
        }
        // v0.7.0.8: hand the postcard off to Lob. Captures off-screen
        // print views → uploads → invokes lob-send-postcard Edge Function.
        // Without this, the RPC's postcards row exists but nothing ships.
        // v0.7.0.11: throw if it fails so the user sees a real error
        // instead of the silent "MAILED" lie the audit caught.
        if (sendRes.postcardId) {
          const lobResult = await submitWelcomePostcardToLob(sendRes.postcardId, {
            photoUri: photoUri ?? "",
            message: message.trim(),
            recipient: {
              name: result.friend.name,
              city: result.friend.addressCity || result.friend.city || "",
              state: result.friend.addressState || result.friend.state || "",
              addressLine1: result.friend.addressLine1,
              addressLine2: result.friend.addressLine2,
              zip: result.friend.addressZip,
            },
            sender: {
              name: yourFirstName.trim() || "You",
              city: yourAddress.city.trim(),
              state: yourAddress.state.trim().toUpperCase(),
            },
          });
          if (!lobResult.ok) {
            // v0.7.0.17: refund the credit the RPC just charged. Without
            // this the user gets stuck — their card row exists, their
            // credit is gone, and the next Mail-it tap fails on
            // INSUFFICIENT_CREDITS. The refund RPC also deletes the orphan
            // row, so retry creates a fresh postcard.
            await refundPostcardCredit(sendRes.postcardId);
            await refreshProfile();
            throw new Error(humanizeLobError(lobResult.error));
          }
        }
      } else if (recipientKind === "link") {
        // Send-link flow: card queues immediately + the user gets a
        // shareable claim URL.
        //
        // v0.7.0.26 rewrite of the timing. Previously the link path
        // stashed the URL and walked the user through MailedStep
        // (envelope-balloon celebration), THEN fired Share.share on
        // dismiss. User feedback: "the celebration for mail sent
        // should happen after the link has been sent." That's right
        // — playing the celebration before the actual share misled
        // the user, especially if they then dismissed the share sheet.
        //
        // New order:
        //   1. RPC creates the postcard server-side.
        //   2. Welcome modal dismisses immediately (onComplete()).
        //   3. After 300ms (iOS modal teardown), Share.share fires.
        //   4. iOS share sheet returns sharedAction OR dismissedAction.
        //   5. If shared: trigger CelebrationOverlay (a global modal
        //      that lives in app/_layout.tsx, decoupled from the
        //      welcome flow). Envelope-balloon plays AFTER the actual
        //      send completes.
        //   6. If dismissed: the postcard is still in the user's
        //      journal (sendPostcardViaLinkAction added it optimistically)
        //      with a "Share again" button on PostcardDetailSheet.
        //      No celebration — the user didn't actually send.
        const sendRes = await sendPostcardViaLink({
          category: "photo",
          message: message.trim(),
          photoUri: photoUri ?? undefined,
        });
        if (!sendRes.ok || !sendRes.claimUrl) {
          throw new Error("Couldn't create the link.");
        }
        const claimUrl = sendRes.claimUrl;
        const recipientFirstForCopy =
          theirName.trim().split(" ")[0] || "your friend";
        const senderFirst = yourFirstName.trim() || "I";
        // Close the welcome modal NOW. The share sheet will fire after
        // a short delay so iOS can tear down the modal's view
        // controller and present UIActivityViewController over the
        // app shell (not over a fullScreen modal, which iOS blocks).
        onComplete();
        setTimeout(() => {
          Share.share({
            message: `I want to send you a postcard! ${senderFirst} is using Mailroom. Tap the link below to share your mailing address — we'll print and ship it for you.\n\n${claimUrl}`,
          })
            .then((result) => {
              // Only celebrate on actual share completion. iOS share
              // sheet returns { action: "sharedAction" } on share,
              // { action: "dismissedAction" } on cancel.
              if (result.action === Share.sharedAction) {
                showCelebration({
                  kind: "link",
                  recipientName: recipientFirstForCopy,
                  shareUrl: claimUrl,
                });
              }
              // If dismissed: silent. The postcard is in the journal
              // and the user can re-share from PostcardDetailSheet.
            })
            .catch(() => {
              // Real error opening the share sheet — surface nothing
              // intrusive. The card still exists; they can re-share
              // from My Card → Journal → tap card → "Share again".
            });
        }, 300);
        // Bail out of commitSignupAndSend — we already called onComplete
        // and don't want to setStep("mailed") below.
        return;
      } else if (recipientKind === "self") {
        // Send to yourself: create a friend row with your own address
        // (so future repeat-sends to self work) and send.
        const result = await addFriendByAddress({
          name: `${yourFirstName.trim()} (me)`,
          city: yourAddress.city.trim(),
          state: yourAddress.state.trim().toUpperCase(),
          addressLine1: yourAddress.line1.trim(),
          addressLine2: yourAddress.line2.trim() || undefined,
          addressCity: yourAddress.city.trim(),
          addressState: yourAddress.state.trim().toUpperCase(),
          addressZip: yourAddress.zip.trim(),
          addressCountry: "US",
        });
        if (!result.ok || !result.friend) {
          throw new Error("Couldn't set up self-send.");
        }
        const sendRes = await sendPostcard({
          kind: "photo",
          friendId: result.friend.id,
          photoUri: photoUri ?? "",
          message: message.trim(),
          friend: result.friend,
        });
        if (!sendRes.ok) {
          throw new Error("Couldn't mail the card.");
        }
        // v0.7.0.8: hand off to Lob — same path as friend, recipient = self.
        if (sendRes.postcardId) {
          const lobResult = await submitWelcomePostcardToLob(sendRes.postcardId, {
            photoUri: photoUri ?? "",
            message: message.trim(),
            recipient: {
              name: result.friend.name,
              city: result.friend.addressCity || result.friend.city || "",
              state: result.friend.addressState || result.friend.state || "",
              addressLine1: result.friend.addressLine1,
              addressLine2: result.friend.addressLine2,
              zip: result.friend.addressZip,
            },
            sender: {
              name: yourFirstName.trim() || "You",
              city: yourAddress.city.trim(),
              state: yourAddress.state.trim().toUpperCase(),
            },
          });
          if (!lobResult.ok) {
            // v0.7.0.17: refund the credit on Lob failure. See friend path
            // above for the full rationale.
            await refundPostcardCredit(sendRes.postcardId);
            await refreshProfile();
            throw new Error(humanizeLobError(lobResult.error));
          }
        }
      } else if (recipientKind === "penpal") {
        // v0.7.0.1: pen pal is wired through sendIntoVoid — the existing
        // anonymous "send to a stranger" backend. The card queues; a
        // Mailroom-curated recipient is assigned later. From the
        // sender&apos;s POV: card is mailed, app opens, they&apos;re in.
        const note = message.trim();
        // v0.7.0.25: pass photoUri so penpal sends carry a real photo
        // (was hardcoded null before, blank tiles in the journal).
        const voidRes = await sendIntoVoid(note, photoUri ?? undefined);
        if (!voidRes.ok) {
          throw new Error("Couldn't send to a pen pal. Try again in a moment.");
        }
      } else {
        // Unknown recipient kind — defensive.
        throw new Error("Pick a recipient first.");
      }

      setStep("mailed");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't finish signup.");
    } finally {
      setSaving(false);
    }
  }

  // ----- Linear nav --------------------------------------------------------

  function back() {
    setError(null);
    if (step === "auth-email") setStep("hero");
    else if (step === "explain") setStep(authed ? "hero" : "auth-email");
    else if (step === "photo") setStep("explain");
    else if (step === "note") setStep("photo");
    else if (step === "recipient") setStep("note");
    else if (step === "their-info") setStep("recipient");
    else if (step === "your-info") {
      // Only "friend" goes through their-info. Everything else skips
      // straight from recipient → your-info, so back goes to recipient.
      setStep(needsTheirInfo ? "their-info" : "recipient");
    } else if (step === "mailed") setStep("your-info");
  }

  function next() {
    setError(null);
    if (step === "explain") setStep("photo");
    else if (step === "recipient") {
      setStep(needsTheirInfo ? "their-info" : "your-info");
    } else if (step === "their-info") {
      setStep("your-info");
    }
  }

  // Fast-forward (dev / no-backend escape hatch).
  async function maybeFastForward() {
    if (!SUPABASE_CONFIGURED) {
      await completeSignup({ name: "", city: "", state: "" });
      onComplete();
    }
  }

  // ----- Render ------------------------------------------------------------

  return (
    <>
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        // Forced flow: no back-out from the modal.
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: colors.paper }}
      >
        <ScrollView
          contentContainerStyle={styles.root}
          keyboardShouldPersistTaps="handled"
        >
          {step !== "hero" && step !== "mailed" ? (
            <Pressable onPress={back} style={styles.backBtn} testID="welcome-back">
              <ArrowLeft color={colors.ink} size={20} strokeWidth={1.8} />
              <Text style={styles.backBtnText}>Back</Text>
            </Pressable>
          ) : null}

          {step === "hero" ? (
            <HeroStep
              onAppleSignIn={onAppleSignIn}
              onSwitchToEmail={() => setStep("auth-email")}
              appleAvailable={appleAvailable}
              saving={saving}
              error={error}
              info={info}
              pendingInviteCopy={pendingInviteCopy}
              fastForward={maybeFastForward}
            />
          ) : null}

          {step === "auth-email" ? (
            <EmailAuthStep
              mode={emailMode}
              onModeChange={setEmailMode}
              email={email}
              onEmailChange={setEmail}
              password={password}
              onPasswordChange={setPassword}
              onSubmit={onSubmitEmailAuth}
              onForgot={onForgotPassword}
              canSubmit={canAdvanceEmail}
              saving={saving}
              error={error}
              info={info}
            />
          ) : null}

          {step === "explain" ? (
            <ExplainStep onContinue={() => setStep("photo")} />
          ) : null}

          {step === "photo" ? (
            <PhotoStep
              photoUri={photoUri}
              onPickPhoto={pickPhoto}
              canContinue={canAdvancePhoto}
              onContinue={() => setStep("note")}
            />
          ) : null}

          {step === "note" ? (
            <NoteStep
              message={message}
              onMessageChange={setMessage}
              canContinue={canAdvanceNote}
              onContinue={() => setStep("recipient")}
            />
          ) : null}

          {step === "recipient" ? (
            <RecipientStep
              kind={recipientKind}
              onPick={setRecipientKind}
              canContinue={canAdvanceRecipient}
              onContinue={next}
            />
          ) : null}

          {step === "their-info" && needsTheirInfo ? (
            <TheirInfoStep
              kind={recipientKind ?? "friend"}
              theirName={theirName}
              onTheirNameChange={setTheirName}
              theirAddress={theirAddress}
              onTheirAddressChange={setTheirAddress}
              theirContact={theirContact}
              onTheirContactChange={setTheirContact}
              canContinue={canAdvanceTheirInfo}
              onContinue={() => setStep("your-info")}
            />
          ) : null}

          {step === "your-info" ? (
            <YourInfoStep
              firstName={yourFirstName}
              onFirstNameChange={setYourFirstName}
              presetFirstName={presetFirstName}
              address={yourAddress}
              onAddressChange={setYourAddress}
              canContinue={canAdvanceYourInfo}
              onContinue={commitSignupAndSend}
              saving={saving}
              error={error}
              needsFullAddress={needsFullYourAddress}
            />
          ) : null}

          {step === "mailed" ? (
            <MailedStep
              recipientName={theirName.trim() || (recipientKind === "self" ? yourFirstName.trim() : "your friend")}
              shareUrl={shareUrl}
              onDismiss={() => {
                // v0.7.0.18: for the link path, fire Share.share AFTER the
                // modal dismisses. iOS blocks UIActivityViewController
                // from presenting over a fullScreen Modal — the share
                // sheet either never appears or sits behind the modal.
                // 300ms is enough for iOS to tear down the modal's view
                // controller before we ask for a new presentation.
                const pendingUrl = shareUrl;
                onComplete();
                if (pendingUrl) {
                  setTimeout(() => {
                    Share.share({
                      message: `I sent you a postcard on Mailroom. Tap to claim it — ${pendingUrl}`,
                      url: pendingUrl,
                    }).catch(() => {
                      // share dismissed — URL is still visible on the
                      // MailedStep so the user can long-press to copy.
                    });
                  }, 300);
                }
              }}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    {/* v0.7.0.11 CRITICAL FIX: off-screen print views moved OUTSIDE the
        Modal. iOS Modal presents inside a separate UIViewController, and
        react-native-view-shot can't reliably capture views inside that
        modal hierarchy — capture either returns an empty PNG or errors
        silently. The audit on build 17 found `lob_id` was always null
        for welcome-flow sends because the capture step never produced
        valid PNGs. Mounting these as a sibling to the Modal puts them
        in the regular RN view tree where view-shot works (same pattern
        as `app/(tabs)/send.tsx`). Only rendered while `visible` is true
        so we're not wasting paint cycles when WelcomeSheet is dormant. */}
    {visible ? (
      <View
        style={welcomeOffscreenStyle.offscreen}
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
          recipient={
            printSnapshot?.recipient ?? {
              name: theirName.trim() || "Recipient",
              city: theirAddress.city,
              state: theirAddress.state,
              addressLine1: theirAddress.line1,
              addressLine2: theirAddress.line2,
              zip: theirAddress.zip,
            }
          }
          sender={
            printSnapshot?.sender ?? {
              name: yourFirstName.trim() || "You",
              city: yourAddress.city,
              state: yourAddress.state,
            }
          }
          width={PRINT_W}
        />
      </View>
    ) : null}
    </>
  );
}

const welcomeOffscreenStyle = StyleSheet.create({
  offscreen: { left: -10000, position: "absolute", top: -10000 },
});

// ============================================================================
// STEP 1 — HERO (unchanged from v0.6.1 build 8, just the tagline)
// ============================================================================

function HeroStep({
  onAppleSignIn,
  onSwitchToEmail,
  appleAvailable,
  saving,
  error,
  info,
  pendingInviteCopy,
  fastForward,
}: {
  onAppleSignIn: () => void;
  onSwitchToEmail: () => void;
  appleAvailable: boolean;
  saving: boolean;
  error: string | null;
  info: string | null;
  pendingInviteCopy: string | null;
  fastForward: () => void;
}) {
  return (
    <View style={heroStyles.wrap} testID="welcome-step-hero">
      <View style={heroStyles.artFrame}>
        <Image
          source={HERO_FOLK_MAP}
          style={heroStyles.art}
          resizeMode="cover"
          accessibilityLabel="Postcards across America"
        />
      </View>
      <View style={heroStyles.textBlock}>
        <Text style={heroStyles.wordmark}>Mailroom</Text>
        <Text style={heroStyles.tagline}>Mail a memory for less than a stamp.</Text>
      </View>

      {pendingInviteCopy ? (
        <View style={heroStyles.inviteNote} testID="welcome-pending-invite">
          <Text style={heroStyles.inviteKicker}>YOU HAVE MAIL</Text>
          <Text style={heroStyles.inviteBody}>{pendingInviteCopy}</Text>
        </View>
      ) : null}

      <View style={heroStyles.actions}>
        {appleAvailable && Platform.OS === "ios" ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={12}
            style={heroStyles.appleBtn}
            onPress={onAppleSignIn}
          />
        ) : null}
        <Pressable
          onPress={onSwitchToEmail}
          style={heroStyles.emailLink}
          testID="welcome-switch-email"
          disabled={saving}
        >
          <Text style={heroStyles.emailLinkText}>Sign up with email →</Text>
        </Pressable>
        {error ? (
          <Text style={heroStyles.error} testID="welcome-error">
            {error}
          </Text>
        ) : null}
        {info && !error ? (
          <Text style={heroStyles.infoHint} testID="welcome-info">
            {info}
          </Text>
        ) : null}
        {!SUPABASE_CONFIGURED ? (
          <Pressable onPress={fastForward} style={heroStyles.devSkip} testID="welcome-dev-skip">
            <Text style={heroStyles.devSkipText}>Dev: skip auth</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const heroStyles = StyleSheet.create({
  wrap: { flex: 1, gap: 18 },
  artFrame: { aspectRatio: 1, borderRadius: 18, overflow: "hidden", width: "100%" },
  art: { width: "100%", height: "100%" },
  textBlock: { alignItems: "center", gap: 10, marginTop: 4 },
  wordmark: { color: colors.ink, fontFamily: fonts.script, fontSize: 44, lineHeight: 46 },
  tagline: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 22,
    lineHeight: 28,
    textAlign: "center",
    letterSpacing: -0.2,
    paddingHorizontal: 24,
  },
  inviteNote: {
    backgroundColor: "rgba(60,110,143,0.08)",
    borderColor: "rgba(60,110,143,0.3)",
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 14,
    marginTop: 4,
  },
  inviteKicker: { color: colors.postalBlue, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 1.6 },
  inviteBody: { color: colors.ink, fontFamily: fonts.serifItalic, fontSize: 14, lineHeight: 19 },
  actions: { gap: 10, marginTop: 12, marginBottom: 8 },
  appleBtn: { height: 50, width: "100%" },
  emailLink: { alignItems: "center", paddingVertical: 12 },
  emailLinkText: {
    color: colors.postalBlue,
    fontFamily: fonts.serifSemi,
    fontSize: 15,
    textDecorationLine: "underline",
  },
  error: {
    color: colors.postalRed,
    fontFamily: fonts.serifSemi,
    fontSize: 13,
    marginTop: 4,
    textAlign: "center",
  },
  infoHint: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    marginTop: 6,
    textAlign: "center",
  },
  devSkip: { alignItems: "center", marginTop: 12, opacity: 0.5 },
  devSkipText: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12 },
});

// ============================================================================
// STEP 1b — EMAIL AUTH (unchanged from v0.6.1 build 8)
// ============================================================================

function EmailAuthStep({
  mode,
  onModeChange,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  onSubmit,
  onForgot,
  canSubmit,
  saving,
  error,
  info,
}: {
  mode: "signup" | "signin";
  onModeChange: (m: "signup" | "signin") => void;
  email: string;
  onEmailChange: (v: string) => void;
  password: string;
  onPasswordChange: (v: string) => void;
  onSubmit: () => void;
  onForgot: () => void;
  canSubmit: boolean;
  saving: boolean;
  error: string | null;
  info: string | null;
}) {
  return (
    <View style={stepStyles.wrap} testID="welcome-step-auth-email">
      <Text style={stepStyles.title}>
        {mode === "signup" ? "Make an account." : "Welcome back."}
      </Text>
      <Text style={stepStyles.subtitle}>
        {mode === "signup"
          ? "Email + password is fine. Or go back and use Apple Sign In."
          : "Sign in with the email + password you used before."}
      </Text>

      <View style={emailStyles.field}>
        <Text style={emailStyles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={onEmailChange}
          placeholder="you@example.com"
          placeholderTextColor={colors.mutedInk}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          style={emailStyles.input}
          testID="welcome-email"
        />
      </View>
      <View style={emailStyles.field}>
        <Text style={emailStyles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={onPasswordChange}
          placeholder="at least 8 characters"
          placeholderTextColor={colors.mutedInk}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType={mode === "signup" ? "newPassword" : "password"}
          style={emailStyles.input}
          testID="welcome-password"
        />
      </View>

      {error ? <Text style={emailStyles.error}>{error}</Text> : null}
      {info ? <Text style={emailStyles.info}>{info}</Text> : null}

      <PrimaryButton
        title={
          saving
            ? mode === "signup"
              ? "Creating account..."
              : "Signing in..."
            : mode === "signup"
              ? "Continue →"
              : "Sign in"
        }
        icon={ArrowRight}
        onPress={onSubmit}
        disabled={!canSubmit || saving}
        style={emailStyles.submitBtn}
      />

      <View style={emailStyles.swapRow}>
        <Pressable
          onPress={() => onModeChange(mode === "signup" ? "signin" : "signup")}
          testID="welcome-swap-mode"
        >
          <Text style={emailStyles.swapText}>
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </Text>
        </Pressable>
        {mode === "signin" ? (
          <Pressable onPress={onForgot} testID="welcome-forgot">
            <Text style={emailStyles.forgot}>Forgot password</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const emailStyles = StyleSheet.create({
  field: { gap: 6, marginTop: 14 },
  label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 13 },
  input: {
    backgroundColor: "rgba(245, 240, 230, 0.6)",
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1.2,
    color: colors.ink,
    fontFamily: fonts.serif,
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  error: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 13, marginTop: 8 },
  info: { color: colors.postalBlue, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 8 },
  submitBtn: { marginTop: 18 },
  swapRow: { alignItems: "center", gap: 10, marginTop: 16 },
  swapText: {
    color: colors.postalBlue,
    fontFamily: fonts.serifSemi,
    fontSize: 14,
    textDecorationLine: "underline",
  },
  forgot: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13 },
});

// ============================================================================
// STEP 1.5 — EXPLAIN (post-auth interstitial)
// ============================================================================
//
// v0.7.0.2: bridges the "Sign in → Pick the photo" gap, which felt jarring
// in user testing. Brief Recraft hero, the WHAT and the HOW in two lines,
// "Got it" continue. No step dots — this isn't part of the data-collection
// flow, it's the welcome to the data-collection flow.

function ExplainStep({ onContinue }: { onContinue: () => void }) {
  return (
    <View style={[stepStyles.wrap, { gap: 0 }]} testID="welcome-step-explain">
      <View style={explainStyles.artFrame}>
        <Image
          source={HERO_MAILBOX}
          style={explainStyles.art}
          resizeMode="cover"
          accessibilityLabel="A hand reaching into a mailbox"
        />
      </View>

      <Text style={explainStyles.kicker}>YOUR FIRST CARD IS ON US</Text>

      <Text style={[stepStyles.title, { textAlign: "center", marginTop: 6 }]}>
        Pick a photo.{"\n"}Mail it.
      </Text>

      <Text
        style={[
          stepStyles.subtitle,
          { textAlign: "center", marginTop: 14, paddingHorizontal: 10 },
        ]}
      >
        Pick a photo, write a note. We print it, stamp it, and drop it in the mail through USPS.
      </Text>

      <PrimaryButton
        title="Got it →"
        onPress={onContinue}
        style={explainStyles.gotItBtn}
        testID="welcome-explain-continue"
      />
    </View>
  );
}

const explainStyles = StyleSheet.create({
  artFrame: {
    aspectRatio: 1,
    borderRadius: 18,
    overflow: "hidden",
    width: "70%",
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 18,
  },
  art: { width: "100%", height: "100%" },
  kicker: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.6,
    textAlign: "center",
    marginTop: 4,
  },
  gotItBtn: { marginTop: 32 },
});

// ============================================================================
// STEP 2 — PHOTO PICK
// ============================================================================

function PhotoStep({
  photoUri,
  onPickPhoto,
  canContinue,
  onContinue,
}: {
  photoUri: string | null;
  onPickPhoto: () => void;
  canContinue: boolean;
  onContinue: () => void;
}) {
  return (
    <View style={stepStyles.wrap} testID="welcome-step-photo">
      <StepDots count={5} active={0} />
      <Text style={stepStyles.title}>Pick the photo.</Text>
      <Text style={stepStyles.subtitle}>
        The moment that meant something. Your phone&apos;s camera roll, 3:2 crop.
      </Text>

      <Pressable onPress={onPickPhoto} style={photoStyles.frame} testID="welcome-photo-pick">
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={photoStyles.image} resizeMode="cover" />
        ) : (
          <View style={photoStyles.empty}>
            <ImageIcon color={colors.mutedInk} size={40} strokeWidth={1.4} />
            <Text style={photoStyles.emptyText}>Tap to pick a photo</Text>
          </View>
        )}
      </Pressable>

      <PrimaryButton
        title="Continue →"
        onPress={onContinue}
        disabled={!canContinue}
        style={stepStyles.continueBtn}
        testID="welcome-photo-continue"
      />
    </View>
  );
}

const photoStyles = StyleSheet.create({
  frame: {
    aspectRatio: 3 / 2,
    backgroundColor: colors.paperDark,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    marginTop: 20,
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  empty: { alignItems: "center", flex: 1, gap: 10, justifyContent: "center" },
  emptyText: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14 },
});

// ============================================================================
// STEP 3 — NOTE
// ============================================================================

function NoteStep({
  message,
  onMessageChange,
  canContinue,
  onContinue,
}: {
  message: string;
  onMessageChange: (v: string) => void;
  canContinue: boolean;
  onContinue: () => void;
}) {
  return (
    <View style={stepStyles.wrap} testID="welcome-step-note">
      <StepDots count={5} active={1} />
      <Text style={stepStyles.title}>Write them a note.</Text>
      <Text style={stepStyles.subtitle}>
        A line or two on the back. It&apos;s a postcard, not an email.
      </Text>
      <TextInput
        value={message}
        onChangeText={onMessageChange}
        placeholder="the hike we kept saying we'd do —"
        placeholderTextColor={colors.mutedInk}
        autoFocus
        multiline
        maxLength={280}
        style={noteStyles.input}
        testID="welcome-note"
      />
      <Text style={noteStyles.counter}>{message.length} / 280</Text>
      <PrimaryButton
        title="Continue →"
        onPress={onContinue}
        disabled={!canContinue}
        style={stepStyles.continueBtn}
        testID="welcome-note-continue"
      />
    </View>
  );
}

const noteStyles = StyleSheet.create({
  input: {
    backgroundColor: "rgba(245, 240, 230, 0.6)",
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1.5,
    color: colors.ink,
    fontFamily: fonts.script,
    fontSize: 22,
    marginTop: 20,
    minHeight: 140,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    textAlignVertical: "top",
    lineHeight: 28,
  },
  counter: {
    color: colors.mutedInk,
    fontFamily: fonts.sans,
    fontSize: 11,
    marginTop: 6,
    textAlign: "right",
  },
});

// ============================================================================
// STEP 4 — RECIPIENT
// ============================================================================

function RecipientStep({
  kind,
  onPick,
  canContinue,
  onContinue,
}: {
  kind: RecipientKind | null;
  onPick: (k: RecipientKind) => void;
  canContinue: boolean;
  onContinue: () => void;
}) {
  return (
    <View style={stepStyles.wrap} testID="welcome-step-recipient">
      <StepDots count={5} active={2} />
      <Text style={stepStyles.title}>Who&apos;s it for?</Text>
      <Text style={stepStyles.subtitle}>
        Pick one. You can always mail another later.
      </Text>

      <RecipientOption
        kind="friend"
        selected={kind === "friend"}
        title="Someone I know"
        sub="Friend, family, anyone with an address"
        Icon={UsersIcon}
        onPress={() => onPick("friend")}
        testID="welcome-recipient-friend"
      />
      <RecipientOption
        kind="link"
        selected={kind === "link"}
        title="Send them a link"
        sub="Don't have their address? We'll ask them."
        Icon={LinkIcon}
        onPress={() => onPick("link")}
        testID="welcome-recipient-link"
      />
      <RecipientOption
        kind="self"
        selected={kind === "self"}
        title="Send it to myself"
        sub="Future you will thank past you"
        Icon={UserIcon}
        onPress={() => onPick("self")}
        testID="welcome-recipient-self"
      />
      <RecipientOption
        kind="penpal"
        selected={kind === "penpal"}
        title="A pen pal"
        sub="Send one, get one from a stranger"
        Icon={UsersIcon}
        onPress={() => onPick("penpal")}
        testID="welcome-recipient-penpal"
      />

      <PrimaryButton
        title="Continue →"
        onPress={onContinue}
        disabled={!canContinue}
        style={stepStyles.continueBtn}
        testID="welcome-recipient-continue"
      />
    </View>
  );
}

function RecipientOption({
  selected,
  title,
  sub,
  Icon,
  onPress,
  testID,
  disabled,
}: {
  kind: RecipientKind;
  selected: boolean;
  title: string;
  sub: string;
  Icon: any;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        recipientStyles.option,
        selected && recipientStyles.optionSelected,
        disabled && recipientStyles.optionDisabled,
        pressed && !disabled && { opacity: 0.85 },
      ]}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
    >
      <View style={recipientStyles.iconBox}>
        <Icon color={colors.ink} size={20} strokeWidth={1.7} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={recipientStyles.title}>{title}</Text>
        <Text style={recipientStyles.sub}>{sub}</Text>
      </View>
      {selected ? <Text style={recipientStyles.check}>✓</Text> : null}
    </Pressable>
  );
}

const recipientStyles = StyleSheet.create({
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    marginTop: 10,
  },
  optionSelected: {
    borderColor: colors.ink,
    borderWidth: 2,
    backgroundColor: colors.paper,
  },
  optionDisabled: { opacity: 0.55 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.paperDark,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15, lineHeight: 18 },
  sub: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, marginTop: 2 },
  check: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 18, marginLeft: 6 },
});

// ============================================================================
// STEP 5 — THEIR INFO  (friend: name + address  |  link: name + contact)
// ============================================================================

function TheirInfoStep({
  kind,
  theirName,
  onTheirNameChange,
  theirAddress,
  onTheirAddressChange,
  theirContact,
  onTheirContactChange,
  canContinue,
  onContinue,
}: {
  kind: RecipientKind;
  theirName: string;
  onTheirNameChange: (v: string) => void;
  theirAddress: AddressDraft;
  onTheirAddressChange: (a: AddressDraft) => void;
  theirContact: string;
  onTheirContactChange: (v: string) => void;
  canContinue: boolean;
  onContinue: () => void;
}) {
  const isLink = kind === "link";
  return (
    <View style={stepStyles.wrap} testID="welcome-step-their-info">
      <StepDots count={5} active={3} />
      <Text style={stepStyles.title}>Where to?</Text>
      <Text style={stepStyles.subtitle}>
        {isLink
          ? "We'll text or email them a link to enter their address."
          : "Just for the envelope. Never shared with anyone else."}
      </Text>

      <FieldLabel>Their name</FieldLabel>
      <TextInput
        value={theirName}
        onChangeText={onTheirNameChange}
        placeholder="Maya Chen"
        placeholderTextColor={colors.mutedInk}
        autoCapitalize="words"
        autoCorrect={false}
        textContentType="name"
        style={fieldStyles.input}
        testID="welcome-their-name"
      />

      {isLink ? (
        <>
          <FieldLabel style={{ marginTop: 14 }}>Their phone or email</FieldLabel>
          <TextInput
            value={theirContact}
            onChangeText={onTheirContactChange}
            placeholder="555 123 4567  or  maya@example.com"
            placeholderTextColor={colors.mutedInk}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={fieldStyles.input}
            testID="welcome-their-contact"
          />
        </>
      ) : (
        <AddressFields
          address={theirAddress}
          onChange={onTheirAddressChange}
          testIDPrefix="welcome-their"
        />
      )}

      <PrimaryButton
        title="Continue →"
        onPress={onContinue}
        disabled={!canContinue}
        style={stepStyles.continueBtn}
        testID="welcome-their-continue"
      />
    </View>
  );
}

// ============================================================================
// STEP 6 — YOUR INFO  (sender name + address)
// ============================================================================

function YourInfoStep({
  firstName,
  onFirstNameChange,
  presetFirstName,
  address,
  onAddressChange,
  canContinue,
  onContinue,
  saving,
  error,
  needsFullAddress,
}: {
  firstName: string;
  onFirstNameChange: (v: string) => void;
  presetFirstName: string;
  address: AddressDraft;
  onAddressChange: (a: AddressDraft) => void;
  canContinue: boolean;
  onContinue: () => void;
  saving: boolean;
  error: string | null;
  /** True only for "self" sends — we need the full mailable address since
   * the user IS the recipient. For friend/link/penpal, we only collect
   * name + city + state for the postcard back caption. */
  needsFullAddress: boolean;
}) {
  return (
    <View style={stepStyles.wrap} testID="welcome-step-your-info">
      <StepDots count={5} active={4} />
      <Text style={stepStyles.title}>From you.</Text>
      <Text style={stepStyles.subtitle}>
        {needsFullAddress
          ? "We need your address so we can mail the card to you. Stays private."
          : "We print \"from your city\" on the back. Your full address stays private."}
      </Text>

      <FieldLabel>Your first name</FieldLabel>
      <TextInput
        value={firstName}
        onChangeText={onFirstNameChange}
        placeholder={presetFirstName || "Scotty"}
        placeholderTextColor={colors.mutedInk}
        autoCapitalize="words"
        autoCorrect={false}
        textContentType="givenName"
        style={fieldStyles.input}
        testID="welcome-your-firstname"
      />

      {needsFullAddress ? (
        <AddressFields
          address={address}
          onChange={onAddressChange}
          testIDPrefix="welcome-your"
          label="Your address"
        />
      ) : (
        // v0.7.0.17: minimal city/state pair for non-self sends. The full
        // street address isn't used downstream (link/penpal sends use the
        // Mailroom return address, the postcard back only shows the city).
        // Keeping the same AddressDraft shape so commitSignupAndSend's
        // existing read paths work without branching.
        <View testID="welcome-your-citystate">
          <FieldLabel>Your city &amp; state</FieldLabel>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={address.city}
              onChangeText={(v) => onAddressChange({ ...address, city: v })}
              placeholder="Brooklyn"
              placeholderTextColor={colors.mutedInk}
              autoCapitalize="words"
              autoCorrect={false}
              textContentType="addressCity"
              style={[fieldStyles.input, { flex: 2 }]}
              testID="welcome-your-city"
            />
            <TextInput
              value={address.state}
              onChangeText={(v) => onAddressChange({ ...address, state: v.toUpperCase().slice(0, 2) })}
              placeholder="NY"
              placeholderTextColor={colors.mutedInk}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={2}
              textContentType="addressState"
              style={[fieldStyles.input, { flex: 1 }]}
              testID="welcome-your-state"
            />
          </View>
        </View>
      )}

      {error ? <Text style={fieldStyles.error}>{error}</Text> : null}

      <PrimaryButton
        title={saving ? "Mailing it..." : "Mail it →"}
        onPress={onContinue}
        disabled={!canContinue || saving}
        style={stepStyles.continueBtn}
        testID="welcome-your-continue"
      />
    </View>
  );
}

// ============================================================================
// STEP 7 — MAILED CELEBRATION
// ============================================================================

/**
 * MailedStep — v0.7.1 D.1 magical moment: the fold animation.
 *
 * Animation sequence (~900ms total) on mount:
 *   t=0      photo card visible at scale 1, no envelope
 *   t=150ms  photo card scales down to 0.65 + slides up slightly (the
 *            "compose" beat)
 *   t=300ms  envelope back fades in behind the card with a slight
 *            scale-up (~0.05 → 0.95 final)
 *   t=500ms  envelope flap rotates 0deg → 180deg around its top edge —
 *            this is the fold itself
 *   t=750ms  postal-red "MAILED" rubber-stamp scales in from 1.4 to 1.0
 *            with a slight rotation, lands with the haptic thunk
 *   t=900ms  caption fades in below
 *
 * Built with react-native-reanimated 4. All animations run on the UI
 * thread via shared values — no JS-thread frame loop. The haptic
 * `mailboxThunk` fires from the parent on send-success, so this
 * component is purely visual.
 *
 * If reanimated isn&apos;t available (some test environments mock it
 * out), the animation degrades to a static "MAILED" stamp + caption
 * without breaking the screen.
 */
function MailedStep({
  recipientName,
  shareUrl,
  onDismiss,
}: {
  recipientName: string;
  /** Send-link path: the claim URL the user should share with the
   *  recipient. When present, MailedStep replaces the "Open Mailroom"
   *  copy with "Share the link" and surfaces the URL as selectable text
   *  underneath so the user can long-press to copy if iOS blocks the
   *  share sheet for any reason. */
  shareUrl?: string | null;
  onDismiss: () => void;
}) {
  // v0.7.0.24: hero is now a hand-drawn envelope-shaped hot-air balloon
  // (Recraft variant B, picked by user). Animation reads as a balloon
  // actually taking flight:
  //   - Rises up from below the stage (translateY)
  //   - Eases into a gentle continuous bob (sin-wave loop on Y + slight rotate)
  //   - Three small envelopes still fly out around it
  //   - MAILED stamp slams in last
  const heroScale = useSharedValue(0.85);
  const heroOpacity = useSharedValue(0);
  const heroTranslateY = useSharedValue(80); // starts below the stage
  const heroBob = useSharedValue(0); // continuous loop, ±6px sway
  const heroSway = useSharedValue(0); // continuous loop, ±2deg rotation
  const env1X = useSharedValue(0);
  const env1Y = useSharedValue(0);
  const env1Opacity = useSharedValue(0);
  const env2X = useSharedValue(0);
  const env2Y = useSharedValue(0);
  const env2Opacity = useSharedValue(0);
  const env3X = useSharedValue(0);
  const env3Y = useSharedValue(0);
  const env3Opacity = useSharedValue(0);
  const stampScale = useSharedValue(0);
  // v0.7.0.25: start tilted further so the slam-in feels weighty,
  // settle at -12deg in the corner (reads as a real-world rubber-stamp
  // press, not a centered overlay).
  const stampRotate = useSharedValue(-22);
  const captionOpacity = useSharedValue(0);
  const captionTranslateY = useSharedValue(12);

  useEffect(() => {
    // BEAT 1 (0-700ms): balloon rises from below the stage, opacity in.
    // Slow ease-out matching the "filling with hot air, lifting off" beat.
    heroOpacity.value = withTiming(1, { duration: 500 });
    heroTranslateY.value = withTiming(0, {
      duration: 700,
      easing: Easing.bezier(0.16, 1, 0.3, 1), // strong ease-out, lands smooth
    });
    heroScale.value = withTiming(1, {
      duration: 700,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });

    // BEAT 1.5 (after entry): continuous floating loop, calmer.
    //
    // v0.7.0.25: previous values (±6px, ±2deg, 1.2-1.6s periods) read
    // as "bouncing side to side" to the user — too active for a
    // celebration moment. Slowed to ±4px Y / ±1deg rotation with
    // longer 2.4s/3.2s periods so the balloon breathes instead of
    // bouncing. Total motion is half the previous amplitude, twice
    // the period — much more "lazy hot-air balloon in still air"
    // than the original "jittery flag" feel.
    heroBob.value = withDelay(
      700,
      withRepeat(
        withSequence(
          withTiming(-4, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
          withTiming(4, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        ),
        -1, // infinite
        false,
      ),
    );
    heroSway.value = withDelay(
      700,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
          withTiming(-1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );

    // BEAT 2 (300-900ms): three envelope dots fly out from the hero
    // in different directions, suggesting the card joining many others
    // in transit. Staggered launches make it feel alive.
    env1Opacity.value = withDelay(300, withTiming(1, { duration: 120 }));
    env1X.value = withDelay(300, withTiming(-120, { duration: 600, easing: Easing.bezier(0.2, 0.7, 0.3, 1) }));
    env1Y.value = withDelay(300, withTiming(-90, { duration: 600, easing: Easing.bezier(0.2, 0.7, 0.3, 1) }));

    env2Opacity.value = withDelay(420, withTiming(1, { duration: 120 }));
    env2X.value = withDelay(420, withTiming(110, { duration: 600, easing: Easing.bezier(0.2, 0.7, 0.3, 1) }));
    env2Y.value = withDelay(420, withTiming(-70, { duration: 600, easing: Easing.bezier(0.2, 0.7, 0.3, 1) }));

    env3Opacity.value = withDelay(540, withTiming(1, { duration: 120 }));
    env3X.value = withDelay(540, withTiming(80, { duration: 600, easing: Easing.bezier(0.2, 0.7, 0.3, 1) }));
    env3Y.value = withDelay(540, withTiming(95, { duration: 600, easing: Easing.bezier(0.2, 0.7, 0.3, 1) }));

    // BEAT 3 (800-1100ms): MAILED rubber-stamp slams in, big bouncy
    // overshoot. The haptic thunk fires elsewhere on send-success.
    stampScale.value = withDelay(800, withTiming(1, {
      duration: 320,
      easing: Easing.bezier(0.34, 1.7, 0.5, 1), // springier
    }));
    stampRotate.value = withDelay(800, withTiming(-12, { duration: 320 }));

    // BEAT 4 (1100ms+): caption fades in and rises slightly
    captionOpacity.value = withDelay(1100, withTiming(1, { duration: 400 }));
    captionTranslateY.value = withDelay(1100, withTiming(0, { duration: 400 }));
  }, [
    heroOpacity, heroScale, heroTranslateY, heroBob, heroSway,
    env1Opacity, env1X, env1Y,
    env2Opacity, env2X, env2Y,
    env3Opacity, env3X, env3Y,
    stampScale, stampRotate,
    captionOpacity, captionTranslateY,
  ]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [
      // Initial rise (BEAT 1) + continuous bob (loop) compose into the
      // visible Y position. Same for sway/scale — combine all into one
      // transform stack so Reanimated drives them together.
      { translateY: heroTranslateY.value + heroBob.value },
      { rotate: `${heroSway.value}deg` },
      { scale: heroScale.value },
    ],
  }));
  const env1Style = useAnimatedStyle(() => ({
    opacity: env1Opacity.value,
    transform: [
      { translateX: env1X.value },
      { translateY: env1Y.value },
      { rotate: "-12deg" },
    ],
  }));
  const env2Style = useAnimatedStyle(() => ({
    opacity: env2Opacity.value,
    transform: [
      { translateX: env2X.value },
      { translateY: env2Y.value },
      { rotate: "8deg" },
    ],
  }));
  const env3Style = useAnimatedStyle(() => ({
    opacity: env3Opacity.value,
    transform: [
      { translateX: env3X.value },
      { translateY: env3Y.value },
      { rotate: "16deg" },
    ],
  }));
  const stampStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: stampScale.value },
      { rotate: `${stampRotate.value}deg` },
    ],
  }));
  const captionStyle = useAnimatedStyle(() => ({
    opacity: captionOpacity.value,
    transform: [{ translateY: captionTranslateY.value }],
  }));

  return (
    <View style={[stepStyles.wrap, { alignItems: "center" }]} testID="welcome-step-mailed">
      <View style={mailedStyles.stage}>
        {/* v0.7.0.24: hand-drawn envelope-balloon hero, with a rise-and-bob
            animation that makes it look like the postcard is genuinely
            taking flight. (Recraft hand_drawn style, user-picked variant B
            from the Recraft gallery.) */}
        <Animated.View style={[mailedStyles.heroFrame, heroStyle]}>
          <Image
            source={HERO_ENVELOPE_BALLOON}
            style={mailedStyles.heroImage}
            resizeMode="cover"
          />
        </Animated.View>

        {/* Three envelopes flying outward — the constellation forming */}
        <Animated.View style={[mailedStyles.flyingEnvelope, env1Style]} pointerEvents="none">
          <View style={mailedStyles.envelopeShape}>
            <View style={mailedStyles.envelopeFlap} />
          </View>
        </Animated.View>
        <Animated.View style={[mailedStyles.flyingEnvelope, env2Style]} pointerEvents="none">
          <View style={mailedStyles.envelopeShape}>
            <View style={mailedStyles.envelopeFlap} />
          </View>
        </Animated.View>
        <Animated.View style={[mailedStyles.flyingEnvelope, env3Style]} pointerEvents="none">
          <View style={mailedStyles.envelopeShape}>
            <View style={mailedStyles.envelopeFlap} />
          </View>
        </Animated.View>

        {/* MAILED rubber stamp — slams in last with a big overshoot */}
        <Animated.View style={[mailedStyles.stamp, stampStyle]} pointerEvents="none">
          <Text style={mailedStyles.stampText}>MAILED</Text>
        </Animated.View>
      </View>

      <Animated.View style={captionStyle}>
        <Text style={mailedStyles.kicker}>
          {shareUrl ? "YOUR CARD IS READY TO SHARE" : "YOUR CARD IS ON ITS WAY"}
        </Text>
        <Text style={[stepStyles.title, { textAlign: "center", marginTop: 6 }]}>
          {shareUrl ? (
            <>Send them{"\n"}the link.</>
          ) : (
            <>See you{"\n"}in the mailbox.</>
          )}
        </Text>
        <Text style={[stepStyles.subtitle, { textAlign: "center", maxWidth: 320, marginTop: 12 }]}>
          {shareUrl
            ? "Tap below and pick how to send it — iMessage, Mail, AirDrop. The recipient fills in their address and we mail your card from our printer."
            : `${recipientName} gets it in 4–7 days, USPS time. We'll drop a pin on your map when it lands.`}
        </Text>
        {/* v0.7.0.18: show the URL as selectable text so the user can
            long-press → Copy if for any reason the share sheet doesn't
            appear (extremely defensive — iOS share-sheet-over-modal
            interactions have many flavors of broken). */}
        {shareUrl ? (
          <Text
            selectable
            style={mailedStyles.shareUrl}
            testID="welcome-mailed-share-url"
            numberOfLines={2}
          >
            {shareUrl}
          </Text>
        ) : null}
      </Animated.View>

      <PrimaryButton
        title={shareUrl ? "Share the link →" : "Open Mailroom →"}
        onPress={onDismiss}
        style={mailedStyles.doneBtn}
        testID="welcome-mailed-continue"
      />
    </View>
  );
}

const MAILED_STAGE = 300;

const mailedStyles = StyleSheet.create({
  stage: {
    width: MAILED_STAGE,
    height: MAILED_STAGE,
    marginTop: 18,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  // v0.7.0.10 hero illustration — the folk map fills the stage and
  // pulses in with a big spring. Communicates "your card is going
  // out into the world" much better than the old envelope-fold beat.
  heroFrame: {
    width: MAILED_STAGE,
    height: MAILED_STAGE,
    borderRadius: 18,
    overflow: "hidden",
    shadowColor: colors.shadow,
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
  },
  heroImage: { width: "100%", height: "100%" },
  // Flying envelope dots — three small letters that shoot outward from
  // the center of the hero, staggered, suggesting many cards in flight.
  flyingEnvelope: {
    position: "absolute",
    width: 28,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  envelopeShape: {
    width: 28,
    height: 20,
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderWidth: 1.4,
    borderRadius: 2,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
  },
  envelopeFlap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 0,
    borderTopWidth: 10,
    borderLeftWidth: 14,
    borderRightWidth: 14,
    borderTopColor: colors.postalRed,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  // MAILED rubber stamp — v0.7.0.25 moved out of dead-center.
  //
  // Original v0.7.0.10 had this slamming down on the geometric center of
  // the stage, which sits directly over the mail-truck-on-a-balloon
  // illustration. User feedback: "MAILED blocks the coolest part of the
  // design, the mail truck on a balloon." Fix: pin to the bottom-right
  // corner of the stage and rotate ~-12deg like a real rubber stamp on
  // the corner of a piece of paper. Slight overhang past the image's
  // right edge to read as a real-world rubber-stamp accent rather than a
  // centered modal overlay. The slam-in animation is preserved; only the
  // resting position changed.
  stamp: {
    position: "absolute",
    bottom: 14,
    right: -6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 4,
    borderColor: colors.postalRed,
    borderRadius: 6,
    backgroundColor: "rgba(255,253,247,0.92)",
    shadowColor: colors.postalRed,
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
  stampText: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 24,
    letterSpacing: 4,
  },
  kicker: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.6,
    marginTop: 30,
    textAlign: "center",
  },
  doneBtn: { marginTop: 28, width: "100%" },
  // v0.7.0.18: selectable URL surfaced under the caption on link-path
  // sends. Mutedink so it's clearly secondary to the headline; selectable
  // so the user can long-press → Copy on iOS.
  shareUrl: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    marginTop: 14,
    textAlign: "center",
  },
});

// ============================================================================
// SHARED — address fields, field labels, step dots, step styles
// ============================================================================

/**
 * AddressFields — v0.7.0.3: smart autofill textbox + live suggestions.
 *
 * Single multiline textbox. Three layers of address help, smallest →
 * biggest commitment:
 *
 *   1. iOS QuickType autofill (instant, free)
 *      `textContentType="fullStreetAddress"` makes iOS offer the user&apos;s
 *      saved Contact address as a one-tap autofill on the QuickType bar.
 *
 *   2. Live Nominatim suggestions (debounced 350ms, free OSM API)
 *      As the user types past 4 chars, we hit Nominatim to suggest US
 *      addresses. Suggestions appear in a dropdown below the textbox.
 *      Tap a suggestion → field fills + structured fields populate.
 *
 *   3. Forgiving on-the-fly parser
 *      Even without a suggestion, the user&apos;s free-form input is
 *      parsed live via parseFreeFormAddress. Handles Google-format
 *      ("Chevy Chase Maryland 20815, USA"), canonical USPS format
 *      ("Chevy Chase, MD 20815"), and full-state variants.
 *
 * Validator (isAddressComplete in WelcomeSheet) gates Continue on
 * city + state + valid zip. If none of the three layers land a usable
 * parse, Continue stays grey.
 */
function AddressFields({
  address,
  onChange,
  testIDPrefix,
  label,
}: {
  address: AddressDraft;
  onChange: (a: AddressDraft) => void;
  testIDPrefix: string;
  label?: string;
}) {
  // v0.7.0.7: the main textbox holds line1 + city + state + zip ONLY.
  // line2 (apt/suite/unit) lives in its own field below so it doesn't
  // get blown away when the user re-edits the address. Same pattern
  // every US shipping form uses.
  const [raw, setRaw] = useState<string>(() => addressToTextNoLine2(address));
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  // v0.7.0.15: Google Places session token. One token per "type-then-pick"
  // cycle — billing groups all autocomplete + the final getPlace call
  // as ONE session, cheaper than per-request billing.
  const sessionTokenRef = useRef<string>(newSessionToken());

  useEffect(() => {
    const expected = addressToTextNoLine2(address);
    setRaw((prev) => (prev === expected ? prev : expected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address.line1, address.city, address.state, address.zip]);

  // Debounced Google Places lookup. 350ms after the last keystroke.
  // Aborts in-flight on new keystrokes so only the latest query's
  // results show up.
  useEffect(() => {
    if (raw.trim().length < 3) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    setLoadingSuggestions(true);
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const rows = await fetchAddressSuggestions(raw, {
          signal: ac.signal,
          sessionToken: sessionTokenRef.current,
        });
        setSuggestions(rows);
      } catch {
        /* aborted or network error — fall through silently */
      } finally {
        setLoadingSuggestions(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [raw]);

  async function applySuggestion(s: AddressSuggestion) {
    // Google Places returns suggestions with only the display label +
    // placeId. Fetch the structured fields via getPlace, then apply.
    // This is the second call that ends the session — start a fresh
    // session token after.
    const details = await fetchPlaceDetails(s.placeId, {
      sessionToken: sessionTokenRef.current,
    });
    sessionTokenRef.current = newSessionToken();
    if (!details) {
      // Got a placeId but couldn't resolve full fields. Fall back to
      // raw label so the user isn't blocked — they can edit the apt
      // field manually.
      setRaw(s.label);
      setShowSuggestions(false);
      setSuggestions([]);
      return;
    }
    // Preserve any apt/suite the user already typed in the dedicated
    // field. If Google returned a subpremise (e.g. "Apt 4B") AND the
    // user hasn't typed one, prefer Google's. Otherwise keep the
    // user's input.
    const next: AddressDraft = {
      line1: details.line1,
      line2: address.line2 || details.line2 || "",
      city: details.city,
      state: details.state,
      zip: details.zip,
    };
    setRaw(addressToTextNoLine2(next));
    setShowSuggestions(false);
    setSuggestions([]);
    onChange(next);
  }

  return (
    <>
      <FieldLabel style={{ marginTop: 14 }}>{label ?? "Their address"}</FieldLabel>
      <TextInput
        value={raw}
        onChangeText={(v) => {
          setRaw(v);
          setShowSuggestions(true);
          const parsed = parseFreeFormAddress(v);
          if (parsed) {
            // Preserve the apt field if the user already typed one.
            onChange({ ...parsed, line2: address.line2 || parsed.line2 });
          } else {
            onChange({
              line1: v.trim(),
              line2: address.line2 || "",
              city: "",
              state: "",
              zip: "",
            });
          }
        }}
        onFocus={() => setShowSuggestions(true)}
        placeholder="5209 Dorset Ave, Boise, ID 83706"
        placeholderTextColor={colors.mutedInk}
        autoCapitalize="words"
        autoCorrect={false}
        textContentType="fullStreetAddress"
        autoComplete="postal-address"
        multiline
        style={[fieldStyles.input, { minHeight: 64, textAlignVertical: "top" }]}
        testID={`${testIDPrefix}-address`}
      />

      {showSuggestions && suggestions.length > 0 ? (
        <View style={fieldStyles.suggestions} testID={`${testIDPrefix}-suggestions`}>
          {suggestions.map((s, i) => (
            <Pressable
              key={`${s.label}-${i}`}
              onPress={() => applySuggestion(s)}
              style={({ pressed }) => [
                fieldStyles.suggestionRow,
                pressed && fieldStyles.suggestionRowPressed,
                i < suggestions.length - 1 && fieldStyles.suggestionRowBorder,
              ]}
              testID={`${testIDPrefix}-suggestion-${i}`}
            >
              <Text style={fieldStyles.suggestionText} numberOfLines={2}>
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* v0.7.0.17: only show the "Start typing" hint when the address is
          empty. Once a line1 is filled (autocomplete or manual), the hint
          becomes noise that contradicts what the user just did. */}
      {loadingSuggestions ? (
        <Text style={fieldStyles.helper}>Looking up addresses...</Text>
      ) : address.line1.trim().length === 0 ? (
        <Text style={fieldStyles.helper}>Start typing — we'll suggest addresses.</Text>
      ) : null}

      {/* Apt / suite / unit — separate field, optional. Maps to line2.
          Every shipping form does this. Keeps the autofill flow clean
          (Nominatim doesn't return unit info) and prevents the apt from
          getting wiped when the user re-edits the main address. */}
      <FieldLabel style={{ marginTop: 14 }}>Apt, suite, unit (optional)</FieldLabel>
      <TextInput
        value={address.line2 ?? ""}
        onChangeText={(v) => {
          onChange({ ...address, line2: v });
        }}
        placeholder="Apt 4B"
        placeholderTextColor={colors.mutedInk}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="address-line2"
        textContentType="sublocality"
        style={fieldStyles.input}
        testID={`${testIDPrefix}-address-line2`}
      />
    </>
  );
}

/** Convert a structured AddressDraft into the display string we use in
 *  the single-textbox field. Includes line2 — call sites that have a
 *  dedicated apt field use addressToTextNoLine2 instead. */
function addressToText(a: AddressDraft): string {
  const parts: string[] = [];
  if (a.line1) parts.push(a.line1);
  if (a.line2) parts.push(a.line2);
  if (a.city) parts.push(a.city);
  const stateZip = [a.state, a.zip].filter(Boolean).join(" ");
  if (stateZip) parts.push(stateZip);
  return parts.join(", ");
}

/** Display variant that omits line2 — used by AddressFields where the
 *  apt/suite lives in its own input so it doesn't get round-tripped
 *  through the main textbox. */
function addressToTextNoLine2(a: AddressDraft): string {
  const parts: string[] = [];
  if (a.line1) parts.push(a.line1);
  if (a.city) parts.push(a.city);
  const stateZip = [a.state, a.zip].filter(Boolean).join(" ");
  if (stateZip) parts.push(stateZip);
  return parts.join(", ");
}

/** Map US state names to 2-letter codes. Lowercase keys for
 *  case-insensitive matching. */
const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL",
  georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};

const ALL_STATE_PATTERNS: Array<{ pattern: RegExp; code: string }> = (() => {
  // Build a list of regex patterns for both full state names and 2-letter
  // codes, longest-first so "New York" matches before "New".
  const entries: Array<{ name: string; code: string }> = [];
  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
    entries.push({ name, code });
    entries.push({ name: code.toLowerCase(), code }); // 2-letter form
  }
  entries.sort((a, b) => b.name.length - a.name.length);
  return entries.map(({ name, code }) => ({
    pattern: new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i"),
    code,
  }));
})();

/** Strip a trailing country marker from a freeform address. Returns the
 *  cleaned input. Handles "USA", "U.S.A.", "United States", "United States of America". */
function stripCountry(input: string): string {
  return input
    .replace(/,?\s*(United States of America|United States|U\.?S\.?A\.?)\s*$/i, "")
    .trim()
    .replace(/,$/, "")
    .trim();
}

/** Find a "City State ZIP" pattern anywhere at the END of `s`. Returns
 *  the city, 2-letter state code, zip, and `rest` (everything before
 *  the city). Handles state as either a 2-letter code OR a full state name.
 *
 *  v0.7.0.14 fix: city is now the LAST comma-separated chunk before the
 *  state, not everything before the state. Previously "5209 Dorset Ave,
 *  Chevy Chase Maryland 20815" would set city="5209 Dorset Ave, Chevy
 *  Chase" and leave line1 empty — blocking the user from sending. Now
 *  we walk back through commas to isolate just "Chevy Chase" as the city
 *  and return "5209 Dorset Ave" as `rest` for the caller to use as line1.
 */
function extractCityStateZip(
  s: string,
): { city: string; state: string; zip: string; rest: string } | null {
  // Trailing ZIP — required.
  const zipMatch = s.match(/\b(\d{5}(?:-\d{4})?)\s*$/);
  if (!zipMatch) return null;
  const zip = zipMatch[1];
  const beforeZip = s.slice(0, zipMatch.index).trim().replace(/,$/, "").trim();
  if (!beforeZip) return null;

  for (const { pattern, code } of ALL_STATE_PATTERNS) {
    const endPattern = new RegExp(pattern.source + "\\s*$", "i");
    const m = beforeZip.match(endPattern);
    if (m && m.index !== undefined) {
      // Text before the state. Could be "line1, city" OR
      // "line1, line2, city" OR just "city".
      const beforeState = beforeZip.slice(0, m.index).trim().replace(/,$/, "").trim();
      if (!beforeState) continue;
      // Last comma boundary separates the rest (line1 + maybe line2)
      // from the city. No comma → the whole thing is the city.
      const lastComma = beforeState.lastIndexOf(",");
      const city =
        lastComma >= 0
          ? beforeState.slice(lastComma + 1).trim()
          : beforeState;
      if (!city) continue;
      const rest = lastComma >= 0 ? beforeState.slice(0, lastComma).trim() : "";
      return { city, state: code, zip, rest };
    }
  }
  return null;
}

/**
 * Forgiving free-form address parser. v0.7.0.3: handles the format
 * Google's autofill / iOS autocomplete spits out:
 *   "5209 Dorset Avenue, Chevy Chase Maryland 20815, USA"
 *   "412 SE Belmont, Portland, OR 97214"
 *   "412 SE Belmont, Portland, Oregon, 97214"
 *   "5209 Dorset Ave Apt 4B, Boise, ID 83706"
 *
 * Strategy: strip trailing country marker, then comma-split. The LAST
 * non-country chunk gets scanned for "City State ZIP" — state can be
 * the 2-letter code OR the full state name. Everything before that
 * chunk is line1 (+ optional line2 if there are extra comma chunks).
 *
 * Returns null if it can&apos;t extract a usable address.
 */
/** Match "STATE ZIP" or "State Name ZIP" at the start-to-end of a string.
 *  Used by Strategy 0 to detect "IL 60649" or "Maryland 20815" tail chunks. */
function matchStateZipChunk(s: string): { state: string; zip: string } | null {
  const trimmed = s.trim();
  // "ST 12345" or "ST 12345-1234"
  const m1 = trimmed.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m1) return { state: m1[1].toUpperCase(), zip: m1[2] };
  // "State Name 12345"
  const m2 = trimmed.match(/^(.+?)\s+(\d{5}(?:-\d{4})?)$/);
  if (m2) {
    const stateName = m2[1].trim().toLowerCase();
    const code = STATE_NAME_TO_CODE[stateName];
    if (code) return { state: code, zip: m2[2] };
  }
  return null;
}

function parseFreeFormAddress(input: string): AddressDraft | null {
  let cleaned = input.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  cleaned = stripCountry(cleaned);
  if (!cleaned) return null;

  const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);

  // Strategy 0: comma-aware. If the LAST chunk matches "STATE ZIP" and
  // there are ≥ 3 chunks, we have unambiguous structure:
  //   parts = ["Line1 (maybe with Apt)", "City", "ST ZIP"]
  //   or     ["Line1", "Apt 5", "City", "ST ZIP"]   (4 chunks → line2)
  // This is what the Google Places autofill returns most of the time
  // (e.g. "South Jeffery Boulevard, Chicago, IL 60649"). The older
  // joined-string Strategy A would mis-identify "Line1, City" as the
  // city blob and leave line1 empty — that bug blocked sends for any
  // user whose autofill came back without a street number on the line1
  // chunk, since their `line1` would be wiped to "".
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    const stateZip = matchStateZipChunk(last);
    if (stateZip) {
      const city = parts[parts.length - 2];
      const before = parts.slice(0, parts.length - 2);
      return {
        line1: before[0] ?? "",
        line2: before.length > 1 ? before.slice(1).join(", ") : "",
        city,
        state: stateZip.state,
        zip: stateZip.zip,
      };
    }
  }

  // Strategy A: scan from the END of the joined string for "City State ZIP".
  // Handles "5209 Dorset Avenue, Chevy Chase Maryland 20815" (2-chunk
  // Maryland-style with full state name) AND "412 SE Belmont, Portland,
  // OR 97214" (3-chunk canonical). extractCityStateZip walks back through
  // commas to isolate the city, returning `rest` which is line1 (+ optional
  // line2) ready to use.
  const joined = parts.join(", ");
  const extracted = extractCityStateZip(joined);
  if (extracted) {
    const restParts = extracted.rest
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const line1 = restParts[0] ?? "";
    const line2 = restParts.length > 1 ? restParts.slice(1).join(", ") : "";
    if (line1) {
      return {
        line1,
        line2,
        city: extracted.city,
        state: extracted.state,
        zip: extracted.zip,
      };
    }
  }

  // Strategy B fallback: state and zip in separate comma chunks with no
  // inline pattern match. "Line1, City, ST, ZIP" or
  // "Line1, City, Maryland, 20815".
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    const lastIsZip = /^\d{5}(?:-\d{4})?$/.test(last);
    if (lastIsZip) {
      const stateChunk = parts[parts.length - 2].toLowerCase();
      const stateCode = STATE_NAME_TO_CODE[stateChunk] ?? (/^[a-z]{2}$/.test(stateChunk) ? stateChunk.toUpperCase() : null);
      if (stateCode) {
        const city = parts[parts.length - 3];
        const before = parts.slice(0, parts.length - 3);
        return {
          line1: before[0] ?? "",
          line2: before.length > 1 ? before.slice(1).join(", ") : "",
          city,
          state: stateCode,
          zip: last,
        };
      }
    }
  }

  return null;
}

function FieldLabel({ children, style }: { children: React.ReactNode; style?: any }) {
  return <Text style={[fieldStyles.label, style]}>{children}</Text>;
}

const fieldStyles = StyleSheet.create({
  label: {
    color: colors.mutedInk,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "rgba(245, 240, 230, 0.6)",
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1.2,
    color: colors.ink,
    fontFamily: fonts.serif,
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  helper: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
  },
  error: {
    color: colors.postalRed,
    fontFamily: fonts.serifSemi,
    fontSize: 13,
    marginTop: 12,
  },
  // Address-autocomplete suggestion dropdown. Sits directly under the
  // textbox. Native white panel with hairline dividers between rows.
  suggestions: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    marginTop: -2,
    overflow: "hidden",
  },
  suggestionRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  suggestionRowPressed: {
    backgroundColor: colors.paper,
  },
  suggestionRowBorder: {
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionText: {
    color: colors.ink,
    fontFamily: fonts.serif,
    fontSize: 14,
    lineHeight: 18,
  },
});

// ============================================================================
// STEP DOTS — visual progress indicator
// ============================================================================

function StepDots({ count, active }: { count: number; active: number }) {
  return (
    <View style={dotStyles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[
            dotStyles.dot,
            i < active && dotStyles.done,
            i === active && dotStyles.active,
          ]}
        />
      ))}
    </View>
  );
}

const dotStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, marginBottom: 22 },
  dot: { backgroundColor: colors.line, borderRadius: 4, height: 6, width: 6 },
  active: { backgroundColor: colors.ink, width: 24 },
  done: { backgroundColor: colors.postalBlue },
});

// ============================================================================
// SHARED STEP STYLES
// ============================================================================

const stepStyles = StyleSheet.create({
  wrap: { flex: 1, gap: 4 },
  title: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: type.title,
    letterSpacing: -0.4,
    lineHeight: type.title + 4,
  },
  subtitle: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 20,
    marginTop: 8,
  },
  continueBtn: { marginTop: 24 },
});

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    gap: 16,
    paddingHorizontal: 22,
    paddingTop: 56,
    paddingBottom: 30,
  },
  backBtn: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    marginBottom: 4,
    paddingHorizontal: 4,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  backBtnText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
});
