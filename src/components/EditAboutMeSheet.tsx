import * as ImagePicker from "expo-image-picker";
import { Camera, Check, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { SheetHeader } from "@/src/components/system/SheetHeader";
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
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDraft({});
      setPendingPhotoUri(null);
    }
  }, [visible]);

  function set<K extends EditableKey>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Photo access needed",
        "We need permission to read a photo from your library so it can become your Mail Card portrait. Open Settings to allow access.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      aspect: [1, 1],
      allowsEditing: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset) return;
    // Stage the local URI. We upload + persist on Save so the user can cancel
    // out of the sheet without leaking an orphaned upload.
    setPendingPhotoUri(asset.uri);
    setDraft((d) => ({ ...d, photoUrl: asset.uri }));
  }

  function removePhoto() {
    setPendingPhotoUri(null);
    setDraft((d) => ({ ...d, photoUrl: "" }));
  }

  async function save() {
    setSaving(true);
    await updateAboutMe(draft);
    setSaving(false);
    onClose();
  }

  // Preview avatar — shows the staged change if any, else the current user.
  const previewUser = {
    ...currentUser,
    photoUrl: draft.photoUrl !== undefined ? draft.photoUrl || undefined : currentUser.photoUrl,
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.paper }}>
        <View style={styles.root}>
          <SheetHeader
            title="About me"
            subtitle="What other Mailroom members see on your card."
            onClose={onClose}
            closeAccessibilityLabel="Close edit about me"
            closeTestID="edit-about-close"
          />

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {/* Profile photo block */}
            <View style={styles.photoBlock} testID="edit-about-photo-block">
              <View style={styles.photoRow}>
                <IdentityAvatar user={previewUser} size={84} variant="hero" />
                <View style={{ flex: 1, gap: 8 }}>
                  <Pressable
                    onPress={pickPhoto}
                    style={styles.photoBtn}
                    testID="edit-about-pick-photo"
                    accessibilityRole="button"
                    accessibilityLabel="Choose a profile photo"
                  >
                    <Camera color={colors.ink} size={16} strokeWidth={1.6} />
                    <Text style={styles.photoBtnText}>{previewUser.photoUrl ? "Change photo" : "Add photo"}</Text>
                  </Pressable>
                  {previewUser.photoUrl ? (
                    <Pressable
                      onPress={removePhoto}
                      style={[styles.photoBtn, styles.photoBtnSecondary]}
                      testID="edit-about-remove-photo"
                      accessibilityRole="button"
                      accessibilityLabel="Remove profile photo"
                    >
                      <Trash2 color={colors.postalRed} size={14} strokeWidth={1.6} />
                      <Text style={[styles.photoBtnText, styles.photoBtnTextRed]}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              <Text style={styles.photoHint}>
                Square photos look best. If you don't add one, we'll use your monogram on parchment.
              </Text>
            </View>

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
  // v0.7.0.49: header/title/subtitle/closeBtn extracted to SheetHeader.
  scroll: { flex: 1, marginTop: 16 },
  scrollContent: { gap: 14, paddingBottom: 24 },
  photoBlock: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  photoRow: { alignItems: "center", flexDirection: "row", gap: 16 },
  photoBtn: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  photoBtnSecondary: { backgroundColor: "transparent", borderColor: "transparent" },
  photoBtnText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 13 },
  photoBtnTextRed: { color: colors.postalRed },
  photoHint: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16 },
  field: { gap: 6 },
  label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
  input: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 16, paddingHorizontal: 14, paddingVertical: 10 },
  inputMultiline: { minHeight: 70, textAlignVertical: "top" },
  footer: { paddingBottom: 12, paddingTop: 8 },
});
