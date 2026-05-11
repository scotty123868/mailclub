import { UserPlus, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function AddFriendSheet({
  visible,
  onClose,
  onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  onAdded?: (friendId: string) => void;
}) {
  const { addFriendByAddress } = useMailClub();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setCity("");
    setState("");
    setError(null);
    setSubmitting(false);
  }

  // Reset on close so stale drafts don't reappear when the user reopens.
  useEffect(() => {
    if (!visible) reset();
  }, [visible]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await addFriendByAddress({ name, city, state });
    setSubmitting(false);
    if (!result.ok) {
      setError("Please give us at least a name and a city.");
      return;
    }
    const id = result.friend?.id;
    reset();
    onClose();
    if (id && onAdded) onAdded(id);
  }

  function close() {
    reset();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Add a friend</Text>
            <Text style={styles.subtitle}>Addresses live on your device. We're not collecting them yet.</Text>
          </View>
          <Pressable onPress={close} style={styles.closeBtn} testID="add-friend-close" accessibilityRole="button" accessibilityLabel="Close add friend">
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Jamie Rivera"
              placeholderTextColor="#9A8D76"
              style={styles.input}
              testID="add-friend-name"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>City</Text>
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="Boise"
              placeholderTextColor="#9A8D76"
              style={styles.input}
              testID="add-friend-city"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>State or country</Text>
            <TextInput
              value={state}
              onChangeText={setState}
              placeholder="ID"
              placeholderTextColor="#9A8D76"
              style={styles.input}
              testID="add-friend-state"
            />
          </View>

          {error ? <Text style={styles.error} testID="add-friend-error">{error}</Text> : null}

          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              For MVP we don't need a mailing address. When real fulfillment ships, we'll ask the recipient to claim their card via QR — your friend types in the street, not you.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton title={submitting ? "Saving..." : "Add to rolodex"} icon={UserPlus} onPress={submit} />
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
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17, marginTop: 4 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
  scroll: { flex: 1, marginTop: 18 },
  scrollContent: { gap: 12, paddingBottom: 30 },
  field: { gap: 6 },
  label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
  input: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 17, paddingHorizontal: 14, paddingVertical: 10 },
  error: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 13, marginTop: 4 },
  notice: { backgroundColor: "rgba(217,180,110,0.12)", borderColor: "rgba(217,180,110,0.4)", borderRadius: 8, borderWidth: 1, marginTop: 12, padding: 12 },
  noticeText: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16 },
  footer: { paddingBottom: 12, paddingTop: 8 },
});
