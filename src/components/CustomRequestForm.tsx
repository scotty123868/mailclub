import * as ImagePicker from "expo-image-picker";
import { Image as ImageIcon, Plus, X } from "lucide-react-native";
import { Alert, Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CustomTone } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const TONES: { id: CustomTone; label: string }[] = [
  { id: "playful", label: "Playful" },
  { id: "romantic", label: "Romantic" },
  { id: "formal", label: "Formal" },
  { id: "weird", label: "Weird" },
];

export function CustomRequestForm({
  description,
  onChangeDescription,
  tone,
  onChangeTone,
  photos,
  onChangePhotos,
}: {
  description: string;
  onChangeDescription: (text: string) => void;
  tone: CustomTone | undefined;
  onChangeTone: (next: CustomTone) => void;
  photos: string[];
  onChangePhotos: (next: string[]) => void;
}) {
  async function addPhoto() {
    if (photos.length >= 3) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Photos access denied",
        "Mail Club needs Photos access to attach reference images. You can grant it in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings().catch(() => undefined) },
        ]
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled) {
      onChangePhotos([...photos, result.assets[0].uri]);
    }
  }
  function removePhoto(index: number) {
    onChangePhotos(photos.filter((_, i) => i !== index));
  }

  const slots = Array.from({ length: 3 }, (_, i) => photos[i] ?? null);

  return (
    <View style={styles.root} testID="custom-request-form">
      <Text style={styles.label}>Describe the card</Text>
      <TextInput
        value={description}
        onChangeText={onChangeDescription}
        placeholder="A watercolor of our trip to Big Sur, golden hour, soft and warm..."
        placeholderTextColor="#9A8D76"
        multiline
        style={styles.description}
        testID="custom-description-input"
      />

      <Text style={styles.label}>Reference photos <Text style={styles.labelHint}>(up to 3)</Text></Text>
      <View style={styles.photoRow}>
        {slots.map((uri, idx) => {
          if (uri) {
            return (
              <View key={idx} style={styles.photoSlot}>
                <Image source={{ uri }} style={styles.photoImage} />
                <Pressable
                  onPress={() => removePhoto(idx)}
                  style={styles.photoRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove reference photo ${idx + 1}`}
                  testID={`custom-photo-remove-${idx}`}
                >
                  <X color={colors.white} size={14} strokeWidth={1.8} />
                </Pressable>
              </View>
            );
          }
          const isNext = idx === photos.length;
          return (
            <Pressable
              key={idx}
              onPress={isNext ? addPhoto : undefined}
              disabled={!isNext}
              style={[styles.photoSlot, styles.photoSlotEmpty, !isNext && styles.photoSlotMuted]}
              accessibilityRole="button"
              accessibilityLabel={`Add reference photo ${idx + 1}`}
              testID={`custom-photo-add-${idx}`}
            >
              {isNext ? (
                <Plus color={colors.postalBlue} size={22} strokeWidth={1.6} />
              ) : (
                <ImageIcon color="#9A8D76" size={20} strokeWidth={1.4} />
              )}
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Tone</Text>
      <View style={styles.toneRow}>
        {TONES.map((t) => {
          const active = tone === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => onChangeTone(t.id)}
              style={[styles.toneChip, active && styles.toneChipActive]}
              testID={`custom-tone-${t.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.toneText, active && styles.toneTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.notice}>
        Custom card requests are saved to your drafts. The designer queue opens when fulfillment ships — we'll email you when your draft is reviewed.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16, marginTop: 6 },
  labelHint: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13 },
  description: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 15, lineHeight: 21, minHeight: 80, padding: 12, textAlignVertical: "top" },
  photoRow: { flexDirection: "row", gap: 10 },
  photoSlot: { aspectRatio: 1, borderRadius: 8, flex: 1, overflow: "hidden", position: "relative" },
  photoSlotEmpty: { alignItems: "center", backgroundColor: "rgba(60,110,143,0.06)", borderColor: colors.line, borderStyle: "dashed", borderWidth: 1, justifyContent: "center" },
  photoSlotMuted: { opacity: 0.5 },
  photoImage: { height: "100%", width: "100%" },
  photoRemove: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 12, height: 24, justifyContent: "center", position: "absolute", right: 4, top: 4, width: 24 },
  toneRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  toneChip: { backgroundColor: "rgba(217,180,110,0.12)", borderColor: colors.line, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  toneChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  toneText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
  toneTextActive: { color: colors.white },
  notice: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17, marginTop: 4 },
});
