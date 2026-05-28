/**
 * v0.7.0.49: extracted from the 12+ sheets that copy-pasted this exact
 * close button (sage-rgba background, 18 radius, padding 8, X icon at
 * 22pt 1.5 stroke).
 *
 * Sheets that should migrate to this primitive:
 * NotificationsSheet, PrivacySheet, SettingsSheet, CreditsSheet,
 * AboutAppSheet, AddFriendSheet, FriendDetailSheet, EditAboutMeSheet,
 * MailHistorySheet, PlacePicker, QRCodeModal, RouteDetailSheet.
 *
 * If a sheet wants a different background or size, override via the
 * `tone` prop or open a discussion before adding new variants.
 */
import { X } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import { colors } from "@/src/theme/colors";

type SheetCloseButtonProps = {
 onPress: () => void;
 accessibilityLabel: string;
 testID?: string;
};

export function SheetCloseButton({
 onPress,
 accessibilityLabel,
 testID,
}: SheetCloseButtonProps) {
 return (
 <Pressable
 onPress={onPress}
 style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
 accessibilityRole="button"
 accessibilityLabel={accessibilityLabel}
 hitSlop={6}
 testID={testID}
 >
 <X color={colors.ink} size={22} strokeWidth={1.5} />
 </Pressable>
 );
}

const styles = StyleSheet.create({
 btn: {
 backgroundColor: "rgba(155,175,155,0.20)",
 borderRadius: 18,
 padding: 8,
 },
 btnPressed: {
 backgroundColor: "rgba(155,175,155,0.30)",
 },
});
