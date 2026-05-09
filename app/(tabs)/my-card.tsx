import { useRouter } from "expo-router";
import { Building2, Cake, Camera, Globe2, Heart, Image as ImageIcon, LucideIcon, Mail, MapPinned, Send, Signpost, Star, Tag, UserPlus, Users } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { PrimaryButton, SecondaryButton } from "@/src/components/Buttons";
import { ConstellationPanel } from "@/src/components/ConstellationPanel";
import { Avatar } from "@/src/components/FriendRow";
import { Header } from "@/src/components/Header";
import { MapPanel } from "@/src/components/MapPanel";
import { MetricStrip } from "@/src/components/MetricStrip";
import { PostalCard } from "@/src/components/PostalCard";
import { StampArt } from "@/src/components/PostalIllustrations";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const cardIdeas = [
  { title: "Send me the photo from tonight", icon: Camera, tone: "cream" },
  { title: "Send me your favorite place in your city", icon: Building2, tone: "sage" },
  { title: "Send me a weird sign", icon: Signpost, tone: "blue" },
  { title: "Invite me on a date?", icon: Heart, tone: "red" },
];

export default function MyMailCardScreen() {
  const router = useRouter();
  const { currentUser, postcards } = useMailClub();
  return (
    <AppShell>
      <Header title="My Mail Card" />

      <View style={styles.hero}>
        <Avatar initials={currentUser.avatarInitials} size={112} />
        <View style={styles.heroCopy}>
          <Text style={styles.name}>{currentUser.name}</Text>
          <Text style={styles.city}>⌖ {currentUser.city}, {currentUser.state}</Text>
          <Text style={styles.since}>POSTCARD FRIENDS SINCE {currentUser.since}</Text>
          <Text style={styles.tagline}>{currentUser.tagline}</Text>
        </View>
        <View style={styles.stamp}><StampArt cents="5¢" /></View>
      </View>

      <MetricStrip metrics={[
        { icon: Users, value: 42, label: "Postcard Friends" },
        { icon: Send, value: 128 + postcards.length, label: "Sent", accent: "#607A55" },
        { icon: Mail, value: 97, label: "Received", accent: colors.postalBlue },
        { icon: Globe2, value: 23, label: "Cities Connected", accent: colors.postalRed },
      ]} />

      <PostalCard style={styles.about}>
        <View style={styles.airmailEdge} />
        <View style={styles.aboutStamp}><StampArt cents="15¢" color={colors.sage} /></View>
        <View style={styles.aboutCopy}>
          <Text style={styles.sectionTitle}>About Me</Text>
          <InfoLine icon={Star} label="Interests:" value={currentUser.interests} />
          <InfoLine icon={ImageIcon} label="Send me:" value={currentUser.sendMe} />
          <InfoLine icon={Cake} label="Birthday:" value={currentUser.birthday} />
          <InfoLine icon={Tag} label="Currently into:" value={currentUser.currentlyInto} italic />
        </View>
      </PostalCard>

      <PostalCard style={styles.ideas}>
        <Text style={styles.sectionTitle}>First Card Ideas</Text>
        <View style={styles.ideaGrid}>
          {cardIdeas.map((idea) => <IdeaPill key={idea.title} {...idea} />)}
        </View>
      </PostalCard>

      <View style={styles.previewGrid}>
        <Pressable onPress={() => router.push("/constellation")} style={styles.previewPress}>
          <View style={styles.previewCard}>
            <ConstellationPanel compact />
            <View style={styles.previewText}>
              <Text style={styles.previewTitleLight}>Your Constellation</Text>
              <Text style={styles.previewBodyLight}>The people who light up your world.</Text>
            </View>
          </View>
        </Pressable>
        <Pressable onPress={() => router.push("/map")} style={styles.previewPress}>
          <View style={styles.previewCard}>
            <MapPanel compact />
            <View style={styles.previewText}>
              <Text style={styles.previewTitleLight}>Mail Map</Text>
              <Text style={styles.previewBodyLight}>Where your postcards have traveled.</Text>
            </View>
          </View>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <PrimaryButton title="Send Mail" icon={MapPinned} onPress={() => router.push("/send")} style={styles.actionButton} />
        <SecondaryButton title="Add Friend" icon={UserPlus} onPress={() => router.push("/friends")} style={styles.actionButton} />
      </View>
    </AppShell>
  );
}

function InfoLine({ icon: Icon, label, value, italic = false }: { icon: LucideIcon; label: string; value: string; italic?: boolean }) {
  return (
    <View style={styles.infoLine}>
      <Icon color={colors.ink} size={21} strokeWidth={1.45} />
      <Text style={[styles.infoText, italic && styles.italic]}>
        <Text style={styles.infoLabel}>{label} </Text>{value}
      </Text>
    </View>
  );
}

function IdeaPill({ title, icon: Icon, tone }: { title: string; icon: LucideIcon; tone: string }) {
  const backgroundColor = tone === "red" ? "rgba(184,74,58,0.08)" : tone === "blue" ? "rgba(60,110,143,0.1)" : tone === "sage" ? "rgba(155,175,155,0.18)" : "rgba(255,253,247,0.7)";
  const borderColor = tone === "red" ? "rgba(184,74,58,0.35)" : colors.line;
  return (
    <View style={[styles.ideaPill, { backgroundColor, borderColor }]}>
      <Icon color={tone === "red" ? colors.postalRed : colors.ink} size={22} strokeWidth={1.45} />
      <Text style={styles.ideaText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", flexDirection: "row", gap: 18, marginTop: 6 },
  heroCopy: { flex: 1 },
  name: { color: colors.ink, fontFamily: fonts.serif, fontSize: 43 },
  city: { color: colors.postalBlue, fontFamily: fonts.serif, fontSize: 20, marginTop: -2 },
  since: { color: colors.postalRed, fontFamily: fonts.sans, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: 8 },
  tagline: { color: colors.ink, fontFamily: fonts.serif, fontSize: 17, fontStyle: "italic", lineHeight: 23, marginTop: 8 },
  stamp: { position: "absolute", right: 4, top: 4 },
  about: { minHeight: 250, overflow: "hidden", padding: 22 },
  aboutStamp: { position: "absolute", right: 24, top: 24 },
  airmailEdge: { backgroundColor: colors.postalBlue, bottom: 0, left: 0, position: "absolute", top: 0, width: 8 },
  aboutCopy: { gap: 12, paddingRight: 86 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.serif, fontSize: 28 },
  infoLine: { alignItems: "flex-start", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12, paddingBottom: 11 },
  infoText: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 16, lineHeight: 22 },
  infoLabel: { fontWeight: "700" },
  italic: { color: "#607A55", fontStyle: "italic" },
  ideas: { padding: 18 },
  ideaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  ideaPill: { alignItems: "center", borderRadius: 28, borderWidth: 1, flexDirection: "row", gap: 9, minHeight: 55, paddingHorizontal: 14, width: "48%" },
  ideaText: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 14, lineHeight: 18 },
  previewGrid: { flexDirection: "row", gap: 12 },
  previewPress: { flex: 1 },
  previewCard: { borderRadius: 8, height: 158, overflow: "hidden" },
  previewText: { bottom: 12, left: 12, position: "absolute", right: 12 },
  previewTitleLight: { color: colors.white, fontFamily: fonts.serif, fontSize: 19 },
  previewBodyLight: { color: "rgba(255,255,255,0.88)", fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, marginTop: 4 },
  actions: { flexDirection: "row", gap: 12 },
  actionButton: { flex: 1 },
});
