import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Feather, Image as ImageIcon } from "lucide-react-native";
import { useState } from "react";
import { Alert, Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { PostalCard } from "@/src/components/PostalCard";
import { PlacePicker, PlacePickerSummary } from "@/src/components/PlacePicker";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { Stamp } from "@/src/components/Stamp";
import { CustomRequestForm } from "@/src/components/CustomRequestForm";
import { CardCategory, CustomTone } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

function HeartGlyph() {
  return (
    <Svg width={32} height={32} viewBox="0 0 32 32">
      <Path d="M 6 14 Q 8 6, 14 8 Q 16 9, 16 12 Q 16 9, 18 8 Q 24 6, 26 14 Q 24 22, 16 28 Q 8 22, 6 14 Z" stroke={colors.postalRed} strokeWidth={1.4} fill="none" />
    </Svg>
  );
}

export type ComposeState = {
  category: CardCategory;
  message: string;
  imageUri: string | null;
  placeName: string;
  customTone: CustomTone | undefined;
  customPhotos: string[];
};

export function CategoryCompose({
  state,
  onChange,
}: {
  state: ComposeState;
  onChange: (patch: Partial<ComposeState>) => void;
}) {
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  const { category, message, imageUri, placeName, customTone, customPhotos } = state;

  async function choosePhoto() {
    // Ask for permission first so a denied state shows a useful Alert rather
    // than silently swallowing the picker action.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Photos access denied",
        "Mailroom needs Photos access to pick the image for your postcard. You can grant it in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings().catch(() => undefined) },
        ]
      );
      return;
    }
    // v0.7.0.58 PHOTO QUALITY: pick the original at full resolution (no
    // system crop UI, no quality-knob downsample), THEN resize ourselves
    // via expo-image-manipulator to target Lob's 300dpi print size. Why
    // explicit resize instead of just sending the original:
    //   • Originals are 4032x3024 → ~4MB uploads on cellular. Resizing to
    //     1875 wide cuts file size ~3-5x and total upload time ~3x.
    //   • Some Photos library entries are already small (saved from
    //     iMessage, screenshots, etc). The picker returns whatever was
    //     stored, which can be 1100x800 — too small for Lob to print
    //     without upscaling. Manipulator can't invent pixels for these,
    //     but at least we don't pay 4MB uploads on the ones that ARE big.
    //   • The original "iOS allowsEditing: true downscales to ~1080" bug
    //     is already addressed by allowsEditing:false; this step is the
    //     OUTPUT side of the same problem — guarantee Lob gets a known
    //     resolution that matches its 300dpi print spec.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;

    const picked = result.assets[0];
    let finalUri = picked.uri;

    // Resize only if the image is bigger than our 1875 print target.
    // Smaller images stay as-is — manipulator upscaling would just blur
    // them more than Lob's renderer already does. We pass quality 0.92
    // (~10% smaller files than 1.0, no visible quality loss).
    const TARGET_WIDTH = 1875;
    try {
      const w = picked.width ?? 0;
      const h = picked.height ?? 0;
      if (w > TARGET_WIDTH) {
        // Preserve aspect ratio: provide only the width, manipulator
        // calculates the height proportionally.
        const manipulated = await ImageManipulator.manipulateAsync(
          picked.uri,
          [{ resize: { width: TARGET_WIDTH } }],
          { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
        );
        finalUri = manipulated.uri;
      } else if (w > 0 && h > 0) {
        // Re-encode small originals to JPEG without resizing so the
        // upload pipeline always sees a consistent format. quality 0.95
        // is essentially lossless for small images.
        const manipulated = await ImageManipulator.manipulateAsync(
          picked.uri,
          [],
          { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG },
        );
        finalUri = manipulated.uri;
      }
    } catch (err) {
      // If manipulator fails (out of memory, unsupported format), fall
      // back to the original — uploading something is better than
      // blocking the send.
      // eslint-disable-next-line no-console
      console.warn("[CategoryCompose] image manipulator failed:", err);
    }
    onChange({ imageUri: finalUri });
  }

  if (category === "custom") {
    return (
      <PostalCard style={styles.customCard}>
        <CustomRequestForm
          description={message}
          onChangeDescription={(text) => onChange({ message: text })}
          tone={customTone}
          onChangeTone={(t) => onChange({ customTone: t })}
          photos={customPhotos}
          onChangePhotos={(p) => onChange({ customPhotos: p })}
        />
      </PostalCard>
    );
  }

  const showPhotoSlot = category === "photo" || category === "place";

  return (
    <View>
      {category === "place" && (
        <View style={styles.placeRow}>
          <PlacePickerSummary value={placeName} onPress={() => setPlacePickerOpen(true)} />
        </View>
      )}
      <PostalCard style={styles.composer} testID={`composer-${category}`}>
        {showPhotoSlot ? (
          <Pressable onPress={choosePhoto} style={styles.photo} testID="photo-slot">
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.image} />
            ) : (
              <View style={styles.placeholder}>
                <ImageIcon color={colors.postalBlue} size={42} strokeWidth={1.4} />
                <Text style={styles.placeholderTitle}>Tonight's photo</Text>
                <Text style={styles.placeholderBody}>Tap to choose a real-world moment.</Text>
              </View>
            )}
          </Pressable>
        ) : (
          <View style={[styles.photo, styles.handwrittenSlot]} testID="handwritten-slot">
            <View style={styles.handwrittenInner}>
              <Feather color={colors.postalBlue} size={32} strokeWidth={1.4} />
              <Text style={styles.placeholderTitle}>Just your words</Text>
              <Text style={styles.placeholderBody}>No photo needed. Printed on paper.</Text>
            </View>
          </View>
        )}
        <View style={styles.noteArea}>
          <View style={styles.postmarkOverlay}>
            <CircularPostmark size={64} />
          </View>
          <View style={styles.stampOverlay}>
            <Stamp motif="dove" tone="red" cents="3¢" rotate={6} size="sm" />
          </View>
          <TextInput
            multiline
            value={message}
            onChangeText={(text) => onChange({ message: text })}
            placeholder="Write a short note..."
            placeholderTextColor="#9A8D76"
            style={styles.noteInput}
            testID="compose-note-input"
          />
          <View style={styles.signoff}>
            <HeartGlyph />
          </View>
        </View>
      </PostalCard>
      <PlacePicker
        visible={placePickerOpen}
        initialValue={placeName}
        onClose={() => setPlacePickerOpen(false)}
        onChoose={(p) => onChange({ placeName: p })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: "row", minHeight: 300, overflow: "hidden", padding: 14 },
  customCard: { padding: 16 },
  placeRow: { marginBottom: 8 },
  // Softer photo slot tone — close to paper, not paperDark contrast.
  photo: { backgroundColor: "rgba(217,200,170,0.35)", borderRadius: 6, flex: 0.85, overflow: "hidden" },
  image: { height: "100%", width: "100%" },
  placeholder: { alignItems: "center", flex: 1, justifyContent: "center", padding: 20 },
  placeholderTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 18, marginTop: 10, textAlign: "center" },
  placeholderBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16, marginTop: 4, textAlign: "center" },
  handwrittenSlot: { alignItems: "center", backgroundColor: "rgba(155,175,155,0.1)", justifyContent: "center" },
  handwrittenInner: { alignItems: "center", padding: 20 },
  noteArea: { flex: 1, paddingLeft: 14, paddingRight: 6, paddingTop: 8 },
  postmarkOverlay: { left: 4, opacity: 0.45, position: "absolute", top: 6 },
  stampOverlay: { opacity: 0.95, position: "absolute", right: 2, top: 4 },
  noteInput: { color: colors.ink, flex: 1, fontFamily: fonts.hand, fontSize: 25, lineHeight: 32, marginTop: 62, padding: 0, textAlignVertical: "top" },
  signoff: { alignItems: "flex-end", paddingBottom: 4, paddingRight: 6 },
});
