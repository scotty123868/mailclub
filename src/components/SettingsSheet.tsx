import { Bell, ChevronRight, CreditCard, FileText, Lock, LogOut, Mail, Stamp, Trash2 } from "lucide-react-native";
import { ComponentType } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SheetHeader } from "@/src/components/system/SheetHeader";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function SettingsSheet({
 visible,
 onClose,
 onOpenCredits,
 onOpenEditAboutMe,
 onOpenMailingAddress,
 onOpenAddressBook,
 onOpenNotifications,
 onOpenPrivacy,
 onOpenAbout,
}: {
 visible: boolean;
 onClose: () => void;
 onOpenCredits: () => void;
 onOpenEditAboutMe: () => void;
 onOpenMailingAddress?: () => void;
 onOpenAddressBook?: () => void;
 onOpenNotifications?: () => void;
 onOpenPrivacy?: () => void;
 onOpenAbout?: () => void;
}) {
 const { credits, currentUser, notifications, privacy, signOut, deleteAccount } = useMailClub();

 const notifOnCount = Object.values(notifications).filter(Boolean).length;
 const privacyLabel = privacy.whoCanSendToMe === "anyone"
 ? "Anyone with QR"
 : privacy.whoCanSendToMe === "friends"
 ? "Only friends"
 : "Paused";

 function confirmSignOut() {
 // v1.0.3: dropped the "clears your local Mailroom data" line. It was
 // technically true (AsyncStorage cache gets wiped) but read as
 // "you'll lose your cards". which is wrong. Account + postcards
 // live on the server; signing back in re-hydrates everything.
 Alert.alert(
 "Sign out?",
 "You'll return to the welcome screen. Your account and postcards stay safe in the cloud. sign back in to pick up where you left off.",
 [
 { text: "Cancel", style: "cancel" },
 {
 text: "Sign out",
 style: "destructive",
 onPress: async () => {
 // v0.7.0.20: close SettingsSheet FIRST, then sign out. Reason:
 // signOut flips hasCompletedSignup→false, which causes
 // WelcomeGate to mount a fullScreen Modal. If SettingsSheet
 // is still open (pageSheet) at that moment, iOS silently
 // drops the WelcomeSheet presentation because two modals
 // can't stack on the same view controller. the user lands
 // on a frozen My Card with no welcome modal in sight. Closing
 // first gives iOS a clean modal stack before state changes.
 //
 // Previous code awaited signOut before onClose to ensure the
 // sheet stayed open if sign-out threw. but a thrown error
 // here is rare and now surfaces via Alert anyway, so the
 // visual ordering matters more.
 onClose();
 // Small tick so iOS has a frame to start the sheet dismissal
 // animation before the state flip pulls the rug.
 await new Promise((resolve) => setTimeout(resolve, 50));
 try {
 await signOut();
 } catch (err: any) {
 Alert.alert(
 "Couldn't sign out cleanly",
 err?.message ?? "Something went wrong signing out. Try again, or relaunch the app and sign in fresh.",
 );
 }
 },
 },
 ]
 );
 }

 function confirmDeleteAccount() {
 Alert.alert(
 "Delete your Mailroom account?",
 "Permanently removes your profile, friends, sent mail, and replies. This can't be undone.",
 [
 { text: "Cancel", style: "cancel" },
 {
 text: "Delete forever",
 style: "destructive",
 onPress: () => {
 // Second confirmation. Apple-recommended pattern for destructive actions.
 Alert.alert(
 "Really delete everything?",
 "There's no recovery once you confirm.",
 [
 { text: "Keep my account", style: "cancel" },
 {
 text: "Yes, delete",
 style: "destructive",
 onPress: async () => {
 // v0.7.0.20: same modal-stack fix as Sign Out. Close
 // SettingsSheet first, then delete + reset, so the
 // WelcomeGate's fullScreen modal isn't blocked by an
 // open pageSheet when state flips.
 onClose();
 await new Promise((resolve) => setTimeout(resolve, 50));
 const result = await deleteAccount();
 if (!result.ok) {
 Alert.alert("Couldn't delete account", result.error ?? "Try again.");
 }
 },
 },
 ]
 );
 },
 },
 ]
 );
 }

 return (
 <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
 <View style={styles.root}>
 <SheetHeader
 title="Settings"
 subtitle={`Signed in as ${currentUser.name}.`}
 onClose={onClose}
 closeAccessibilityLabel="Close settings"
 closeTestID="settings-close"
 />

 <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
 <Section title="Account">
 <Row
 icon={CreditCard}
 label="Credits"
 detail={`${credits} ${credits === 1 ? "credit" : "credits"}`}
 onPress={() => { onClose(); onOpenCredits(); }}
 testID="settings-row-credits"
 />
 <Row
 icon={Mail}
 label="Edit Mail Card"
 detail="Update name, tagline, interests"
 onPress={() => { onClose(); onOpenEditAboutMe(); }}
 testID="settings-row-edit-card"
 />
 <Row
 icon={Stamp}
 label="Mailing address"
 detail="Used when you send a card to yourself"
 onPress={() => { onClose(); onOpenMailingAddress?.(); }}
 testID="settings-row-mailing-address"
 />
 </Section>

 <Section title="Mail">
 <Row
 icon={Stamp}
 label="Address book"
 detail="Manage friends"
 onPress={() => { onClose(); onOpenAddressBook?.(); }}
 testID="settings-row-addresses"
 />
 <Row
 icon={Bell}
 label="Notifications"
 detail={`${notifOnCount} of 3 on`}
 onPress={() => { onClose(); onOpenNotifications?.(); }}
 testID="settings-row-notifications"
 />
 </Section>

 <Section title="Privacy & support">
 <Row
 icon={Lock}
 label="Privacy"
 detail={`Who can write to me: ${privacyLabel}`}
 onPress={() => { onClose(); onOpenPrivacy?.(); }}
 testID="settings-row-privacy"
 />
 <Row
 icon={FileText}
 label="About, terms, & feedback"
 detail="What this is, how it works, how to reach us"
 onPress={() => { onClose(); onOpenAbout?.(); }}
 testID="settings-row-about"
 />
 </Section>

 <Section title="">
 <Row icon={LogOut} label="Sign out" tone="red" onPress={confirmSignOut} testID="settings-row-signout" />
 <Row icon={Trash2} label="Delete account" tone="red" detail="Permanently remove all your data" onPress={confirmDeleteAccount} testID="settings-row-delete-account" />
 </Section>

 <Text style={styles.version}>Mailroom · beta</Text>
 </ScrollView>
 </View>
 </Modal>
 );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
 return (
 <View style={sectionStyles.wrap}>
 {title ? <Text style={sectionStyles.title}>{title}</Text> : null}
 <View style={sectionStyles.card}>{children}</View>
 </View>
 );
}

function Row({
 icon: Icon,
 label,
 detail,
 onPress,
 tone,
 testID,
}: {
 icon: ComponentType<{ color: string; size: number; strokeWidth: number }>;
 label: string;
 detail?: string;
 onPress: () => void;
 tone?: "red";
 testID?: string;
}) {
 const color = tone === "red" ? colors.postalRed : colors.ink;
 return (
 <Pressable onPress={onPress} style={rowStyles.row} testID={testID} accessibilityRole="button" accessibilityLabel={label}>
 <View style={rowStyles.iconWrap}>
 <Icon color={color} size={20} strokeWidth={1.5} />
 </View>
 <View style={{ flex: 1 }}>
 <Text style={[rowStyles.label, tone === "red" && rowStyles.labelRed]}>{label}</Text>
 {detail ? <Text style={rowStyles.detail}>{detail}</Text> : null}
 </View>
 <ChevronRight color={colors.mutedInk} size={18} strokeWidth={1.5} />
 </Pressable>
 );
}

const styles = StyleSheet.create({
 root: { backgroundColor: colors.paper, flex: 1, paddingHorizontal: 20, paddingTop: 18 },
 // v0.7.0.49: header/title/subtitle/closeBtn extracted to SheetHeader.
 scroll: { flex: 1, marginTop: 14 },
 scrollContent: { gap: 14, paddingBottom: 30 },
 version: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 11, marginTop: 12, textAlign: "center" },
});

const sectionStyles = StyleSheet.create({
 wrap: { gap: 6 },
 title: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.8, paddingHorizontal: 4 },
 card: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, overflow: "hidden" },
});

const rowStyles = StyleSheet.create({
 row: { alignItems: "center", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
 iconWrap: { alignItems: "center", backgroundColor: "rgba(60,110,143,0.06)", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
 label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
 labelRed: { color: colors.postalRed },
 detail: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, marginTop: 1 },
});
