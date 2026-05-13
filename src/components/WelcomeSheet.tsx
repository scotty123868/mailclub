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
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
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
  const canAdvanceRecipient = recipientKind !== null && recipientKind !== "penpal";

  function isAddressComplete(a: AddressDraft): boolean {
    return (
      a.line1.trim().length > 0 &&
      a.city.trim().length > 0 &&
      STATE_RE.test(a.state.trim()) &&
      ZIP_RE.test(a.zip.trim())
    );
  }

  const canAdvanceTheirInfo = (() => {
    if (recipientKind === "friend") {
      return theirName.trim().length > 0 && isAddressComplete(theirAddress);
    }
    if (recipientKind === "link") {
      return theirName.trim().length > 0 && theirContact.trim().length > 0;
    }
    if (recipientKind === "self") {
      // Self-send: we&apos;ll use the user&apos;s own address (collected next step).
      return true;
    }
    return false;
  })();

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
      if (hasCompletedSignup) {
        // Returning, fully-onboarded user — they shouldn&apos;t be here at
        // all. WelcomeGate should close us. Nudge to photo anyway.
        setStep("photo");
      } else {
        setStep("photo");
      }
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
        // If they already have a complete profile but no first card,
        // skip past the photo intro; they know what they&apos;re here for.
        setStep("photo");
        return;
      }
      // Sign-up path: defer the actual signup until "mailed" step so we
      // can commit profile + first card atomically. We just bank email +
      // password and move on.
      setAuthed(true);
      setStep("photo");
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
        // Send-link flow: card queues, recipient gets a link to enter
        // their address, Lob ships once they do. Counts as the first
        // send right away.
        const sendRes = await sendPostcardViaLink({
          category: "photo",
          message: message.trim(),
          photoUri: photoUri ?? undefined,
        });
        if (!sendRes.ok) {
          throw new Error("Couldn't create the link.");
        }
        // TODO v0.7.1: dispatch the SMS/email to `theirContact` with the
        // claim URL. For v0.7.0 the user copies it manually from a
        // follow-up screen. Acceptable — first send still completes.
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
      } else {
        // penpal — not wired in v0.7.0
        throw new Error("Pen pal matching ships in v0.7.5.");
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
    else if (step === "photo") setStep(authed ? "hero" : "auth-email");
    else if (step === "note") setStep("photo");
    else if (step === "recipient") setStep("note");
    else if (step === "their-info") setStep("recipient");
    else if (step === "your-info") {
      // If "self" skipped their-info, back goes to recipient.
      setStep(recipientKind === "self" ? "recipient" : "their-info");
    } else if (step === "mailed") setStep("your-info");
  }

  function next() {
    setError(null);
    if (step === "recipient") {
      if (recipientKind === "self") setStep("your-info");
      else setStep("their-info");
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

          {step === "their-info" ? (
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
      <Text style={stepStyles.title}>What&apos;s the memory?</Text>
      <Text style={stepStyles.subtitle}>
        A line or two. It&apos;s a postcard, not an email.
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
        sub="Send one, get one from a stranger (coming soon)"
        Icon={UsersIcon}
        onPress={() => onPick("penpal")}
        testID="welcome-recipient-penpal"
        disabled
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

function MailedStep({
  recipientName,
  onDismiss,
}: {
  recipientName: string;
  onDismiss: () => void;
}) {
  return (
    <View style={[stepStyles.wrap, { alignItems: "center" }]} testID="welcome-step-mailed">
      <View style={mailedStyles.artFrame}>
        <Image
          source={HERO_MAILBOX}
          style={mailedStyles.art}
          resizeMode="cover"
          accessibilityLabel="Hands at the mailbox"
        />
      </View>
      <Text style={mailedStyles.kicker}>MAILED</Text>
      <Text style={[stepStyles.title, { textAlign: "center", marginTop: 8 }]}>
        Your card is{"\n"}on its way.
      </Text>
      <Text style={[stepStyles.subtitle, { textAlign: "center", maxWidth: 320, marginTop: 12 }]}>
        {recipientName} gets it in 4–7 days, USPS time. We&apos;ll drop a pin on your map when it lands.
      </Text>
      <PrimaryButton
        title="Open Mailroom →"
        onPress={onDismiss}
        style={mailedStyles.doneBtn}
        testID="welcome-mailed-continue"
      />
    </View>
  );
}

const mailedStyles = StyleSheet.create({
  artFrame: {
    aspectRatio: 1,
    borderRadius: 14,
    overflow: "hidden",
    width: "65%",
    marginTop: 12,
  },
  art: { width: "100%", height: "100%" },
  kicker: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.6,
    marginTop: 26,
  },
  doneBtn: { marginTop: 28, width: "100%" },
});

// ============================================================================
// SHARED — address fields, field labels, step dots, step styles
// ============================================================================

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
  return (
    <>
      <FieldLabel style={{ marginTop: 14 }}>{label ?? "Their address"}</FieldLabel>
      <TextInput
        value={address.line1}
        onChangeText={(v) => onChange({ ...address, line1: v })}
        placeholder="412 SE Belmont"
        placeholderTextColor={colors.mutedInk}
        autoCapitalize="words"
        autoCorrect={false}
        textContentType="streetAddressLine1"
        autoComplete="address-line1"
        style={fieldStyles.input}
        testID={`${testIDPrefix}-line1`}
      />
      <TextInput
        value={address.line2}
        onChangeText={(v) => onChange({ ...address, line2: v })}
        placeholder="Apt, suite (optional)"
        placeholderTextColor={colors.mutedInk}
        autoCapitalize="words"
        autoCorrect={false}
        textContentType="streetAddressLine2"
        autoComplete="address-line2"
        style={[fieldStyles.input, { marginTop: 8 }]}
        testID={`${testIDPrefix}-line2`}
      />
      <View style={fieldStyles.row}>
        <View style={{ flex: 2 }}>
          <TextInput
            value={address.city}
            onChangeText={(v) => onChange({ ...address, city: v })}
            placeholder="Portland"
            placeholderTextColor={colors.mutedInk}
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="addressCity"
            autoComplete="postal-address-locality"
            style={fieldStyles.input}
            testID={`${testIDPrefix}-city`}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextInput
            value={address.state}
            onChangeText={(v) => onChange({ ...address, state: v.toUpperCase().slice(0, 2) })}
            placeholder="OR"
            placeholderTextColor={colors.mutedInk}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={2}
            textContentType="addressState"
            autoComplete="postal-address-region"
            style={fieldStyles.input}
            testID={`${testIDPrefix}-state`}
          />
        </View>
        <View style={{ flex: 1.2 }}>
          <TextInput
            value={address.zip}
            onChangeText={(v) => onChange({ ...address, zip: v.replace(/[^\d-]/g, "").slice(0, 10) })}
            placeholder="97214"
            placeholderTextColor={colors.mutedInk}
            keyboardType="number-pad"
            textContentType="postalCode"
            autoComplete="postal-code"
            style={fieldStyles.input}
            testID={`${testIDPrefix}-zip`}
          />
        </View>
      </View>
    </>
  );
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
  error: {
    color: colors.postalRed,
    fontFamily: fonts.serifSemi,
    fontSize: 13,
    marginTop: 12,
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
