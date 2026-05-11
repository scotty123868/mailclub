import { Mail, Trash2, X } from "lucide-react-native";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { IllustratedAvatar, AvatarLook } from "@/src/components/Avatar";
import { PrimaryButton } from "@/src/components/Buttons";
import { Stamp } from "@/src/components/Stamp";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { useMailClub } from "@/src/state/MailClubContext";
import { Friend, Postcard } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function FriendDetailSheet({
  friend,
  visible,
  onClose,
  onSend,
}: {
  friend: Friend | null;
  visible: boolean;
  onClose: () => void;
  onSend: (friendId: string) => void;
}) {
  const { postcards, removeFriend } = useMailClub();
  if (!friend) return null;
  const recentSends = postcards.filter((p) => p.toFriendId === friend.id).slice(0, 3);
  const totalCards = friend.cardsSent + friend.cardsReceived;

  function confirmRemove() {
    Alert.alert(
      `Remove ${friend!.name}?`,
      "This removes them from your rolodex. Their address is wiped from this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await removeFriend(friend!.id);
            onClose();
          },
        },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.closeBtn} testID="friend-detail-close" accessibilityRole="button" accessibilityLabel={`Close ${friend.name} details`}>
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.identity}>
            <IllustratedAvatar look={friend.id as AvatarLook} size={104} />
            <View style={styles.identityCopy}>
              <Text style={styles.name}>{friend.name}</Text>
              <Text style={styles.city}>{friend.city}, {friend.state}</Text>
              {friend.relationshipSignal ? (
                <View style={styles.signalBadge}>
                  <Text style={styles.signalText}>{friend.relationshipSignal.toUpperCase()}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.stamp}>
              <Stamp motif="dove" tone="red" cents={`${totalCards || 1}¢`} rotate={6} size="sm" />
            </View>
            <View style={styles.postmark}>
              <CircularPostmark size={56} topText="STAY CURIOUS" bottomText="KEEP WRITING" centerYear="" />
            </View>
          </View>

          <View style={styles.statRow}>
            <StatCell value={friend.cardsSent} label="Sent" />
            <StatCell value={friend.cardsReceived} label="Received" />
            <StatCell value={totalCards} label="Total" tone="red" />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent sends</Text>
            {recentSends.length === 0 ? (
              <Text style={styles.empty}>No cards yet. Send your first one.</Text>
            ) : (
              recentSends.map((card) => <PostcardRow key={card.id} card={card} />)
            )}
          </View>

          <PrimaryButton
            title="Send a postcard"
            icon={Mail}
            onPress={() => onSend(friend.id)}
          />

          <Pressable onPress={confirmRemove} style={styles.removeBtn} testID="friend-remove-btn" accessibilityRole="button">
            <Trash2 color={colors.postalRed} size={16} strokeWidth={1.6} />
            <Text style={styles.removeBtnText}>Remove from rolodex</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function StatCell({ value, label, tone }: { value: number; label: string; tone?: "red" }) {
  return (
    <View style={statStyles.cell}>
      <Text style={[statStyles.value, tone === "red" && statStyles.valueRed]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

function PostcardRow({ card }: { card: Postcard }) {
  return (
    <View style={postcardStyles.row}>
      <Text style={postcardStyles.category}>{card.category}</Text>
      <Text style={postcardStyles.message} numberOfLines={1}>{card.message || "—"}</Text>
      <Text style={postcardStyles.cost}>{card.creditCost}c</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.paper, flex: 1 },
  header: { alignItems: "flex-end", paddingHorizontal: 16, paddingTop: 12 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
  scroll: { flex: 1 },
  scrollContent: { gap: 18, paddingBottom: 40, paddingHorizontal: 20 },
  identity: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 10, borderWidth: 1, gap: 10, overflow: "hidden", padding: 18, position: "relative" },
  identityCopy: { alignItems: "center", marginTop: 8 },
  name: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 36 },
  city: { color: colors.postalBlue, fontFamily: fonts.serif, fontSize: 16, marginTop: 2 },
  signalBadge: { backgroundColor: "rgba(184,74,58,0.1)", borderRadius: 4, marginTop: 10, paddingHorizontal: 10, paddingVertical: 4 },
  signalText: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.7 },
  stamp: { position: "absolute", right: 14, top: 14 },
  postmark: { left: 12, opacity: 0.4, position: "absolute", top: 80 },
  statRow: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", padding: 14 },
  section: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, padding: 14 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17, marginBottom: 8 },
  empty: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13 },
  removeBtn: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "center", paddingVertical: 10 },
  removeBtnText: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 14 },
});

const statStyles = StyleSheet.create({
  cell: { alignItems: "center", flex: 1 },
  value: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28 },
  valueRed: { color: colors.postalRed },
  label: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 11, letterSpacing: 0.5, marginTop: 2 },
});

const postcardStyles = StyleSheet.create({
  row: { alignItems: "center", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 10, paddingVertical: 8 },
  category: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", width: 90 },
  message: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 14 },
  cost: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 11 },
});
