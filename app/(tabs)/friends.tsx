import { Heart, QrCode, Radio, Smartphone, Users } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { PrimaryButton } from "@/src/components/Buttons";
import { FriendRow } from "@/src/components/FriendRow";
import { Header } from "@/src/components/Header";
import { PostalCard } from "@/src/components/PostalCard";
import { PostmarkDecoration } from "@/src/components/PostmarkDecoration";
import { PrivacyCard } from "@/src/components/PrivacyCard";
import { SuccessModal } from "@/src/components/SuccessModal";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export default function FriendsScreen() {
  const { friends, addMayaConnection, queueInvitation } = useMailClub();
  const [connecting, setConnecting] = useState(false);
  const [modal, setModal] = useState<{ visible: boolean; title: string; subtitle?: string }>({ visible: false, title: "" });

  async function connect() {
    setConnecting(true);
    setTimeout(async () => {
      await addMayaConnection();
      setConnecting(false);
      setModal({ visible: true, title: "You and Maya are postcard friends now." });
    }, 850);
  }

  async function showCode() {
    const ok = await queueInvitation("Mail Card recipient", "Private address vault", "Demo route");
    if (ok) {
      setModal({ visible: true, title: "Your Mail Card code is ready.", subtitle: "In v0.1 this is a local demo code. QR claiming is not connected to a backend yet." });
    }
  }

  return (
    <AppShell>
      <Header title="Friends" />
      <PostalCard style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>Tap phones to become postcard friends.</Text>
          <Text style={styles.body}>When you meet someone you want to remember, connect in person and send a first card.</Text>
        </View>
        <View style={styles.phones}>
          <Smartphone color={colors.ink} size={70} strokeWidth={1.2} />
          <Radio color={colors.postalRed} size={28} strokeWidth={1.5} />
          <Smartphone color={colors.ink} size={70} strokeWidth={1.2} />
        </View>
        <PrimaryButton title={connecting ? "Connecting..." : "Tap to Connect"} icon={Radio} onPress={connect} />
      </PostalCard>

      <PostalCard style={styles.shareCard}>
        <View style={styles.airmailEdge} />
        <View style={styles.shareCopy}>
          <Text style={styles.sectionTitle}>Share Your Mail Card</Text>
          <Text style={styles.body}>Let others send you a free first postcard.</Text>
          <Heart color={colors.gold} size={32} strokeWidth={1.3} />
        </View>
        <View style={styles.mailCardPreview}>
          <View style={styles.previewAvatar}><Text style={styles.previewInitials}>SL</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.previewName}>Scotty</Text>
            <Text style={styles.previewMeta}>⌖ Denver, CO</Text>
            <Text style={styles.previewSince}>POSTCARD FRIENDS SINCE 2026</Text>
            <Text style={styles.previewLine}>For the friends you love and the ones you just met.</Text>
          </View>
          <PostmarkDecoration compact />
          <Pressable onPress={showCode} style={styles.codeButton}>
            <QrCode color={colors.ink} size={24} strokeWidth={1.6} />
            <Text style={styles.codeButtonText}>Show My Code</Text>
          </Pressable>
        </View>
      </PostalCard>

      <PostalCard style={styles.list}>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Postcard Friends</Text>
          <Users color={colors.ink} size={22} strokeWidth={1.5} />
        </View>
        {friends.slice(0, 4).map((friend, index) => (
          <View key={friend.id} style={index > 0 && styles.borderTop}>
            <FriendRow friend={friend} />
          </View>
        ))}
      </PostalCard>

      <PrivacyCard />

      <SuccessModal visible={modal.visible} title={modal.title} subtitle={modal.subtitle} onClose={() => setModal({ visible: false, title: "" })} />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 18, padding: 18 },
  heroCopy: { maxWidth: "70%" },
  heroTitle: { color: colors.ink, fontFamily: fonts.serif, fontSize: 31, lineHeight: 38 },
  body: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 16, lineHeight: 23, marginTop: 8 },
  phones: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: -78 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.serif, fontSize: 22 },
  shareCard: { flexDirection: "row", gap: 16, minHeight: 210, overflow: "hidden", padding: 18 },
  airmailEdge: { backgroundColor: colors.postalBlue, bottom: 0, left: 0, position: "absolute", top: 0, width: 8 },
  shareCopy: { flex: 0.72, justifyContent: "space-between" },
  mailCardPreview: { backgroundColor: "rgba(255,253,247,0.72)", borderColor: colors.line, borderRadius: 8, borderWidth: 1, flex: 1.15, gap: 10, padding: 14 },
  previewAvatar: { alignItems: "center", backgroundColor: colors.paperDark, borderRadius: 34, height: 68, justifyContent: "center", width: 68 },
  previewInitials: { color: colors.ink, fontFamily: fonts.serif, fontSize: 20, fontWeight: "800" },
  previewName: { color: colors.ink, fontFamily: fonts.serif, fontSize: 25 },
  previewMeta: { color: colors.postalBlue, fontFamily: fonts.sans, fontSize: 12, fontWeight: "700" },
  previewSince: { color: colors.postalRed, fontFamily: fonts.sans, fontSize: 9, fontWeight: "800", marginTop: 4 },
  previewLine: { color: colors.ink, fontFamily: fonts.serif, fontSize: 12, fontStyle: "italic", lineHeight: 17, marginTop: 5 },
  codeButton: { alignItems: "center", borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 10, justifyContent: "center", minHeight: 45 },
  codeButtonText: { color: colors.ink, fontFamily: fonts.serif, fontSize: 17 },
  list: { padding: 15 },
  listHeader: { alignItems: "center", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between", marginBottom: 4, paddingBottom: 8 },
  borderTop: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
});
