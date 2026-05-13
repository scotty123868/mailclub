import * as AppleAuthentication from "expo-apple-authentication";
import * as ImagePicker from "expo-image-picker";
import { ArrowLeft, ArrowRight, Image as ImageIcon, Link as LinkIcon, User as UserIcon, Users as UsersIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
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
  withTiming,
} from "react-native-reanimated";
import { PrimaryButton } from "@/src/components/Buttons";
import {
  fetchAddressSuggestions,
  type AddressSuggestion,
} from "@/src/services/addressAutocomplete";
import { isAppleSignInAvailable } from "@/src/services/apple-auth";
import { lookupReciprocation } from "@/src/services/api";
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
    hasCompletedSignup,
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
  // (name + address). All others skip their-info and go straight to
  // your-info:
  //   - link: dropped name + contact fields. We use the iOS Share sheet
  //     to deliver the claim URL after creating the card. Escargot pattern.
  //   - self: uses the user's own address (collected on your-info).
  //   - penpal: anonymous, no recipient info. Routed through sendIntoVoid.
  const needsTheirInfo = recipientKind === "friend";

  const canAdvanceTheirInfo =
    recipientKind === "friend"
      ? theirName.trim().length > 0 && isAddressComplete(theirAddress)
      : true;

  const canAdvanceYourInfo =
    yourFirstName.trim().length > 0 && isAddressComplete(yourAddress);

  // ----- Hero actions -------------------------------------------------------

  async function onAppleSignIn() {
    setError(null);
    setSaving(true);
    try {
      const result = await signInWithApple();
      if (!result.ok) {
        if (!result.cancelled) setError(result.error ?? "Apple sign-in didn&apos;t work.");
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
      } else if (recipientKind === "link") {
        // Send-link flow: card queues immediately + the user gets a
        // shareable claim URL. v0.7.0.1: instead of asking for the
        // recipient&apos;s name + contact, we open the iOS Share sheet
        // with the claim URL and let the user pick how to deliver it
        // (iMessage, Mail, AirDrop, whatever). Escargot pattern.
        const sendRes = await sendPostcardViaLink({
          category: "photo",
          message: message.trim(),
          photoUri: photoUri ?? undefined,
        });
        if (!sendRes.ok || !sendRes.claimUrl) {
          throw new Error("Couldn't create the link.");
        }
        try {
          await Share.share({
            message: `I sent you a postcard on Mailroom. Tap to claim it — ${sendRes.claimUrl}`,
            url: sendRes.claimUrl,
          });
        } catch {
          // Share sheet dismissed or unavailable — the card is queued
          // either way. User can find the claim URL in their journal
          // later if they want to share again.
        }
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
      } else if (recipientKind === "penpal") {
        // v0.7.0.1: pen pal is wired through sendIntoVoid — the existing
        // anonymous "send to a stranger" backend. The card queues; a
        // Mailroom-curated recipient is assigned later. From the
        // sender&apos;s POV: card is mailed, app opens, they&apos;re in.
        const note = message.trim();
        const voidRes = await sendIntoVoid(
          // Include the user&apos;s first name in the message so the
          // recipient knows who sent it.
          note,
        );
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
            />
          ) : null}

          {step === "mailed" ? (
            <MailedStep
              recipientName={theirName.trim() || (recipientKind === "self" ? yourFirstName.trim() : "your friend")}
              onDismiss={() => onComplete()}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ============================================================================
// STEP 1 — HERO (unchanged from v0.6.1 build 8, just the tagline)
// ============================================================================

function HeroStep({
  onAppleSignIn,
  onSwitchToEmail,
  appleAvailable,
  saving,
  error,
  pendingInviteCopy,
  fastForward,
}: {
  onAppleSignIn: () => void;
  onSwitchToEmail: () => void;
  appleAvailable: boolean;
  saving: boolean;
  error: string | null;
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

      <Text style={explainStyles.kicker}>FREE · ON US</Text>

      <Text style={[stepStyles.title, { textAlign: "center", marginTop: 6 }]}>
        Your first postcard,{"\n"}on the house.
      </Text>

      <Text
        style={[
          stepStyles.subtitle,
          { textAlign: "center", marginTop: 14, paddingHorizontal: 10 },
        ]}
      >
        Pick a photo, write a note. We print, stamp, and mail it through USPS. Costs you nothing.
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
}) {
  return (
    <View style={stepStyles.wrap} testID="welcome-step-your-info">
      <StepDots count={5} active={4} />
      <Text style={stepStyles.title}>From you.</Text>
      <Text style={stepStyles.subtitle}>
        We print "from your city" on the back. Your full address stays private.
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

      <AddressFields
        address={address}
        onChange={onAddressChange}
        testIDPrefix="welcome-your"
        label="Your address"
      />

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
  onDismiss,
}: {
  recipientName: string;
  onDismiss: () => void;
}) {
  // Shared values for the fold animation. All start at "card visible,
  // envelope hidden" and run to "envelope sealed, MAILED stamped" on
  // mount. useEffect drives the sequence.
  const cardScale = useSharedValue(1);
  const cardTranslateY = useSharedValue(0);
  const envOpacity = useSharedValue(0);
  const envScale = useSharedValue(0.9);
  const flapRotate = useSharedValue(0); // 0 → 180deg
  const stampScale = useSharedValue(0);
  const stampRotate = useSharedValue(-12);
  const captionOpacity = useSharedValue(0);

  useEffect(() => {
    // The sequence.
    cardScale.value = withDelay(150, withTiming(0.65, { duration: 350, easing: Easing.bezier(0.4, 0, 0.2, 1) }));
    cardTranslateY.value = withDelay(150, withTiming(-8, { duration: 350 }));
    envOpacity.value = withDelay(300, withTiming(1, { duration: 250 }));
    envScale.value = withDelay(300, withTiming(0.95, { duration: 250 }));
    flapRotate.value = withDelay(500, withTiming(180, { duration: 350, easing: Easing.bezier(0.4, 0, 0.2, 1) }));
    stampScale.value = withDelay(800, withTiming(1, {
      duration: 220,
      easing: Easing.bezier(0.34, 1.56, 0.64, 1), // spring-y overshoot
    }));
    stampRotate.value = withDelay(800, withTiming(8, { duration: 220 }));
    captionOpacity.value = withDelay(1050, withTiming(1, { duration: 400 }));
  }, [cardScale, cardTranslateY, envOpacity, envScale, flapRotate, stampScale, stampRotate, captionOpacity]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: cardScale.value },
      { translateY: cardTranslateY.value },
    ],
  }));
  const envStyle = useAnimatedStyle(() => ({
    opacity: envOpacity.value,
    transform: [{ scale: envScale.value }],
  }));
  const flapStyle = useAnimatedStyle(() => ({
    transform: [{ rotateX: `${flapRotate.value}deg` }],
  }));
  const stampStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: stampScale.value },
      { rotate: `${stampRotate.value}deg` },
    ],
  }));
  const captionStyle = useAnimatedStyle(() => ({
    opacity: captionOpacity.value,
  }));

  return (
    <View style={[stepStyles.wrap, { alignItems: "center" }]} testID="welcome-step-mailed">
      <View style={mailedStyles.stage}>
        {/* The envelope back (visible after the fold starts) */}
        <Animated.View style={[mailedStyles.envelope, envStyle]}>
          <View style={mailedStyles.envelopeBody} />
          {/* Side fold lines suggest the 3D-ness of the envelope */}
          <View style={mailedStyles.foldLeft} />
          <View style={mailedStyles.foldRight} />
          {/* The flap — rotates around top edge to "close" the envelope */}
          <Animated.View
            style={[mailedStyles.flap, flapStyle]}
            pointerEvents="none"
          >
            <View style={mailedStyles.flapInner} />
          </Animated.View>
        </Animated.View>

        {/* The postcard — starts at full size, shrinks into the envelope */}
        <Animated.View style={[mailedStyles.card, cardStyle]}>
          <View style={mailedStyles.cardPhoto}>
            <Image
              source={HERO_MAILBOX}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          </View>
          <View style={mailedStyles.cardStamp} />
        </Animated.View>

        {/* MAILED rubber stamp — comes down at the end */}
        <Animated.View style={[mailedStyles.stamp, stampStyle]} pointerEvents="none">
          <Text style={mailedStyles.stampText}>MAILED</Text>
        </Animated.View>
      </View>

      <Animated.View style={captionStyle}>
        <Text style={mailedStyles.kicker}>YOUR CARD IS ON ITS WAY</Text>
        <Text style={[stepStyles.title, { textAlign: "center", marginTop: 6 }]}>
          See you{"\n"}in the mailbox.
        </Text>
        <Text style={[stepStyles.subtitle, { textAlign: "center", maxWidth: 320, marginTop: 12 }]}>
          {recipientName} gets it in 4–7 days, USPS time. We&apos;ll drop a pin on your map when it lands.
        </Text>
      </Animated.View>

      <PrimaryButton
        title="Open Mailroom →"
        onPress={onDismiss}
        style={mailedStyles.doneBtn}
        testID="welcome-mailed-continue"
      />
    </View>
  );
}

const MAILED_STAGE = 260;

const mailedStyles = StyleSheet.create({
  stage: {
    width: MAILED_STAGE,
    height: MAILED_STAGE,
    marginTop: 18,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  // ENVELOPE — back panel
  envelope: {
    position: "absolute",
    inset: 20,
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderWidth: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  envelopeBody: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.paper },
  foldLeft: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 1,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  foldRight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: 1,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  // FLAP — top half of envelope that folds down. Rotates around X axis
  // about its top edge. backfaceVisibility hidden so the back doesn&apos;t
  // bleed through when flipped past 90deg.
  flap: {
    position: "absolute",
    top: -2,
    left: -2,
    right: -2,
    height: "55%",
    backgroundColor: colors.paperDark,
    borderColor: colors.ink,
    borderWidth: 2,
    borderRadius: 6,
    transformOrigin: "top",
    backfaceVisibility: "hidden",
  },
  flapInner: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.paperDark },
  // CARD — the postcard that shrinks into the envelope
  card: {
    width: MAILED_STAGE - 70,
    height: (MAILED_STAGE - 70) * 0.62,
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderWidth: 1.5,
    borderRadius: 4,
    overflow: "hidden",
    position: "relative",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
  },
  cardPhoto: { width: "100%", height: "100%" },
  cardStamp: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 22,
    backgroundColor: colors.postalRed,
    borderRadius: 2,
  },
  // MAILED rubber stamp overlay
  stamp: {
    position: "absolute",
    top: 30,
    right: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 3,
    borderColor: colors.postalRed,
    borderRadius: 4,
    backgroundColor: "rgba(255,253,247,0.6)",
  },
  stampText: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 16,
    letterSpacing: 2,
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
  const [raw, setRaw] = useState<string>(() => addressToText(address));
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  useEffect(() => {
    const expected = addressToText(address);
    setRaw((prev) => (prev === expected ? prev : expected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address.line1, address.line2, address.city, address.state, address.zip]);

  // Debounced Nominatim lookup. 350ms after the last keystroke we hit
  // the API. Aborts in-flight on new keystrokes so only the latest
  // query&apos;s results show up.
  useEffect(() => {
    if (raw.trim().length < 4) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    setLoadingSuggestions(true);
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const rows = await fetchAddressSuggestions(raw, { signal: ac.signal });
        setSuggestions(rows);
      } catch {
        // aborted or network error — fall through silently
      } finally {
        setLoadingSuggestions(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [raw]);

  function applySuggestion(s: AddressSuggestion) {
    const next: AddressDraft = {
      line1: s.line1,
      line2: "",
      city: s.city,
      state: s.state,
      zip: s.zip,
    };
    setRaw(addressToText(next));
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
          if (parsed) onChange(parsed);
          else onChange({ line1: v.trim(), line2: "", city: "", state: "", zip: "" });
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

      <Text style={fieldStyles.helper}>
        {loadingSuggestions ? "Looking up addresses..." : "Start typing — we'll suggest addresses."}
      </Text>
    </>
  );
}

/** Convert a structured AddressDraft into the display string we use in
 *  the single-textbox field. */
function addressToText(a: AddressDraft): string {
  const parts: string[] = [];
  if (a.line1) parts.push(a.line1);
  if (a.line2) parts.push(a.line2);
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
 *  the city, 2-letter state code, and zip if matched; null otherwise.
 *  Handles state as either a 2-letter code OR a full state name. */
function extractCityStateZip(
  s: string,
): { city: string; state: string; zip: string; rest: string } | null {
  // Trailing ZIP — required.
  const zipMatch = s.match(/\b(\d{5}(?:-\d{4})?)\s*$/);
  if (!zipMatch) return null;
  const zip = zipMatch[1];
  const beforeZip = s.slice(0, zipMatch.index).trim().replace(/,$/, "").trim();
  if (!beforeZip) return null;

  // Walk the state patterns (longest-first) trying to find one at the END of
  // beforeZip. The remainder before the state is the city.
  for (const { pattern, code } of ALL_STATE_PATTERNS) {
    // Need pattern at the end of the string.
    const endPattern = new RegExp(pattern.source + "\\s*$", "i");
    const m = beforeZip.match(endPattern);
    if (m && m.index !== undefined) {
      const cityPart = beforeZip.slice(0, m.index).trim().replace(/,$/, "").trim();
      if (!cityPart) continue;
      return { city: cityPart, state: code, zip, rest: "" };
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
function parseFreeFormAddress(input: string): AddressDraft | null {
  let cleaned = input.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  cleaned = stripCountry(cleaned);
  if (!cleaned) return null;

  const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);

  // Strategy A: scan from the END of the joined string for "City State ZIP".
  // This handles "Line1, City State ZIP" (Google format) AND
  // "Line1, City, State ZIP" (canonical) AND "Line1, City, State, ZIP".
  const joined = parts.join(", ");
  const extracted = extractCityStateZip(joined);
  if (extracted) {
    // What&apos;s left in `joined` BEFORE city is line1 + optional line2.
    const beforeCityIdx = joined.toLowerCase().lastIndexOf(extracted.city.toLowerCase());
    const beforeCity =
      beforeCityIdx > 0
        ? joined.slice(0, beforeCityIdx).trim().replace(/,$/, "").trim()
        : "";
    // beforeCity may itself contain commas (line1, line2). Split it.
    const beforeParts = beforeCity.split(",").map((s) => s.trim()).filter(Boolean);
    const line1 = beforeParts[0] ?? "";
    const line2 = beforeParts.length > 1 ? beforeParts.slice(1).join(", ") : "";
    return {
      line1,
      line2,
      city: extracted.city,
      state: extracted.state,
      zip: extracted.zip,
    };
  }

  // Strategy B fallback: maybe state and zip are in separate comma chunks
  // and there&apos;s no inline pattern match. "Line1, City, ST, ZIP" or
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
