import { useRouter } from "expo-router";
import { QrCode, UserPlus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AddFriendSheet } from "@/src/components/AddFriendSheet";
import { AppShell } from "@/src/components/AppShell";
import { FriendDetailSheet } from "@/src/components/FriendDetailSheet";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { Header } from "@/src/components/Header";
import { PostalCard } from "@/src/components/PostalCard";
import { PrivacyCard } from "@/src/components/PrivacyCard";
import { QRCodeModal } from "@/src/components/QRCodeModal";
import { RolodexCard } from "@/src/components/RolodexCard";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export default function FriendsScreen() {
  const router = useRouter();
  const { currentUser, friends } = useMailClub();
  const [qrOpen, setQrOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [activeFriendId, setActiveFriendId] = useState<string | null>(null);
  const activeFriend = friends.find((f) => f.id === activeFriendId) ?? null;

  function openFriend(id: string) {
    setActiveFriendId(id);
  }
  function closeFriend() {
    setActiveFriendId(null);
  }
  function sendToFriend(id: string) {
    closeFriend();
    router.push({ pathname: "/send", params: { friendId: id } });
  }

  return (
    <AppShell>
      <Header title="Friends" />

      <PostalCard style={styles.mailCard}>
        <View style={styles.mailCardRow}>
          <IdentityAvatar user={currentUser} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={styles.mailCardName} numberOfLines={1}>{currentUser.name}</Text>
            <Text style={styles.mailCardCity} numberOfLines={1}>⌖ {currentUser.city}{currentUser.state ? `, ${currentUser.state}` : ""}</Text>
          </View>
        </View>
        <Pressable
          onPress={() => setQrOpen(true)}
          style={styles.qrBtn}
          testID="show-qr-btn"
          accessibilityRole="button"
          accessibilityLabel="Show my QR code"
        >
          <QrCode color={colors.ink} size={18} strokeWidth={1.6} />
          <Text style={styles.qrBtnText}>Show my code</Text>
        </Pressable>
      </PostalCard>

      <View style={styles.rolodexHeader}>
        <Text style={styles.rolodexTitle}>Your rolodex</Text>
        <Pressable
          onPress={() => setAddOpen(true)}
          style={styles.addBtn}
          testID="add-friend-btn"
          accessibilityRole="button"
          accessibilityLabel="Add a friend"
        >
          <UserPlus color={colors.ink} size={16} strokeWidth={1.6} />
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>

      {friends.length === 0 ? (
        <View style={styles.empty} testID="rolodex-empty">
          <Text style={styles.emptyTitle}>No friends yet.</Text>
          <Text style={styles.emptyBody}>Share your Mail Card to add your first one.</Text>
        </View>
      ) : (
        <View style={styles.rolodex} testID="rolodex-stack">
          {friends.map((friend, index) => (
            <RolodexCard key={friend.id} friend={friend} index={index} onPress={() => openFriend(friend.id)} />
          ))}
        </View>
      )}

      <PrivacyCard />

      <QRCodeModal
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        name={currentUser.name}
        city={currentUser.city}
        state={currentUser.state}
        userId="scotty-001"
        avatarLook="scotty"
      />

      <FriendDetailSheet
        friend={activeFriend}
        visible={activeFriendId !== null}
        onClose={closeFriend}
        onSend={sendToFriend}
      />

      <AddFriendSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(id) => setActiveFriendId(id)}
      />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  mailCard: { gap: 14, overflow: "hidden", padding: 16 },
  mailCardRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  mailCardName: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 24 },
  mailCardCity: { color: colors.postalBlue, fontFamily: fonts.serif, fontSize: 14, marginTop: 2 },
  qrBtn: { alignItems: "center", borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", paddingVertical: 11 },
  qrBtnText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
  rolodexHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  rolodexTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22 },
  addBtn: { alignItems: "center", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  addBtnText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 13 },
  rolodex: { gap: 0 },
  empty: { alignItems: "center", backgroundColor: "rgba(155,175,155,0.12)", borderColor: colors.line, borderRadius: 8, borderWidth: 1, padding: 24 },
  emptyTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 19 },
  emptyBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17, marginTop: 6, textAlign: "center" },
});
