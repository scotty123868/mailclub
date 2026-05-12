import { Check, Lock, X } from "lucide-react-native";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PrivacyPrefs, useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const OPTIONS: { key: PrivacyPrefs["whoCanSendToMe"]; label: string; body: string; testID: string }[] = [
  {
    key: "anyone",
    label: "Anyone with my QR code",
    body: "Default. People I meet can scan and send me a first card.",
    testID: "privacy-option-anyone",
  },
  {
    key: "friends",
    label: "Only my postcard friends",
    body: "Only people already in my rolodex can send to me.",
    testID: "privacy-option-friends",
  },
  {
    key: "no-one",
    label: "No one — pause my Mail Card",
    body: "My QR is dormant. I can still send out cards.",
    testID: "privacy-option-no-one",
  },
];

export function PrivacySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { privacy, updatePrivacy } = useMailClub();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Privacy</Text>
            <Text style={styles.subtitle}>Who can send mail to you.</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            testID="privacy-close"
            accessibilityRole="button"
            accessibilityLabel="Close privacy"
          >
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.banner}>
            <Lock color={colors.postalBlue} size={18} strokeWidth={1.6} />
            <Text style={styles.bannerText}>
              Your physical address is never shared with senders. They write to you via Mailroom's queue.
            </Text>
          </View>

          {OPTIONS.map((opt) => {
            const active = privacy.whoCanSendToMe === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => updatePrivacy({ whoCanSendToMe: opt.key })}
                style={[styles.option, active && styles.optionActive]}
                testID={opt.testID}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{opt.label}</Text>
                  <Text style={styles.optionBody}>{opt.body}</Text>
                </View>
                {active ? <Check color={colors.postalRed} size={20} strokeWidth={2} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.paper, flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28 },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 4 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
  scroll: { flex: 1, marginTop: 14 },
  scrollContent: { gap: 10, paddingBottom: 30 },
  banner: { alignItems: "flex-start", backgroundColor: "rgba(60,110,143,0.06)", borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 10, padding: 12 },
  bannerText: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 13, lineHeight: 17 },
  option: { alignItems: "center", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  optionActive: { backgroundColor: "rgba(184,74,58,0.06)", borderColor: "rgba(184,74,58,0.45)" },
  optionLabel: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16 },
  optionLabelActive: { color: colors.postalRed },
  optionBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16, marginTop: 3 },
});
