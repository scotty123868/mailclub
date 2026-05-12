import { ChevronDown, ChevronUp, MapPin, UserPlus, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Add a friend. Two layers:
 *   1. Name + city + state — always required; populates the rolodex.
 *   2. Mailing address — optional, expandable section. Only needed when you
 *      actually want to send a real postcard via Lob. Until set, sending to
 *      this friend stays in "queued, no address on file" state.
 */
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
  const [showMailingAddress, setShowMailingAddress] = useState(false);
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setCity("");
    setState("");
    setShowMailingAddress(false);
    setAddressLine1("");
    setAddressLine2("");
    setAddressCity("");
    setAddressState("");
    setAddressZip("");
    setError(null);
    setSubmitting(false);
  }

  useEffect(() => {
    if (!visible) reset();
  }, [visible]);

  // Auto-populate the address city/state from the basic city/state so the
  // user doesn't re-type if they're the same.
  function syncAddressFromBasic() {
    if (city && !addressCity) setAddressCity(city);
    if (state && !addressState) setAddressState(state);
  }

  async function submit() {
    setError(null);
    setSubmitting(true);

    // If the mailing address section is expanded, validate that all required
    // pieces (line1, city, state, zip) are present together — partial address
    // = useless for Lob.
    if (showMailingAddress) {
      const hasAny = addressLine1.trim() || addressLine2.trim() || addressCity.trim() || addressState.trim() || addressZip.trim();
      if (hasAny) {
        const missing: string[] = [];
        if (!addressLine1.trim()) missing.push("street");
        if (!addressCity.trim()) missing.push("city");
        if (!addressState.trim()) missing.push("state");
        if (!addressZip.trim()) missing.push("ZIP");
        if (missing.length > 0) {
          setSubmitting(false);
          setError(`Mailing address needs ${missing.join(", ")} to be complete. Leave the whole block blank to save without one.`);
          return;
        }
      }
    }

    const result = await addFriendByAddress({
      name,
      city,
      state,
      addressLine1: showMailingAddress ? addressLine1 : undefined,
      addressLine2: showMailingAddress ? addressLine2 : undefined,
      addressCity: showMailingAddress ? addressCity || city : undefined,
      addressState: showMailingAddress ? addressState || state : undefined,
      addressZip: showMailingAddress ? addressZip : undefined,
      addressCountry: "US",
    });
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

  const hasFullMailingAddress =
    showMailingAddress &&
    addressLine1.trim() &&
    (addressCity.trim() || city.trim()) &&
    (addressState.trim() || state.trim()) &&
    addressZip.trim();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.paper }}>
        <View style={styles.root}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Add a friend</Text>
              <Text style={styles.subtitle}>Just the basics is enough. Add a mailing address only if you want to send physical postcards.</Text>
            </View>
            <Pressable onPress={close} style={styles.closeBtn} testID="add-friend-close" accessibilityRole="button" accessibilityLabel="Close add friend">
              <X color={colors.ink} size={22} strokeWidth={1.5} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <View style={styles.field}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Jamie Rivera"
                placeholderTextColor="#9A8D76"
                style={styles.input}
                testID="add-friend-name"
                autoCapitalize="words"
                autoCorrect={false}
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
                autoCapitalize="words"
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
                autoCapitalize="characters"
                maxLength={3}
                autoCorrect={false}
              />
            </View>

            {/* Mailing-address section — collapsed by default */}
            <Pressable
              onPress={() => {
                if (!showMailingAddress) syncAddressFromBasic();
                setShowMailingAddress((v) => !v);
              }}
              style={styles.addressToggle}
              testID="add-friend-toggle-address"
              accessibilityRole="button"
              accessibilityLabel={showMailingAddress ? "Hide mailing address" : "Show mailing address fields"}
            >
              <View style={styles.addressToggleHeader}>
                <MapPin color={colors.postalBlue} size={16} strokeWidth={1.6} />
                <Text style={styles.addressToggleLabel}>Mailing address (optional)</Text>
                {showMailingAddress ? (
                  <ChevronUp color={colors.mutedInk} size={18} strokeWidth={1.6} />
                ) : (
                  <ChevronDown color={colors.mutedInk} size={18} strokeWidth={1.6} />
                )}
              </View>
              <Text style={styles.addressToggleHint}>
                Required to send physical postcards. Skip this for now if you're just adding the contact.
              </Text>
            </Pressable>

            {showMailingAddress ? (
              <View style={styles.addressBlock} testID="add-friend-address-block">
                <View style={styles.field}>
                  <Text style={styles.label}>Street address</Text>
                  <TextInput
                    value={addressLine1}
                    onChangeText={setAddressLine1}
                    placeholder="123 Main Street"
                    placeholderTextColor="#9A8D76"
                    style={styles.input}
                    testID="add-friend-line1"
                    autoCapitalize="words"
                    textContentType="streetAddressLine1"
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Apt / suite (optional)</Text>
                  <TextInput
                    value={addressLine2}
                    onChangeText={setAddressLine2}
                    placeholder="Apt 4B"
                    placeholderTextColor="#9A8D76"
                    style={styles.input}
                    testID="add-friend-line2"
                    autoCapitalize="words"
                    textContentType="streetAddressLine2"
                  />
                </View>

                <View style={styles.row}>
                  <View style={[styles.field, { flex: 2 }]}>
                    <Text style={styles.label}>City</Text>
                    <TextInput
                      value={addressCity}
                      onChangeText={setAddressCity}
                      placeholder={city || "Boise"}
                      placeholderTextColor="#9A8D76"
                      style={styles.input}
                      testID="add-friend-address-city"
                      autoCapitalize="words"
                      textContentType="addressCity"
                    />
                  </View>
                  <View style={[styles.field, { flex: 1 }]}>
                    <Text style={styles.label}>State</Text>
                    <TextInput
                      value={addressState}
                      onChangeText={setAddressState}
                      placeholder={state || "ID"}
                      placeholderTextColor="#9A8D76"
                      style={styles.input}
                      testID="add-friend-address-state"
                      autoCapitalize="characters"
                      maxLength={3}
                      textContentType="addressState"
                    />
                  </View>
                  <View style={[styles.field, { flex: 1.2 }]}>
                    <Text style={styles.label}>ZIP</Text>
                    <TextInput
                      value={addressZip}
                      onChangeText={setAddressZip}
                      placeholder="83702"
                      placeholderTextColor="#9A8D76"
                      style={styles.input}
                      testID="add-friend-zip"
                      keyboardType="number-pad"
                      maxLength={10}
                      textContentType="postalCode"
                    />
                  </View>
                </View>

                {hasFullMailingAddress ? (
                  <View style={[styles.notice, styles.noticeOk]}>
                    <Text style={[styles.noticeText, styles.noticeOkText]}>
                      ✓ Complete — postcards to this friend will be mailable when the printing partner is wired up.
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {error ? <Text style={styles.error} testID="add-friend-error">{error}</Text> : null}

            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                Addresses are stored privately on your device and Mailroom's database. Lob (our printing partner) sees only the recipient's address to ship the card; we never expose it to other Mailroom members.
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
  row: { flexDirection: "row", gap: 10 },
  label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
  input: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 17, paddingHorizontal: 14, paddingVertical: 10 },
  error: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 13, marginTop: 4 },
  addressToggle: {
    backgroundColor: "rgba(60,110,143,0.05)",
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    marginTop: 6,
    padding: 12,
  },
  addressToggleHeader: { alignItems: "center", flexDirection: "row", gap: 8 },
  addressToggleLabel: { color: colors.ink, flex: 1, fontFamily: fonts.serifSemi, fontSize: 15 },
  addressToggleHint: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16 },
  addressBlock: { gap: 12, marginTop: -2 },
  notice: { backgroundColor: "rgba(217,180,110,0.12)", borderColor: "rgba(217,180,110,0.4)", borderRadius: 8, borderWidth: 1, marginTop: 8, padding: 12 },
  noticeText: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16 },
  noticeOk: { backgroundColor: "rgba(96,122,85,0.10)", borderColor: "rgba(96,122,85,0.35)" },
  noticeOkText: { color: "#3F5A3A" },
  footer: { paddingBottom: 12, paddingTop: 8 },
});
