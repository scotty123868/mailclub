import { Cake, ChevronDown, ChevronUp, MapPin, UserPlus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { AddressFields } from "@/src/components/AddressFields";
import { SheetHeader } from "@/src/components/system/SheetHeader";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import type { AddressDraft } from "@/src/types/address";

/**
 * Add a friend. Two layers:
 * 1. Name + city + state. always required; populates the rolodex.
 * 2. Mailing address. optional, expandable section. Only needed when you
 * actually want to send a real postcard via Lob. Until set, sending to
 * this friend stays in "queued, no address on file" state.
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
 const [birthday, setBirthday] = useState("");
 const [showMailingAddress, setShowMailingAddress] = useState(false);
 // v0.7.0.18: single AddressDraft replacing 5 separate state vars. Lets
 // the AddressFields component (with Google Places autocomplete) drop in
 // unchanged. Destructured back into the 5 server fields at submit time.
 const [mailingAddress, setMailingAddress] = useState<AddressDraft>({
 name: "",
 line1: "",
 line2: "",
 city: "",
 state: "",
 zip: "",
 });
 const addressLine1 = mailingAddress.line1;
 const addressLine2 = mailingAddress.line2 ?? "";
 const addressCity = mailingAddress.city;
 const addressState = mailingAddress.state;
 const addressZip = mailingAddress.zip;
 const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState<string | null>(null);

 function reset() {
 setName("");
 setCity("");
 setState("");
 setBirthday("");
 setShowMailingAddress(false);
 setMailingAddress({ name: "", line1: "", line2: "", city: "", state: "", zip: "" });
 setError(null);
 setSubmitting(false);
 }

 useEffect(() => {
 if (!visible) reset();
 }, [visible]);

 // Auto-populate the address city/state from the basic city/state so the
 // user doesn't re-type if they're the same.
 function syncAddressFromBasic() {
 if ((city && !addressCity) || (state && !addressState)) {
 setMailingAddress((prev) => ({
 ...prev,
 city: prev.city || city,
 state: prev.state || state,
 }));
 }
 }

 async function submit() {
 setError(null);
 setSubmitting(true);

 // If the mailing address section is expanded, validate that all required
 // pieces (line1, city, state, zip) are present together. partial address
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
 birthday: birthday.trim() || undefined,
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
 <SheetHeader
 title="Add a friend"
 subtitle="Just the basics is enough. Add a mailing address only if you want to send physical postcards."
 onClose={close}
 closeAccessibilityLabel="Close add friend"
 closeTestID="add-friend-close"
 />

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

 {/* Birthday. optional. v0.5.0 Phase 2.6. We'll surface birthday
 reminders in a 0.5.x release ("Jamie's birthday is in 3 days
. send a card?"). Stored as a free-form string for now;
 month/day parsing happens at reminder time. */}
 <View style={styles.field}>
 <View style={styles.birthdayLabelRow}>
 <Cake color={colors.postalRed} size={16} strokeWidth={1.6} />
 <Text style={styles.label}>Birthday (optional)</Text>
 </View>
 <TextInput
 value={birthday}
 onChangeText={setBirthday}
 placeholder="June 8"
 placeholderTextColor="#9A8D76"
 style={styles.input}
 testID="add-friend-birthday"
 autoCapitalize="words"
 autoCorrect={false}
 maxLength={32}
 />
 <Text style={styles.fieldHint}>
 We'll remind you a few days before so you can send a card.
 </Text>
 </View>

 {/* Mailing-address section. collapsed by default */}
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
 {/* v0.7.0.18: single GPlaces autocomplete textbox + apt
 below, replacing the prior 5-field stack. Consistent
 UX with welcome flow + Send tab. */}
 <AddressFields
 address={mailingAddress}
 onChange={setMailingAddress}
 testIDPrefix="add-friend"
 label="Mailing address"
 placeholder="123 Main St, Boise, ID 83702"
 />


 {hasFullMailingAddress ? (
 <View style={[styles.notice, styles.noticeOk]}>
 <Text style={[styles.noticeText, styles.noticeOkText]}>
 ✓ Complete. postcards to this friend will be mailable when the printing partner is wired up.
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
 // v0.7.0.49: header/title/subtitle/closeBtn extracted to SheetHeader.
 scroll: { flex: 1, marginTop: 18 },
 scrollContent: { gap: 12, paddingBottom: 30 },
 field: { gap: 6 },
 row: { flexDirection: "row", gap: 10 },
 label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
 birthdayLabelRow: { alignItems: "center", flexDirection: "row", gap: 6 },
 fieldHint: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16, marginTop: 4 },
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
