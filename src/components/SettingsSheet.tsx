import { Bell, ChevronRight, CreditCard, FileText, Lock, LogOut, Mail, Stamp, Trash2, X } from "lucide-react-native";
import { ComponentType } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function SettingsSheet({
  visible,
  onClose,
  onOpenCredits,
  onOpenEditAboutMe,
  onOpenAddressBook,
  onOpenNotifications,
  onOpenPrivacy,
  onOpenAbout,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenCredits: () => void;
  onOpenEditAboutMe: () => void;
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
    Alert.alert(
      "Sign out?",
      "This clears your local Mailroom data and returns you to the welcome screen. Your in-flight cards remain queued.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: async () => {
            // v0.6.1 codex Phase 6.5 P0: always close the sheet, even if
            // sign-out throws. Previously a Haptics failure (iOS sim) would
            // throw before onClose fired, leaving the user looking at the
            // Settings sheet with no apparent reaction — "sign out failed".
            try {
              await signOut();
            } catch (err: any) {
              Alert.alert(
                "Couldn't sign out cleanly",
                err?.message ?? "Your local data was cleared, but the server session may still be active. Try again or relaunch the app.",
              );
            } finally {
              onClose();
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
            // Second confirmation — Apple-recommended pattern for destructive actions.
            Alert.alert(
              "Really delete everything?",
              "There's no recovery once you confirm.",
              [
                { text: "Keep my account", style: "cancel" },
                {
                  text: "Yes, delete",
                  style: "destructive",
                  onPress: async () => {
                    const result = await deleteAccount();
                    if (!result.ok) {
                      Alert.alert("Couldn't delete account", result.error ?? "Try again.");
                      return;
                    }
                    onClose();
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
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Settings</Text>
            <Text style={styles.subtitle}>Signed in as {currentUser.name}.</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} testID="settings-close" accessibilityRole="button" accessibilityLabel="Close settings">
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

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
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28 },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 4 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
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
