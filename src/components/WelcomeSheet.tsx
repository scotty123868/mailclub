import * as AppleAuthentication from "expo-apple-authentication";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
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
 * WelcomeSheet — v0.6.0 multi-page sign-up.
 *
 * Per the SIGNUP_AND_PENPAL_GALLERY.html review:
 *   1. hero        — brand art, "Mail a photo for less than a stamp.", Apple
 *                    Sign In primary + "Sign up with email" secondary
 *   1b. auth-email — email + password fallback (sign-up or sign-in)
 *   2. name        — "What should your friends call you?" single input
 *   3. explain     — "Mailroom mails real postcards." pause page
 *   4. address     — "Where do you mail from?" single-bar input (iOS
 *                    autofill via textContentType=fullStreetAddress; we
 *                    parse on submit, store city/state on profile, retain
 *                    full address client-side for the receive-mail loop)
 *   5. done        — "3 stamps, on us." celebration + first-send CTA
 *
 * Auth contract is unchanged. The context still exposes:
 *   - signInWithApple(), returns { ok, isNewUser, fullName, email }
 *   - signInWithEmail(email, password)
 *   - signUpWithEmail(email, password)
 *   - completeSignup({ name, city, state, birthday?, email?, password? })
 *
 * We call completeSignup at the END of the flow (after the address page) so
 * every signup hits the same code path that 0.5.x users went through. This
 * preserves backwards-compat: existing users signing back in via Apple skip
 * the whole multi-page flow because `hasCompletedSignup` becomes true and
 * WelcomeGate hides the sheet immediately.
 *
 * Birthday is intentionally DROPPED from signup. The Friend type still has
 * birthday for adding individual friends; current-user profile field stays
 * in the type but is no longer set during onboarding.
 */

type Step = "hero" | "auth-email" | "name" | "explain" | "address" | "done";

const HERO_FOLK_MAP = require("@/assets/onboarding/hero-folk-map.png");
const HERO_MAILBOX = require("@/assets/onboarding/hero-mailbox.png");

export function WelcomeSheet({
  visible,
  onComplete,
}: {
  visible: boolean;
  onComplete: () => void;
}) {
  const { completeSignup, signInWithEmail, signInWithApple, resetPassword, hasCompletedSignup } =
    useMailClub();

  // -- Step state ---------------------------------------------------------
  const [step, setStep] = useState<Step>("hero");

  // -- Profile data -------------------------------------------------------
  const [name, setName] = useState("");
  const [addressLine, setAddressLine] = useState(""); // single-bar raw
  const [parsedCity, setParsedCity] = useState("");
  const [parsedState, setParsedState] = useState("");

  // -- Email fallback path ------------------------------------------------
  const [emailMode, setEmailMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // -- Apple Sign In status ----------------------------------------------
  const [appleAvailable, setAppleAvailable] = useState(false);
  // Set when Apple Sign In completes successfully. From that point on we
  // skip the email/password page on the back path.
  const [appleSignedIn, setAppleSignedIn] = useState(false);

  // -- UX flags -----------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Phase 3.5: pending invite copy on the hero page when arriving via a
  // QR scan.
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
        const info = await lookupReciprocation(pending.token);
        if (cancelled) return;
        if (info.ok) {
          const first = (info.sender_name ?? "Someone").split(" ")[0];
          const place = info.sender_city ? ` in ${info.sender_city}` : "";
          setPendingInviteCopy(
            `${first}${place} sent you a postcard. We'll add them to your rolodex when you finish signing up.`,
          );
        }
      } catch {
        // ignore — note is nice-to-have
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Reset everything when the sheet transitions to hidden so a sign-out +
  // re-open starts at the hero again.
  useEffect(() => {
    if (!visible) {
      setStep("hero");
      setName("");
      setAddressLine("");
      setParsedCity("");
      setParsedState("");
      setEmail("");
      setPassword("");
      setEmailMode("signup");
      setAppleSignedIn(false);
      setSaving(false);
      setError(null);
      setInfo(null);
    }
  }, [visible]);

  // If `hasCompletedSignup` flips true mid-flow (e.g. context restored a
  // session via Apple Sign In on app cold-start), close immediately. This
  // covers the returning-user path without us having to thread state.
  useEffect(() => {
    if (hasCompletedSignup) {
      onComplete();
    }
  }, [hasCompletedSignup, onComplete]);

  // -- Validators ---------------------------------------------------------

  const canAdvanceName = name.trim().length > 0;
  // Address parser: accepts "Line 1, City, ST ZIP" or "Line 1, City, ST, ZIP".
  // Stores parsed parts so the address page can show inline validation +
  // store the canonical pieces on submit.
  const parsedAddress = parseAddress(addressLine);
  const canAdvanceAddress = parsedAddress !== null;
  const canAdvanceEmail =
    email.trim().includes("@") && password.length >= 8 && !saving;

  // -- Hero page actions --------------------------------------------------

  async function onAppleSignIn() {
    setError(null);
    setSaving(true);
    try {
      const result = await signInWithApple();
      if (!result.ok) {
        if (!result.cancelled) {
          setError(result.error ?? "Apple sign-in didn't work.");
        }
        return;
      }
      setAppleSignedIn(true);
      if (result.fullName) setName(result.fullName);
      if (!result.isNewUser) {
        // Returning user — `hasCompletedSignup` will flip; the effect above
        // closes the sheet. Just bail out here.
        return;
      }
      // New Apple user — collect name + address.
      setStep("name");
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
          setError(result.error ?? "Couldn't sign in.");
          return;
        }
        // Sign-in succeeded — `hasCompletedSignup` flips, sheet closes.
        return;
      }
      // Sign-up path: defer the actual signup to the final step (page 5);
      // we just bank the email + password and move on to name collection.
      // This way, completeSignup runs ONCE at the end with the full profile.
      setStep("name");
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
      setError(result.error ?? "Couldn't send the reset email.");
    }
  }

  // -- Final commit -------------------------------------------------------

  async function finish() {
    setError(null);
    setSaving(true);
    try {
      // Save the parsed address pieces. completeSignup currently only writes
      // city + state to the profile; the full street/zip are kept locally
      // for now until the 0.6.x profile-address migration lands.
      const parsed = parseAddress(addressLine);
      const city = parsed?.city || parsedCity;
      const state = parsed?.state || parsedState;

      await completeSignup({
        name,
        city,
        state,
        // Birthday intentionally omitted. Friend-birthday collection still
        // happens on Add Friend.
        email: appleSignedIn ? undefined : email.trim() || undefined,
        password: appleSignedIn ? undefined : password || undefined,
      });
      setStep("done");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't finish signup.");
    } finally {
      setSaving(false);
    }
  }

  // Dev / no-backend escape hatch (matches the prior WelcomeSheet behavior).
  async function maybeFastForward() {
    if (!SUPABASE_CONFIGURED) {
      await completeSignup({ name: "", city: "", state: "" });
      onComplete();
    }
  }

  // -- Step nav helpers ---------------------------------------------------

  function back() {
    if (step === "name") setStep(appleSignedIn ? "hero" : "auth-email");
    else if (step === "explain") setStep("name");
    else if (step === "address") setStep("explain");
    else if (step === "auth-email") setStep("hero");
    else if (step === "done") setStep("address");
    // step === "hero" → no-op; the sheet is modal
  }

  // -- Render -------------------------------------------------------------

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        // Disallow back-out from the modal. Signup is required.
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
          {step !== "hero" && step !== "done" ? (
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

          {step === "name" ? (
            <NameStep
              name={name}
              onNameChange={setName}
              canContinue={canAdvanceName}
              onContinue={() => setStep("explain")}
            />
          ) : null}

          {step === "explain" ? (
            <ExplainStep onContinue={() => setStep("address")} />
          ) : null}

          {step === "address" ? (
            <AddressStep
              addressLine={addressLine}
              onAddressChange={setAddressLine}
              parsed={parsedAddress}
              canContinue={canAdvanceAddress}
              onContinue={finish}
              saving={saving}
              error={error}
            />
          ) : null}

          {step === "done" ? (
            <DoneStep
              firstName={(name || "").split(" ")[0] || "you"}
              onDismiss={() => {
                onComplete();
              }}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ============================================================================
// STEP 1 — HERO
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
        <Text style={heroStyles.tagline}>Mail a photo for less than a stamp.</Text>
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
  artFrame: {
    aspectRatio: 1,
    borderRadius: 18,
    overflow: "hidden",
    width: "100%",
  },
  art: { width: "100%", height: "100%" },
  textBlock: { alignItems: "center", gap: 10, marginTop: 4 },
  wordmark: {
    color: colors.ink,
    fontFamily: fonts.script,
    fontSize: 44,
    lineHeight: 46,
  },
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
  inviteKicker: {
    color: colors.postalBlue,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.6,
  },
  inviteBody: {
    color: colors.ink,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 19,
  },
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
// STEP 1b — EMAIL AUTH
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
// STEP 2 — NAME
// ============================================================================

function NameStep({
  name,
  onNameChange,
  canContinue,
  onContinue,
}: {
  name: string;
  onNameChange: (v: string) => void;
  canContinue: boolean;
  onContinue: () => void;
}) {
  return (
    <View style={stepStyles.wrap} testID="welcome-step-name">
      <StepDots count={4} active={0} />
      <Text style={stepStyles.title}>What should{"\n"}your friends call you?</Text>
      <Text style={stepStyles.subtitle}>
        Just a first name is fine. We'll print it on the back of the postcards you send.
      </Text>
      <TextInput
        value={name}
        onChangeText={onNameChange}
        placeholder="Scotty"
        placeholderTextColor={colors.mutedInk}
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
        textContentType="givenName"
        style={stepStyles.bigInput}
        testID="welcome-name"
        returnKeyType="next"
        onSubmitEditing={canContinue ? onContinue : undefined}
        maxLength={48}
      />
      <PrimaryButton
        title="Continue →"
        onPress={onContinue}
        disabled={!canContinue}
        style={stepStyles.continueBtn}
        testID="welcome-name-continue"
      />
    </View>
  );
}

// ============================================================================
// STEP 3 — EXPLAIN
// ============================================================================

function ExplainStep({ onContinue }: { onContinue: () => void }) {
  return (
    <View style={stepStyles.wrap} testID="welcome-step-explain">
      <StepDots count={4} active={1} />
      <Text style={stepStyles.title}>Mailroom mails{"\n"}real postcards.</Text>
      <Text style={[stepStyles.subtitle, { fontSize: 15, lineHeight: 24, marginTop: 18 }]}>
        Pick a photo. Write a few words. We print it, stamp it, and mail it through USPS. Costs 80¢
        each, less than the stamp would be on its own.
        {"\n\n"}
        <Text style={{ color: colors.ink, fontFamily: fonts.serifSemi }}>
          We give you 3 to start, on us.
        </Text>
      </Text>
      <View style={explainStyles.quietRow}>
        <Mail color={colors.mutedInk} size={20} strokeWidth={1.6} />
        <Text style={explainStyles.quietText}>No feed. No algorithm.{"\n"}Just real mail to real people.</Text>
      </View>
      <PrimaryButton
        title="Got it →"
        onPress={onContinue}
        style={stepStyles.continueBtn}
        testID="welcome-explain-continue"
      />
    </View>
  );
}

const explainStyles = StyleSheet.create({
  quietRow: {
    alignItems: "center",
    backgroundColor: "rgba(245, 240, 230, 0.5)",
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    marginTop: 32,
    padding: 18,
  },
  quietText: { color: colors.ink, fontFamily: fonts.serifItalic, fontSize: 14, lineHeight: 20 },
});

// ============================================================================
// STEP 4 — ADDRESS
// ============================================================================

function AddressStep({
  addressLine,
  onAddressChange,
  parsed,
  canContinue,
  onContinue,
  saving,
  error,
}: {
  addressLine: string;
  onAddressChange: (v: string) => void;
  parsed: ParsedAddress | null;
  canContinue: boolean;
  onContinue: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <View style={stepStyles.wrap} testID="welcome-step-address">
      <StepDots count={4} active={2} />
      <Text style={stepStyles.title}>Where do you{"\n"}mail from?</Text>
      <Text style={stepStyles.subtitle}>
        Friends will see "from {parsed?.city || "your city"}" on the postcards you send. Your full
        address stays private.
      </Text>
      <TextInput
        value={addressLine}
        onChangeText={onAddressChange}
        placeholder="5209 Dorset Ave, Boise, ID 83706"
        placeholderTextColor={colors.mutedInk}
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
        textContentType="fullStreetAddress"
        autoComplete="postal-address"
        style={[stepStyles.bigInput, { fontSize: 17 }]}
        testID="welcome-address"
        returnKeyType="done"
        onSubmitEditing={canContinue && !saving ? onContinue : undefined}
        multiline={false}
      />
      <Text style={addressStyles.helper}>
        Street, city, state, ZIP — comma-separated. iOS may suggest saved addresses if you have any.
      </Text>

      {parsed ? (
        <View style={addressStyles.parsedRow}>
          <Text style={addressStyles.parsedCheck}>✓</Text>
          <Text style={addressStyles.parsedText}>
            {parsed.line1}, {parsed.city}, {parsed.state} {parsed.zip}
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text style={addressStyles.error} testID="welcome-address-error">
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        title={saving ? "Almost there..." : "Continue →"}
        onPress={onContinue}
        disabled={!canContinue || saving}
        style={stepStyles.continueBtn}
        testID="welcome-address-continue"
      />
    </View>
  );
}

const addressStyles = StyleSheet.create({
  helper: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 17, marginTop: 8 },
  parsedRow: {
    alignItems: "center",
    backgroundColor: "rgba(96,122,85,0.10)",
    borderColor: "rgba(96,122,85,0.4)",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    padding: 12,
  },
  parsedCheck: { color: "#3F5A3A", fontFamily: fonts.serifSemi, fontSize: 18 },
  parsedText: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 14, lineHeight: 18 },
  error: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 13, marginTop: 12 },
});

// ============================================================================
// STEP 5 — DONE
// ============================================================================

function DoneStep({ firstName, onDismiss }: { firstName: string; onDismiss: () => void }) {
  return (
    <View style={[stepStyles.wrap, { alignItems: "center" }]} testID="welcome-step-done">
      <View style={doneStyles.artFrame}>
        <Image
          source={HERO_MAILBOX}
          style={doneStyles.art}
          resizeMode="cover"
          accessibilityLabel="Hands at the mailbox"
        />
      </View>
      <Text style={doneStyles.kicker}>YOU'RE IN</Text>
      <Text style={[stepStyles.title, { textAlign: "center", marginTop: 8 }]}>
        3 stamps,{"\n"}on us, {firstName}.
      </Text>
      <Text style={[stepStyles.subtitle, { textAlign: "center", maxWidth: 320, marginTop: 12 }]}>
        Pick a photo, write a note, send it. Real postcards to anyone you know.
      </Text>
      <PrimaryButton
        title="Send my first card →"
        onPress={onDismiss}
        style={doneStyles.doneBtn}
        testID="welcome-done-continue"
      />
    </View>
  );
}

const doneStyles = StyleSheet.create({
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
// STEP DOTS
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
  bigInput: {
    backgroundColor: "rgba(245, 240, 230, 0.6)",
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1.5,
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 24,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  continueBtn: { marginTop: 24 },
});

// ============================================================================
// ADDRESS PARSER
// ============================================================================

type ParsedAddress = {
  line1: string;
  city: string;
  state: string;
  zip: string;
};

/**
 * Parse a single-bar address into structured pieces. Accepts the canonical
 * USPS format with commas:
 *   "5209 Dorset Ave, Boise, ID 83706"
 *   "123 Main St, Apt 4B, Brooklyn, NY 11211"  (apt in second comma slot)
 *
 * Returns null if the input doesn't parse cleanly. The UI uses this both
 * to validate (gate the Continue button) and to surface a green-check
 * confirmation row showing what we parsed.
 *
 * Not USPS-authoritative — Lob's address verification API runs server-side
 * on send. This is just enough to extract city + state for the profile so
 * we have something to show on the postcard back's FROM line.
 */
function parseAddress(input: string): ParsedAddress | null {
  if (!input || !input.trim()) return null;
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length < 3) return null;

  // The state + ZIP live in the LAST part: "ST ZIP" or "ST ZIP-NNNN".
  const lastPart = parts[parts.length - 1];
  const stateZipMatch = lastPart.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!stateZipMatch) return null;

  // The city is the second-to-last part.
  const city = parts[parts.length - 2];
  if (!city) return null;

  // Everything before the city is line 1 (and optional line 2). We join
  // them back with commas so a 3-part address with apt still preserves
  // the apt info in line1.
  const line1 = parts.slice(0, parts.length - 2).join(", ");

  return {
    line1,
    city,
    state: stateZipMatch[1].toUpperCase(),
    zip: stateZipMatch[2],
  };
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, gap: 16, paddingHorizontal: 22, paddingTop: 56, paddingBottom: 30 },
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
