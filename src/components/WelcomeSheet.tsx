import { Sparkles } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { Stamp } from "@/src/components/Stamp";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * First-launch welcome flow. Captures the user's name + city so the
 * Mail Card has their identity instead of the default "Scotty" placeholder.
 *
 * Shown ONCE: dismisses when the user submits or skips, then sets
 * `hasSeenFreeCreditsIntro` so the smaller free-credits banner doesn't
 * also re-introduce them.
 */
export function WelcomeSheet({ visible, onComplete }: { visible: boolean; onComplete: () => void }) {
  const { completeSignup } = useMailClub();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);

  const canContinue = name.trim().length > 0;

  async function submit() {
    if (!canContinue) return;
    setSaving(true);
    await completeSignup({ name, city, state });
    setSaving(false);
    onComplete();
  }

  async function skip() {
    // Skip still wipes the mock friends/routes so the app feels fresh.
    // Identity gets a placeholder; the user can fill it in later via Edit Mail Card.
    await completeSignup({ name: "", city: "", state: "" });
    onComplete();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <Text style={styles.brand}>Mail Club</Text>
          <View style={styles.stamp}>
            <Stamp motif="dove" tone="red" cents="1¢" rotate={-8} size="sm" />
          </View>
        </View>

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
            title={saving ? "Saving..." : "Start writing"}
            onPress={submit}
            disabled={!canContinue || saving}
          />
          <Pressable onPress={skip} style={styles.skipBtn} testID="welcome-skip" accessibilityRole="button">
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, gap: 16, paddingHorizontal: 22, paddingTop: 64, paddingBottom: 30 },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 12 },
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
});
