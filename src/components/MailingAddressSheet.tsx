/**
 * MailingAddressSheet. edit the user's own mailing address.
 *
 * v0.7.0.60: introduced so users can update their address from Settings
 * after onboarding. The address lives in AsyncStorage (mailroom.selfAddress.v1)
 * and is what the Send → Yourself flow uses to skip the address step on
 * repeat self-sends. Google Places autocomplete for the street line so
 * the user doesn't have to type everything from scratch.
 */
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import {
 ActivityIndicator,
 Alert,
 KeyboardAvoidingView,
 Modal,
 Platform,
 Pressable,
 ScrollView,
 StyleSheet,
 Text,
 TextInput,
 View,
} from "react-native";
import {
 AddressSuggestion,
 fetchAddressSuggestions,
 fetchPlaceDetails,
 newSessionToken,
} from "@/src/services/addressAutocomplete";
import { getSelfAddress, setSelfAddress } from "@/src/state/selfAddress";
import { SheetCloseButton } from "@/src/components/system/SheetCloseButton";
import { useMailClub } from "@/src/state/MailClubContext";
import { isAddressComplete, type AddressDraft } from "@/src/types/address";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const EMPTY: AddressDraft = { name: "", line1: "", line2: "", city: "", state: "", zip: "" };

export function MailingAddressSheet({
 visible,
 onClose,
}: {
 visible: boolean;
 onClose: () => void;
}) {
 const { currentUser } = useMailClub();
 const [draft, setDraft] = useState<AddressDraft>(EMPTY);
 const [loading, setLoading] = useState(false);
 const [saving, setSaving] = useState(false);
 const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
 const [sessionToken, setSessionToken] = useState<string>("");
 const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 const abortRef = useRef<AbortController | null>(null);

 // Hydrate from AsyncStorage on open
 useEffect(() => {
 if (!visible) return;
 setLoading(true);
 setSessionToken(newSessionToken());
 (async () => {
 const existing = await getSelfAddress();
 // Default the recipient name to the user's own name (self-sends ship
 // to "Scotty Lefkowitz" not "Scotty Lefkowitz (me)") if unset.
 const fallbackName = (currentUser?.name ?? "").trim();
 setDraft(existing ?? { ...EMPTY, name: fallbackName });
 setLoading(false);
 })();
 }, [visible]);

 const complete = useMemo(() => isAddressComplete(draft), [draft]);

 function patch(p: Partial<AddressDraft>) {
 setDraft((d) => ({ ...d, ...p }));
 }

 function onLine1Change(text: string) {
 patch({ line1: text });
 if (debounceRef.current) clearTimeout(debounceRef.current);
 if (abortRef.current) {
 try { abortRef.current.abort(); } catch { /* ignore */ }
 abortRef.current = null;
 }
 if (text.trim().length < 3) {
 setSuggestions([]);
 return;
 }
 debounceRef.current = setTimeout(async () => {
 const ctrl = new AbortController();
 abortRef.current = ctrl;
 try {
 const results = await fetchAddressSuggestions(text, {
 signal: ctrl.signal,
 sessionToken,
 });
 setSuggestions(results);
 } catch {
 // ignore (abort + network errors silently)
 }
 }, 180);
 }

 async function pickSuggestion(s: AddressSuggestion) {
 setSuggestions([]);
 const details = await fetchPlaceDetails(s.placeId, { sessionToken });
 if (!details) {
 // Fall back to whatever the user typed
 patch({ line1: s.label || s.mainText || draft.line1 });
 return;
 }
 setDraft((d) => ({
 name: d.name || (currentUser?.name ?? "").trim(),
 line1: details.line1,
 line2: details.line2 || "",
 city: details.city,
 state: details.state,
 zip: details.zip,
 }));
 setSessionToken(newSessionToken());
 }

 async function onSave() {
 if (!complete) {
 Alert.alert("Address incomplete", "Fill in every field above so we can ship cards here.");
 return;
 }
 setSaving(true);
 try {
 await setSelfAddress(draft);
 Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
 onClose();
 } catch (e) {
 Alert.alert("Couldn't save", "Try again in a moment.");
 } finally {
 setSaving(false);
 }
 }

 return (
 <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
 <KeyboardAvoidingView
 behavior={Platform.OS === "ios" ? "padding" : undefined}
 style={styles.root}
 >
 <View style={styles.header}>
 <Text style={styles.title}>Mailing address</Text>
 <SheetCloseButton onPress={onClose} accessibilityLabel="Close mailing address" testID="mailing-address-close" />
 </View>
 <Text style={styles.sub}>
 The address we use when you send a postcard to yourself. Stays on
 your device.
 </Text>
 {loading ? (
 <View style={styles.loadingWrap}><ActivityIndicator color={colors.ink} /></View>
 ) : (
 <ScrollView
 style={styles.scroll}
 contentContainerStyle={styles.scrollContent}
 keyboardShouldPersistTaps="handled"
 >
 <View style={styles.field}>
 <Text style={styles.label}>Street address</Text>
 <TextInput
 value={draft.line1}
 onChangeText={onLine1Change}
 placeholder="123 Main St"
 placeholderTextColor={colors.mutedInk}
 autoCapitalize="words"
 autoCorrect={false}
 autoComplete="street-address"
 style={styles.input}
 testID="mailing-address-line1"
 />
 {suggestions.length > 0 ? (
 <View style={styles.dropdown}>
 {suggestions.map((s) => (
 <Pressable
 key={s.placeId}
 onPress={() => pickSuggestion(s)}
 style={({ pressed }) => [styles.dropdownItem, pressed && { backgroundColor: colors.paper }]}
 >
 <Text style={styles.dropdownMain} numberOfLines={1}>{s.mainText ?? s.label}</Text>
 {s.secondaryText ? (
 <Text style={styles.dropdownSec} numberOfLines={1}>{s.secondaryText}</Text>
 ) : null}
 </Pressable>
 ))}
 </View>
 ) : null}
 </View>
 <View style={styles.field}>
 <Text style={styles.label}>Apt, suite (optional)</Text>
 <TextInput
 value={draft.line2}
 onChangeText={(t) => patch({ line2: t })}
 placeholder="Apt 4B"
 placeholderTextColor={colors.mutedInk}
 autoCapitalize="characters"
 autoCorrect={false}
 style={styles.input}
 />
 </View>
 <View style={styles.row}>
 <View style={[styles.field, { flex: 1 }]}>
 <Text style={styles.label}>City</Text>
 <TextInput
 value={draft.city}
 onChangeText={(t) => patch({ city: t })}
 placeholder="Denver"
 placeholderTextColor={colors.mutedInk}
 autoCapitalize="words"
 style={styles.input}
 />
 </View>
 <View style={[styles.field, { width: 90 }]}>
 <Text style={styles.label}>State</Text>
 <TextInput
 value={draft.state}
 onChangeText={(t) => patch({ state: t.toUpperCase().slice(0, 2) })}
 placeholder="CO"
 placeholderTextColor={colors.mutedInk}
 autoCapitalize="characters"
 maxLength={2}
 style={styles.input}
 />
 </View>
 </View>
 <View style={styles.field}>
 <Text style={styles.label}>ZIP</Text>
 <TextInput
 value={draft.zip}
 onChangeText={(t) => patch({ zip: t.replace(/[^0-9-]/g, "").slice(0, 10) })}
 placeholder="80218"
 placeholderTextColor={colors.mutedInk}
 inputMode="numeric"
 style={styles.input}
 />
 </View>

 <Pressable
 onPress={onSave}
 disabled={!complete || saving}
 style={({ pressed }) => [
 styles.primaryBtn,
 (!complete || saving) && { opacity: 0.5 },
 pressed && { opacity: 0.85 },
 ]}
 accessibilityRole="button"
 accessibilityLabel="Save mailing address"
 testID="mailing-address-save"
 >
 {saving ? (
 <ActivityIndicator color={colors.paper} size="small" />
 ) : (
 <Text style={styles.primaryBtnText}>Save</Text>
 )}
 </Pressable>
 </ScrollView>
 )}
 </KeyboardAvoidingView>
 </Modal>
 );
}

const styles = StyleSheet.create({
 root: { backgroundColor: colors.paper, flex: 1 },
 header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 18 },
 title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 26 },
 sub: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14, marginHorizontal: 20, marginTop: 4 },
 scroll: { flex: 1 },
 scrollContent: { paddingBottom: 60, paddingHorizontal: 20, paddingTop: 18 },
 loadingWrap: { alignItems: "center", paddingVertical: 40 },
 field: { marginBottom: 14 },
 label: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.8, marginBottom: 6, textTransform: "uppercase" },
 input: {
 backgroundColor: colors.white,
 borderColor: colors.line,
 borderRadius: 8,
 borderWidth: 1,
 color: colors.ink,
 fontFamily: fonts.serif,
 fontSize: 16,
 paddingHorizontal: 12,
 paddingVertical: 12,
 },
 row: { flexDirection: "row", gap: 12 },
 dropdown: {
 backgroundColor: colors.white,
 borderColor: colors.line,
 borderRadius: 8,
 borderWidth: 1,
 marginTop: 6,
 overflow: "hidden",
 },
 dropdownItem: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10 },
 dropdownMain: { color: colors.ink, fontFamily: fonts.sansBold, fontSize: 14 },
 dropdownSec: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, marginTop: 2 },
 primaryBtn: { alignItems: "center", backgroundColor: colors.ink, borderRadius: 12, marginTop: 18, paddingVertical: 14 },
 primaryBtnText: { color: colors.paper, fontFamily: fonts.serifSemi, fontSize: 16 },
});
