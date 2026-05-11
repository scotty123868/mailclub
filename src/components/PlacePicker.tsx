import { Check, MapPin, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
  "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma",
  "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming", "Washington, D.C.",
];

export function PlacePickerSummary({ value, onPress }: { value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.summary} accessibilityRole="button" accessibilityLabel={`Place: ${value || "Choose a place"}`}>
      <MapPin color={colors.postalBlue} size={16} strokeWidth={1.6} />
      <Text style={styles.summaryText}>
        Greetings from <Text style={styles.summaryEmphasis}>{value || "wherever"}</Text>
      </Text>
      <Text style={styles.summaryEdit}>Change</Text>
    </Pressable>
  );
}

export function PlacePicker({
  visible,
  initialValue,
  onClose,
  onChoose,
}: {
  visible: boolean;
  initialValue: string;
  onClose: () => void;
  onChoose: (place: string) => void;
}) {
  const [query, setQuery] = useState(initialValue ?? "");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return US_STATES;
    return US_STATES.filter((s) => s.toLowerCase().includes(q));
  }, [query]);

  function pick(place: string) {
    onChoose(place);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>From where?</Text>
            <Text style={styles.subtitle}>Pick a US state, or type to use a custom place.</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close place picker" testID="place-picker-close">
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

        <View style={styles.queryRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search states, or type any place"
            placeholderTextColor="#9A8D76"
            style={styles.queryInput}
            testID="place-picker-input"
          />
          {query.trim().length > 0 && !US_STATES.some((s) => s.toLowerCase() === query.trim().toLowerCase()) && (
            <Pressable onPress={() => pick(query.trim())} style={styles.customBtn} testID="place-picker-custom">
              <Text style={styles.customBtnText}>Use "{query.trim()}"</Text>
            </Pressable>
          )}
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {filtered.map((place) => {
            const active = place === initialValue;
            return (
              <Pressable
                key={place}
                onPress={() => pick(place)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed, active && styles.rowActive]}
                testID={`place-row-${place.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                accessibilityRole="button"
              >
                <Text style={[styles.rowText, active && styles.rowTextActive]}>{place}</Text>
                {active ? <Check color={colors.postalRed} size={18} strokeWidth={1.6} /> : null}
              </Pressable>
            );
          })}
          {filtered.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No states match "{query}". Tap "Use" above to set as a custom place.</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  summary: { alignItems: "center", backgroundColor: "rgba(60,110,143,0.08)", borderColor: colors.line, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  summaryText: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 15 },
  summaryEmphasis: { fontFamily: fonts.serifSemi },
  summaryEdit: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.6 },
  modalRoot: { backgroundColor: colors.paper, flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28 },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14, marginTop: 4 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
  queryRow: { gap: 8, marginTop: 14 },
  queryInput: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 16, paddingHorizontal: 14, paddingVertical: 10 },
  customBtn: { alignItems: "center", backgroundColor: colors.ink, borderRadius: 8, paddingVertical: 10 },
  customBtnText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 14, letterSpacing: 0.3 },
  list: { flex: 1, marginTop: 14 },
  listContent: { paddingBottom: 30 },
  row: { alignItems: "center", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4, paddingVertical: 12 },
  rowPressed: { backgroundColor: "rgba(155,175,155,0.18)" },
  rowActive: { backgroundColor: "rgba(184,74,58,0.06)" },
  rowText: { color: colors.ink, fontFamily: fonts.serif, fontSize: 17 },
  rowTextActive: { color: colors.postalRed, fontFamily: fonts.serifSemi },
  empty: { padding: 30 },
  emptyText: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14, textAlign: "center" },
});
