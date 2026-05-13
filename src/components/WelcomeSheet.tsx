import * as AppleAuthentication from "expo-apple-authentication";
import { ArrowLeft, ArrowRight } from "lucide-react-native";
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
 * WelcomeSheet — v0.6.1 streamlined sign-up.
 *
 * Per user feedback after v0.6.0 TestFlight (build 6):
 *   - The "Mailroom mails real postcards" pause page was too text-heavy and
 *     redundant with the hero tagline. DELETED.
 *   - The single-bar address input with strict comma parsing was blocking
 *     users from completing signup. iOS QuickType only suggests addresses
 *     if the user has one saved in Contacts, which most don't. REPLACED
 *     with separate City + State fields (the only two we actually persist
 *     to the profile in v0.6.x — line1/zip were thrown away anyway).
 *
 * Step machine now:
 *   1. hero        — brand art, "Mail a photo for less than a stamp.", Apple
 *                    Sign In primary + "Sign up with email" secondary
 *   1b. auth-email — email + password fallback (sign-up or sign-in)
 *   2. name        — "What should your friends call you?" single input
 *   3. city        — "Where do you mail from?" City + State, two fields
 *   4. done        — "3 stamps, on us." celebration + first-send CTA
 *
 * Full street/zip will be collected later when the user first receives a
 * card via the magic-link reciprocation loop (Phase 7).
 *
 * Auth contract is unchanged. The context still exposes:
 *   - signInWithApple(), returns { ok, isNewUser, fullName, email }
 *   - signInWithEmail(email, password)
 *   - signUpWithEmail(email, password)
 *   - completeSignup({ name, city, state, birthday?, email?, password? })
 */

type Step = "hero" | "auth-email" | "name" | "city" | "done";

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
  // v0.6.1: city + state directly. The strict comma-parser of 0.6.0 was
  // blocking users — switched to discrete fields that iOS can autofill
  // individually via textContentType.
  const [city, setCity] = useState("");
  const [stateAbbr, setStateAbbr] = useState("");

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
      setCity("");
      setStateAbbr("");
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
  const trimmedState = stateAbbr.trim().toUpperCase();
  const canAdvanceCity =
    city.trim().length > 0 && /^[A-Z]{2}$/.test(trimmedState);
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
      // codex Phase 6 P1: don't trust `isNewUser` from the Apple service
      // alone — Apple returns isNewUser based on whether the relying-party
      // identifier has seen this Apple ID before, not whether the Mailroom
      // profile is complete. A returning Apple user who never finished
      // signup (e.g. crashed on the address page) would be misclassified
      // as "returning" and the sheet would close, stranding them with no
      // profile.
      //
      // The context-side useEffect on `hasCompletedSignup` is the truth.
      // We always advance to step "name" for the profile-collection branch
      // UNLESS the context already knows hasCompletedSignup. In that case,
      // the close-on-completed-signup effect fires naturally.
      if (result.isNewUser || !hasCompletedSignup) {
        setStep("name");
      }
      // else: returning user with complete profile; the
      // hasCompletedSignup useEffect at top of component closes the sheet.
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
        // codex Phase 6 P1: Sign-in may land an incomplete-profile user
        // (auth ok but profile row missing fields). If hasCompletedSignup
        // is already true, the useEffect at top of component closes the
        // sheet. If NOT, route through name + address collection so they
        // can complete. Without this, an incomplete user would silently
        // get stuck on this page forever.
        if (!hasCompletedSignup) {
          setStep("name");
        }
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
      await completeSignup({
        name: name.trim(),
        city: city.trim(),
        state: trimmedState,
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
    else if (step === "city") setStep("name");
    else if (step === "auth-email") setStep("hero");
    else if (step === "done") setStep("city");
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
              onContinue={() => setStep("city")}
            />
          ) : null}

          {step === "city" ? (
            <CityStep
              city={city}
              onCityChange={setCity}
              stateAbbr={stateAbbr}
              onStateChange={setStateAbbr}
              canContinue={canAdvanceCity}
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
      <StepDots count={3} active={0} />
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
// STEP 3 — CITY + STATE
// ============================================================================
//
// v0.6.1: replaced the single-bar address parser with discrete City + State
// fields. We only ever persisted city + state in v0.6.x anyway (line1/zip
// were thrown away), and iOS only auto-suggests addresses if one is saved
// in Contacts — most users got stuck. Two fields, two textContentTypes,
// done. Full address can be collected later when the first reply needs
// somewhere to land (Phase 7).

function CityStep({
  city,
  onCityChange,
  stateAbbr,
  onStateChange,
  canContinue,
  onContinue,
  saving,
  error,
}: {
  city: string;
  onCityChange: (v: string) => void;
  stateAbbr: string;
  onStateChange: (v: string) => void;
  canContinue: boolean;
  onContinue: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <View style={stepStyles.wrap} testID="welcome-step-city">
      <StepDots count={3} active={1} />
      <Text style={stepStyles.title}>Where do you{"\n"}mail from?</Text>
      <Text style={stepStyles.subtitle}>
        Friends will see "from {city.trim() || "your city"}" on the postcards you send. Your full
        address stays private — we ask for it later, only when someone mails you back.
      </Text>

      <View style={cityStyles.row}>
        <View style={cityStyles.cityCol}>
          <Text style={cityStyles.label}>City</Text>
          <TextInput
            value={city}
            onChangeText={onCityChange}
            placeholder="Boise"
            placeholderTextColor={colors.mutedInk}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="addressCity"
            autoComplete="postal-address-locality"
            style={cityStyles.input}
            testID="welcome-city"
            returnKeyType="next"
            maxLength={64}
          />
        </View>
        <View style={cityStyles.stateCol}>
          <Text style={cityStyles.label}>State</Text>
          <TextInput
            value={stateAbbr}
            onChangeText={(v) => onStateChange(v.toUpperCase().slice(0, 2))}
            placeholder="ID"
            placeholderTextColor={colors.mutedInk}
            autoCapitalize="characters"
            autoCorrect={false}
            textContentType="addressState"
            autoComplete="postal-address-region"
            style={cityStyles.input}
            testID="welcome-state"
            returnKeyType="done"
            maxLength={2}
            onSubmitEditing={canContinue && !saving ? onContinue : undefined}
          />
        </View>
      </View>

      <Text style={cityStyles.helper}>
        Two-letter state code, like CA or NY.
      </Text>

      {error ? (
        <Text style={cityStyles.error} testID="welcome-city-error">
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        title={saving ? "Almost there..." : "Continue →"}
        onPress={onContinue}
        disabled={!canContinue || saving}
        style={stepStyles.continueBtn}
        testID="welcome-city-continue"
      />
    </View>
  );
}

const cityStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, marginTop: 20 },
  cityCol: { flex: 3, gap: 6 },
  stateCol: { flex: 1, gap: 6, minWidth: 80 },
  label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 13 },
  input: {
    backgroundColor: "rgba(245, 240, 230, 0.6)",
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1.5,
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  helper: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 17, marginTop: 8 },
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

// (v0.6.0's strict address parser was removed in 0.6.1 — discrete City +
// State inputs replaced it. See CityStep above.)

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
