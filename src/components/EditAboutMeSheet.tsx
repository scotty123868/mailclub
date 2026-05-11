import { Check, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { useMailClub } from "@/src/state/MailClubContext";
import type { CurrentUser } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

type EditableKey = "tagline" | "interests" | "sendMe" | "birthday" | "currentlyInto";

const FIELDS: { key: EditableKey; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: "tagline", label: "Tagline", placeholder: "One line about you.", multiline: true },
  { key: "interests", label: "Interests", placeholder: "skiing, books, weird diners" },
  { key: "sendMe", label: "Send me", placeholder: "mountain photos, weird signs" },
  { key: "birthday", label: "Birthday", placeholder: "March 12" },
  { key: "currentlyInto", label: "Currently into", placeholder: "what's on your mind right now" },
];

export function EditAboutMeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { currentUser, updateAboutMe } = useMailClub();
  const [draft, setDraft] = useState<Partial<CurrentUser>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setDraft({});
  }, [visible]);

  function set<K extends EditableKey>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    await updateAboutMe(draft);
    setSaving(false);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>About me</Text>
            <Text style={styles.subtitle}>What other Mail Club members see on your card.</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} testID="edit-about-close" accessibilityRole="button" accessibilityLabel="Close edit about me">
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {FIELDS.map((f) => {
            const value = draft[f.key] ?? currentUser[f.key];
            return (
              <View key={f.key} style={styles.field}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput
                  value={value as string}
                  onChangeText={(text) => set(f.key, text)}
                  placeholder={f.placeholder}
                  placeholderTextColor="#9A8D76"
                  multiline={f.multiline}
                  style={[styles.input, f.multiline && styles.inputMultiline]}
                  testID={`edit-about-${f.key}`}
                />
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton title={saving ? "Saving..." : "Save changes"} icon={Check} onPress={save} />
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28 },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 4 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
  scroll: { flex: 1, marginTop: 16 },
  scrollContent: { gap: 12, paddingBottom: 24 },
  field: { gap: 6 },
  label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
  input: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 16, paddingHorizontal: 14, paddingVertical: 10 },
  inputMultiline: { minHeight: 70, textAlignVertical: "top" },
  footer: { paddingBottom: 12, paddingTop: 8 },
});
