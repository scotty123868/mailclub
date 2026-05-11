import { Bell, ChevronRight, CreditCard, FileText, HelpCircle, Lock, LogOut, Mail, Stamp, X } from "lucide-react-native";
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
}: {
  visible: boolean;
  onClose: () => void;
  onOpenCredits: () => void;
  onOpenEditAboutMe: () => void;
}) {
  const { credits, currentUser } = useMailClub();

  function stub(label: string) {
    Alert.alert(label, "Coming soon in v0.2. Tap OK to continue.");
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
            <Row icon={Stamp} label="Address book" detail="Manage friends" onPress={() => stub("Address book")} testID="settings-row-addresses" />
            <Row icon={Bell} label="Notifications" detail="Delivery, replies, birthdays" onPress={() => stub("Notifications")} testID="settings-row-notifications" />
          </Section>

          <Section title="Privacy & support">
            <Row icon={Lock} label="Privacy" detail="Address vault, data export" onPress={() => stub("Privacy")} testID="settings-row-privacy" />
            <Row icon={FileText} label="Terms & policies" onPress={() => stub("Terms & policies")} testID="settings-row-terms" />
            <Row icon={HelpCircle} label="Help & feedback" onPress={() => stub("Help & feedback")} testID="settings-row-help" />
          </Section>

          <Section title="">
            <Row icon={LogOut} label="Sign out" tone="red" onPress={() => stub("Sign out")} testID="settings-row-signout" />
          </Section>

          <Text style={styles.version}>Mail Club v0.3.0 (MVP)</Text>
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
