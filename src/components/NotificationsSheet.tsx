import { Bell, Cake, Mail, Sparkles, X } from "lucide-react-native";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { NotificationPrefs, useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const ROWS: { key: keyof NotificationPrefs; icon: any; label: string; body: string; testID: string }[] = [
  { key: "cardDelivered", icon: Mail, label: "Card delivered", body: "When a postcard you sent reaches its destination.", testID: "notif-toggle-delivered" },
  { key: "replyReceived", icon: Sparkles, label: "Reply received", body: "When a stranger writes you back from the void.", testID: "notif-toggle-reply" },
  { key: "birthdays", icon: Cake, label: "Birthdays", body: "A nudge a few days before a friend's birthday.", testID: "notif-toggle-birthdays" },
];

export function NotificationsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { notifications, updateNotifications } = useMailClub();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Notifications</Text>
            <Text style={styles.subtitle}>Choose what's worth a buzz.</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            testID="notifications-close"
            accessibilityRole="button"
            accessibilityLabel="Close notifications"
          >
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {ROWS.map((row) => {
            const Icon = row.icon;
            const value = notifications[row.key];
            return (
              <View key={row.key} style={styles.row}>
                <View style={styles.iconWrap}>
                  <Icon color={colors.postalBlue} size={18} strokeWidth={1.6} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{row.label}</Text>
                  <Text style={styles.body}>{row.body}</Text>
                </View>
                <Switch
                  value={value}
                  onValueChange={(next) => updateNotifications({ [row.key]: next } as Partial<NotificationPrefs>)}
                  trackColor={{ false: colors.line, true: colors.ink }}
                  thumbColor={colors.white}
                  ios_backgroundColor={colors.line}
                  testID={row.testID}
                />
              </View>
            );
          })}

          <View style={styles.notice}>
            <Bell color={colors.mutedInk} size={14} strokeWidth={1.6} />
            <Text style={styles.noticeText}>
              We store your preferences on your device. Real push notifications ship once fulfillment is live.
            </Text>
          </View>
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
  row: { alignItems: "center", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  iconWrap: { alignItems: "center", backgroundColor: "rgba(60,110,143,0.08)", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  label: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
  body: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16, marginTop: 2 },
  notice: { alignItems: "flex-start", backgroundColor: "rgba(217,180,110,0.12)", borderColor: "rgba(217,180,110,0.5)", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 12, padding: 12 },
  noticeText: { color: colors.mutedInk, flex: 1, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16 },
});
