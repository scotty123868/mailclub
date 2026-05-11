import { ArrowLeft, Mail, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { Stamp } from "@/src/components/Stamp";
import { SUPABASE_CONFIGURED } from "@/src/services/supabase";
import { useMailClub } from "@/src/state/MailClubContext";
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
  const { completeSignup, signInWithEmail } = useMailClub();
  const [step, setStep] = useState<Step>("identity");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = name.trim().length > 0;
  const canSubmit = email.trim().includes("@") && password.length >= 8;

  function reset() {
    setStep("identity");
    setName("");
    setCity("");
    setState("");
    setEmail("");
    setPassword("");
    setMode("signup");
    setSaving(false);
    setError(null);
  }

  async function continueFromIdentity() {
    if (!canContinue) return;
    setError(null);
    if (!SUPABASE_CONFIGURED) {
      // No backend in this build → finish with identity only (tests, dev).
      setSaving(true);
      await completeSignup({ name, city, state });
      setSaving(false);
      reset();
      onComplete();
      return;
    }
    setStep("account");
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
      await completeSignup({ name, city, state, email: email.trim(), password });
      reset();
      onComplete();
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    await completeSignup({ name: "", city: "", state: "" });
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
              <Text style={styles.brand}>Mail Club</Text>
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
                  <Text style={styles.title}>Welcome to Mail Club.</Text>
                  <Text style={styles.body}>Real postcards, sent by you, to the people who matter. Tell us who's writing.</Text>
                </View>
              </View>

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
                    onChangeText={setState}
                    placeholder="CO"
                    placeholderTextColor="#9A8D76"
                    style={[styles.input, { flex: 1 }]}
                    testID="welcome-state"
                    returnKeyType="done"
                    maxLength={3}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.gift}>
                <Sparkles color={colors.postalRed} size={16} strokeWidth={1.7} />
                <Text style={styles.giftText}>
                  5 free credits on us. That's enough for two photo postcards or five handwritten notes.
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
                  <CircularPostmark size={86} topText="MAIL CLUB" bottomText="MEMBERSHIP" centerYear="" />
                </View>
                <View style={styles.heroCopy}>
                  <Text style={styles.title}>
                    {mode === "signup" ? "One more thing." : "Welcome back."}
                  </Text>
                  <Text style={styles.body}>
                    {mode === "signup"
                      ? "An email + password so your Mail Card finds you on every device."
                      : "Sign in with the email and password you used last time."}
                  </Text>
                </View>
              </View>

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

              <View style={styles.footer}>
                <PrimaryButton
                  title={saving ? (mode === "signup" ? "Creating account..." : "Signing in...") : (mode === "signup" ? "Create my Mail Card" : "Sign in")}
                  icon={Mail}
                  onPress={submitAccount}
                  disabled={!canSubmit || saving}
                />
                <Pressable
                  onPress={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); }}
                  style={styles.skipBtn}
                  testID="welcome-toggle-mode"
                  accessibilityRole="button"
                >
                  <Text style={styles.skipText}>
                    {mode === "signup" ? "I already have an account" : "Create a new account"}
                  </Text>
                </Pressable>
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
  field: { gap: 6 },
  label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
  input: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 18, paddingHorizontal: 14, paddingVertical: 12 },
  cityRow: { flexDirection: "row", gap: 10 },
  gift: { alignItems: "center", backgroundColor: "rgba(217,180,110,0.18)", borderColor: "rgba(217,180,110,0.6)", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 10, padding: 12 },
  giftText: { color: colors.ink, flex: 1, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17 },
  footer: { gap: 8, marginTop: 20, paddingTop: 16 },
  skipBtn: { alignItems: "center", paddingVertical: 10 },
  skipText: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 14, textDecorationLine: "underline" },
  error: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 13, marginTop: 4, textAlign: "center" },
});
