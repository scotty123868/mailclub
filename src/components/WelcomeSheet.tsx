import * as AppleAuthentication from "expo-apple-authentication";
import { ArrowLeft, Mail, Sparkles } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { Stamp } from "@/src/components/Stamp";
import { isAppleSignInAvailable } from "@/src/services/apple-auth";
import { lookupReciprocation } from "@/src/services/api";
import { SUPABASE_CONFIGURED } from "@/src/services/supabase";
import { useMailClub } from "@/src/state/MailClubContext";
import { peekPendingInvite } from "@/src/state/pendingInvite";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * First-launch flow. Two steps now that the backend is wired:
 *   1. Identity — name + city + state (existing).
 *   2. Account — email + password (new). Optional toggle to sign in
 *      with an existing account instead of creating a new one.
 *
 * When SUPABASE_CONFIGURED is false (tests, offline), the account step
 * is skipped automatically — the context falls back to local-only.
 */
type Step = "identity" | "account";

export function WelcomeSheet({ visible, onComplete }: { visible: boolean; onComplete: () => void }) {
  const { completeSignup, signInWithEmail, resetPassword, signInWithApple } = useMailClub();
  const [step, setStep] = useState<Step>("identity");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [birthday, setBirthday] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [saving, setSaving] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Phase 3.5: render a "you have mail waiting" note at the top of the
  // identity step when a pre-signup QR scan stashed a token. We do a public
  // lookup to get the sender's name + city so the copy is specific. Best
  // effort — if the lookup fails, no note shown but the consume still fires
  // post-signup via the pendingInvite helper.
  const [pendingInviteNote, setPendingInviteNote] = useState<string | null>(null);

  // Probe for Apple Sign-In availability once on mount
  useEffect(() => {
    let mounted = true;
    isAppleSignInAvailable().then((available) => {
      if (mounted) setAppleAvailable(available);
    });
    return () => { mounted = false; };
  }, []);

  // Phase 3.5: when the sheet opens, see if a QR-scan token is pending.
  // If so, fetch sender display info for the inline note. Idempotent on
  // re-open (peek doesn't consume).
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
          setPendingInviteNote(
            `${first}${place} sent you a postcard. We'll add them to your rolodex as soon as you finish signing up.`,
          );
        }
      } catch {
        // ignore — note is a nice-to-have, not a blocker
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const canContinue = name.trim().length > 0 && isValidBirthday(birthday);
  const canSubmit = email.trim().includes("@") && password.length >= 8;

  function reset() {
    setStep("identity");
    setName("");
    setCity("");
    setState("");
    setBirthday("");
    setEmail("");
    setPassword("");
    setMode("signup");
    setSaving(false);
    setError(null);
    setInfo(null);
  }

  /**
   * Auto-format MM/DD as the user types. We accept either MM/DD or M/D and
   * pad to MM/DD on persistence. Year intentionally left out — we only need
   * birthday for sending birthday cards, not for age.
   */
  function onChangeBirthday(raw: string) {
    // Strip non-digits then re-insert the slash after 2 chars.
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    if (digits.length <= 2) {
      setBirthday(digits);
    } else {
      setBirthday(`${digits.slice(0, 2)}/${digits.slice(2)}`);
    }
  }

  function isValidBirthday(b: string): boolean {
    if (b.length === 0) return true; // optional
    const m = b.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) return false;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    // Roundtrip through a real Date to reject impossible month-day pairs
    // (Feb 30, Apr 31, etc.). Use 2024 (a leap year) as the synthetic year
    // so Feb 29 always passes — we don't collect a year, so leap-day
    // birthdays should be valid regardless of "now."
    const d = new Date(2024, month - 1, day);
    return d.getMonth() === month - 1 && d.getDate() === day;
  }

  async function onForgotPassword() {
    setError(null);
    setInfo(null);
    if (!email.trim().includes("@")) {
      setError("Enter your email above first, then tap forgot password.");
      return;
    }
    const result = await resetPassword(email.trim());
    if (result.ok) {
      setInfo("Check your inbox for a reset link.");
    } else {
      setError(result.error ?? "Couldn't send the reset email.");
    }
  }

  async function continueFromIdentity() {
    if (!canContinue) return;
    setError(null);
    if (!SUPABASE_CONFIGURED) {
      // No backend in this build → finish with identity only (tests, dev).
      setSaving(true);
      await completeSignup({ name, city, state, birthday });
      setSaving(false);
      reset();
      onComplete();
      return;
    }
    setStep("account");
  }

  async function onContinueWithApple() {
    setError(null);
    setSaving(true);
    try {
      const result = await signInWithApple();
      if (!result.ok) {
        if (!result.cancelled) setError(result.error ?? "Apple sign-in didn't work.");
        return;
      }
      // Apple gave us a session. If it's a brand new user without a name
      // collected yet, route back to the identity step so they can fill in
      // city + state. Otherwise we're done.
      if (result.isNewUser && !result.fullName) {
        setStep("identity");
      } else {
        // If Apple gave us a name, store it locally and complete signup.
        if (result.fullName) setName(result.fullName);
        await completeSignup({
          name: result.fullName ?? name,
          city,
          state,
          birthday,
          email: result.email ?? undefined,
        });
        reset();
        onComplete();
      }
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function submitAccount() {
    if (!canSubmit) return;
    setError(null);
    setSaving(true);
    try {
      if (mode === "signin") {
        const result = await signInWithEmail(email.trim(), password);
        if (!result.ok) {
          setError(result.error ?? "Couldn't sign in.");
          return;
        }
        reset();
        onComplete();
        return;
      }
      // signup path
      await completeSignup({ name, city, state, birthday, email: email.trim(), password });
      reset();
      onComplete();
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    await completeSignup({ name: "", city: "", state: "", birthday: "" });
    reset();
    onComplete();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.paper }}>
        <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
          <View style={styles.brandRow}>
            {step === "account" ? (
              <Pressable onPress={() => { setStep("identity"); setError(null); }} hitSlop={10} testID="welcome-back-to-identity">
                <ArrowLeft color={colors.ink} size={26} strokeWidth={1.5} />
              </Pressable>
            ) : (
              <Text style={styles.brand}>Mailroom</Text>
            )}
            <View style={styles.stamp}>
              <Stamp motif="dove" tone="red" cents="1¢" rotate={-8} size="sm" />
            </View>
          </View>

          {step === "identity" ? (
            <>
              <View style={styles.heroRow}>
                <View style={styles.postmark}>
                  <CircularPostmark size={102} topText="HAND CARRIED" bottomText="WITH CARE" centerYear={String(new Date().getFullYear())} />
                </View>
                <View style={styles.heroCopy}>
                  <Text style={styles.title}>Welcome to Mailroom.</Text>
                  <Text style={styles.body}>Real postcards. Real friends. Less than a stamp.</Text>
                </View>
              </View>

              {pendingInviteNote ? (
                <View style={styles.inviteNote} testID="welcome-pending-invite">
                  <Text style={styles.inviteNoteKicker}>YOU HAVE MAIL</Text>
                  <Text style={styles.inviteNoteBody}>
                    {pendingInviteNote}
                  </Text>
                </View>
              ) : null}

              <View style={styles.field}>
                <Text style={styles.label}>Your name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Scotty"
                  placeholderTextColor="#9A8D76"
                  style={styles.input}
                  autoFocus
                  testID="welcome-name"
                  returnKeyType="next"
                  autoCorrect={false}
                  textContentType="givenName"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Where you're writing from</Text>
                <View style={styles.cityRow}>
                  <TextInput
                    value={city}
                    onChangeText={setCity}
                    placeholder="Denver"
                    placeholderTextColor="#9A8D76"
                    style={[styles.input, { flex: 2 }]}
                    testID="welcome-city"
                    returnKeyType="next"
                    textContentType="addressCity"
                  />
                  <TextInput
                    value={state}
                    onChangeText={(v) => setState(v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))}
                    placeholder="CO"
                    placeholderTextColor="#9A8D76"
                    style={[styles.input, { flex: 1 }]}
                    testID="welcome-state"
                    returnKeyType="done"
                    maxLength={2}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Birthday <Text style={styles.labelMuted}>(optional)</Text></Text>
                <TextInput
                  value={birthday}
                  onChangeText={onChangeBirthday}
                  placeholder="MM/DD"
                  placeholderTextColor="#9A8D76"
                  style={styles.input}
                  testID="welcome-birthday"
                  keyboardType="number-pad"
                  maxLength={5}
                  returnKeyType="done"
                />
                <Text style={styles.helper}>
                  So friends can send you a card on your day. We never share the date.
                </Text>
              </View>

              <View style={styles.gift}>
                <Sparkles color={colors.postalRed} size={16} strokeWidth={1.7} />
                <Text style={styles.giftText}>
                  3 stamps on us — enough to mail 3 photos.
                </Text>
              </View>

              <View style={styles.footer}>
                <PrimaryButton
                  title={saving ? "Saving..." : SUPABASE_CONFIGURED ? "Continue" : "Start writing"}
                  onPress={continueFromIdentity}
                  disabled={!canContinue || saving}
                />
                <Pressable onPress={skip} style={styles.skipBtn} testID="welcome-skip" accessibilityRole="button">
                  <Text style={styles.skipText}>Skip for now</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={styles.heroRow}>
                <View style={styles.postmark}>
                  <CircularPostmark size={86} topText="MAILROOM" bottomText="MEMBERSHIP" centerYear="" />
                </View>
                <View style={styles.heroCopy}>
                  <Text style={styles.title}>
                    {mode === "signup" ? "One more thing." : "Welcome back."}
                  </Text>
                  <Text style={styles.body}>
                    {mode === "signup"
                      ? "Sign in with Apple, or use an email + password."
                      : "Sign in with the email and password you used last time."}
                  </Text>
                </View>
              </View>

              {appleAvailable ? (
                <View style={styles.appleBlock} testID="welcome-apple-block">
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={
                      mode === "signup"
                        ? AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
                        : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                    }
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={10}
                    style={styles.appleButton}
                    onPress={onContinueWithApple}
                  />
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>OR</Text>
                    <View style={styles.dividerLine} />
                  </View>
                </View>
              ) : null}

              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="#9A8D76"
                  style={styles.input}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  testID="welcome-email"
                  returnKeyType="next"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="at least 8 characters"
                  placeholderTextColor="#9A8D76"
                  style={styles.input}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType={mode === "signup" ? "newPassword" : "password"}
                  testID="welcome-password"
                  returnKeyType="done"
                />
              </View>

              {error ? <Text style={styles.error} testID="welcome-auth-error">{error}</Text> : null}
              {info ? <Text style={styles.info} testID="welcome-auth-info">{info}</Text> : null}

              <View style={styles.footer}>
                <PrimaryButton
                  title={saving ? (mode === "signup" ? "Creating account..." : "Signing in...") : (mode === "signup" ? "Create my Mail Card" : "Sign in")}
                  icon={Mail}
                  onPress={submitAccount}
                  disabled={!canSubmit || saving}
                />
                <Pressable
                  onPress={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); setInfo(null); }}
                  style={styles.skipBtn}
                  testID="welcome-toggle-mode"
                  accessibilityRole="button"
                >
                  <Text style={styles.skipText}>
                    {mode === "signup" ? "I already have an account" : "Create a new account"}
                  </Text>
                </Pressable>
                {mode === "signin" ? (
                  <Pressable
                    onPress={onForgotPassword}
                    style={styles.forgotBtn}
                    testID="welcome-forgot-password"
                    accessibilityRole="button"
                  >
                    <Text style={styles.forgotText}>Forgot password?</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, gap: 16, paddingHorizontal: 22, paddingTop: 64, paddingBottom: 30 },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  brand: { color: colors.ink, flex: 1, fontFamily: fonts.script, fontSize: 38, lineHeight: 40 },
  stamp: {},
  heroRow: { alignItems: "center", flexDirection: "row", gap: 14, marginTop: 8 },
  postmark: { opacity: 0.7 },
  heroCopy: { flex: 1 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 26, lineHeight: 30 },
  body: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 15, lineHeight: 20, marginTop: 6 },
  // Phase 3.5: pending-invite note. Rendered at the top of the identity
  // step when the user arrived via a QR scan. Reads like a quiet airmail
  // sticker rather than an urgent banner — the postcard's a gift, not an
  // ad.
  inviteNote: { backgroundColor: "rgba(60,110,143,0.08)", borderColor: "rgba(60,110,143,0.3)", borderRadius: 10, borderWidth: 1, gap: 4, padding: 14 },
  inviteNoteKicker: { color: colors.postalBlue, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 1.6 },
  inviteNoteBody: { color: colors.ink, fontFamily: fonts.serifItalic, fontSize: 14, lineHeight: 19 },
  field: { gap: 6 },
  label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
  labelMuted: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13 },
  helper: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, marginTop: 2 },
  input: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 18, paddingHorizontal: 14, paddingVertical: 12 },
  cityRow: { flexDirection: "row", gap: 10 },
  gift: { alignItems: "center", backgroundColor: "rgba(217,180,110,0.18)", borderColor: "rgba(217,180,110,0.6)", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 10, padding: 12 },
  giftText: { color: colors.ink, flex: 1, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17 },
  footer: { gap: 8, marginTop: 20, paddingTop: 16 },
  skipBtn: { alignItems: "center", paddingVertical: 10 },
  skipText: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 14, textDecorationLine: "underline" },
  error: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 13, marginTop: 4, textAlign: "center" },
  info: { color: "#4A5A38", fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 4, textAlign: "center" },
  forgotBtn: { alignItems: "center", paddingVertical: 6 },
  forgotText: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13 },
  appleBlock: { gap: 14, marginTop: 6 },
  appleButton: { height: 48, width: "100%" },
  dividerRow: { alignItems: "center", flexDirection: "row", gap: 10, marginVertical: 2 },
  dividerLine: { backgroundColor: colors.line, flex: 1, height: 1, opacity: 0.7 },
  dividerText: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 1.2 },
});
