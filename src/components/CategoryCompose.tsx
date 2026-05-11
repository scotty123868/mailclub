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
        "Mail Club needs Photos access to pick the image for your postcard. You can grant it in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings().catch(() => undefined) },
        ]
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.82,
    });
    if (!result.canceled) onChange({ imageUri: result.assets[0].uri });
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
