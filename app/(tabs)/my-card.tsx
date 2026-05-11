import { useRouter } from "expo-router";
import { Building2, Cake, Camera, Globe2, Heart, Image as ImageIcon, LucideIcon, Mail, MapPinned, Send, Signpost, Star, Tag, UserPlus, Users } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { AppShell } from "@/src/components/AppShell";
import { IllustratedAvatar } from "@/src/components/Avatar";
import { PrimaryButton, SecondaryButton } from "@/src/components/Buttons";
import { ConstellationPanel } from "@/src/components/ConstellationPanel";
import { CreditsBalance } from "@/src/components/CreditsBalance";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { EditAboutMeSheet } from "@/src/components/EditAboutMeSheet";
import { AboutAppSheet } from "@/src/components/AboutAppSheet";
import { Header } from "@/src/components/Header";
import { MailHistorySheet } from "@/src/components/MailHistorySheet";
import { MapPanel } from "@/src/components/MapPanel";
import { MetricStrip } from "@/src/components/MetricStrip";
import { NotificationsSheet } from "@/src/components/NotificationsSheet";
import { OnboardingFreeCreditsBanner } from "@/src/components/OnboardingFreeCreditsBanner";
import { PrivacySheet } from "@/src/components/PrivacySheet";
import { PostalCard } from "@/src/components/PostalCard";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { SettingsSheet } from "@/src/components/SettingsSheet";
import { Stamp } from "@/src/components/Stamp";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

type IdeaOccasion = "memory" | "travel" | "just-note" | "date";

const cardIdeas: { title: string; icon: LucideIcon; tone: string; occasion: IdeaOccasion }[] = [
  { title: "Send me the photo from tonight", icon: Camera, tone: "cream", occasion: "memory" },
  { title: "Send me your favorite place in your city", icon: Building2, tone: "sage", occasion: "travel" },
  { title: "Send me a weird sign", icon: Signpost, tone: "blue", occasion: "just-note" },
  { title: "Invite me on a date?", icon: Heart, tone: "red", occasion: "date" },
];

export default function MyMailCardScreen() {
  const router = useRouter();
  const { currentUser, friends, postcards, voidReplies, credits } = useMailClub();
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editAboutOpen, setEditAboutOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState<null | "sent" | "replies">(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Real metrics derived from state — no fake inflation
  const sentCount = postcards.filter((p) => p.status === "sent").length;
  const receivedCount = voidReplies.length;
  const citiesCount = new Set(friends.map((f) => f.city)).size;

  function seedSend(occasion: IdeaOccasion) {
    router.push({ pathname: "/send", params: { occasion } });
  }

  return (
    <AppShell>
      <Header title="My Mail Card" onPressSettings={() => setSettingsOpen(true)} />

      <OnboardingFreeCreditsBanner />

      <View style={styles.hero}>
        <IllustratedAvatar look="scotty" size={118} />
        <View style={styles.heroCopy}>
          <Text style={styles.name}>{currentUser.name}</Text>
          <Text style={styles.city}>⌖ {currentUser.city}, {currentUser.state}</Text>
          <Text style={styles.since}>POSTCARD FRIENDS SINCE {currentUser.since}</Text>
          <Text style={styles.tagline}>{currentUser.tagline}</Text>
        </View>
        <View style={styles.stamp}><Stamp motif="dove" tone="red" cents="5¢" rotate={-7} /></View>
      </View>

      <CreditsBalance count={credits} onPressBuy={() => setCreditsOpen(true)} />

      <MetricStrip metrics={[
        { icon: Users, value: friends.length, label: "Friends", onPress: () => router.push("/friends"), testID: "metric-friends" },
        { icon: Send, value: sentCount, label: "Sent", accent: "#607A55", onPress: () => setMailOpen("sent"), testID: "metric-sent" },
        { icon: Mail, value: receivedCount, label: "Replies", accent: colors.postalBlue, onPress: () => setMailOpen("replies"), testID: "metric-replies" },
        { icon: Globe2, value: citiesCount, label: "Cities", accent: colors.postalRed, onPress: () => router.push("/map"), testID: "metric-cities" },
      ]} />

      <Pressable
        onPress={() => setEditAboutOpen(true)}
        testID="about-me-edit-trigger"
        accessibilityRole="button"
        accessibilityLabel="Edit your About Me"
      >
        <PostalCard style={styles.about}>
          <View style={styles.airmailEdge} />
          <View style={styles.aboutPostmark}>
            <CircularPostmark size={86} topText="STAY CURIOUS" bottomText="KEEP WRITING" centerYear="" />
          </View>
          <View style={styles.aboutStamp}>
            <Stamp motif="botanical" tone="sage" cents="15¢" rotate={4} />
          </View>
          <View style={styles.aboutCopy}>
            <View style={styles.aboutTitleRow}>
              <Text style={styles.sectionTitle}>About Me</Text>
              <Text style={styles.editHint}>EDIT</Text>
            </View>
            <View style={styles.divider}>
              <Svg18 />
            </View>
            <InfoLine icon={Star} label="Interests:" value={currentUser.interests || "Not set yet — tap to add."} />
            <InfoLine icon={ImageIcon} label="Send me:" value={currentUser.sendMe || "Not set yet — tap to add."} />
            <InfoLine icon={Cake} label="Birthday:" value={currentUser.birthday || "Not set yet — tap to add."} />
            <InfoLine icon={Tag} label="Currently into:" value={currentUser.currentlyInto || "Not set yet — tap to add."} italic />
          </View>
        </PostalCard>
      </Pressable>

      <PostalCard style={styles.ideas}>
        <Text style={styles.sectionTitle}>First Card Ideas</Text>
        <View style={styles.ideaGrid}>
          {cardIdeas.map((idea) => (
            <Pressable
              key={idea.title}
              onPress={() => seedSend(idea.occasion)}
              testID={`idea-pill-${idea.occasion}`}
              accessibilityRole="button"
              accessibilityLabel={`Seed Send screen with ${idea.title}`}
            >
              <IdeaPill {...idea} />
            </Pressable>
          ))}
        </View>
      </PostalCard>

      <View style={styles.previewGrid}>
        <Pressable onPress={() => router.push("/constellation")} style={styles.previewPress} testID="preview-constellation">
          <View style={styles.previewCard}>
            <ConstellationPanel compact />
            <View style={styles.previewText}>
              <Text style={styles.previewTitleLight}>Your Constellation</Text>
              <Text style={styles.previewBodyLight}>The people who light up your world.</Text>
            </View>
          </View>
        </Pressable>
        <Pressable onPress={() => router.push("/map")} style={styles.previewPress} testID="preview-map">
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

      <CreditsSheet visible={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onOpenCredits={() => setCreditsOpen(true)}
        onOpenEditAboutMe={() => setEditAboutOpen(true)}
        onOpenAddressBook={() => router.push("/friends")}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onOpenPrivacy={() => setPrivacyOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
      />
      <EditAboutMeSheet visible={editAboutOpen} onClose={() => setEditAboutOpen(false)} />
      <MailHistorySheet
        visible={mailOpen !== null}
        initialTab={mailOpen ?? "sent"}
        onClose={() => setMailOpen(null)}
      />
      <NotificationsSheet visible={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      <PrivacySheet visible={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <AboutAppSheet visible={aboutOpen} onClose={() => setAboutOpen(false)} />
    </AppShell>
  );
}

function Svg18() {
  return (
    <Svg width={140} height={9} viewBox="0 0 140 9">
      <Path d="M 0 5 Q 32 1, 64 5 L 70 2 L 76 5 Q 108 9, 140 5" stroke="#9A8D76" strokeWidth={0.9} fill="none" />
    </Svg>
  );
}

function InfoLine({ icon: Icon, label, value, italic = false }: { icon: LucideIcon; label: string; value: string; italic?: boolean }) {
  return (
    <View style={styles.infoLine}>
      <Icon color={colors.ink} size={20} strokeWidth={1.45} />
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
      <Icon color={tone === "red" ? colors.postalRed : colors.ink} size={20} strokeWidth={1.45} />
      <Text style={styles.ideaText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", flexDirection: "row", gap: 16, marginTop: 6 },
  heroCopy: { flex: 1 },
  name: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 44, lineHeight: 48 },
  city: { color: colors.postalBlue, fontFamily: fonts.serif, fontSize: 19, marginTop: -2 },
  since: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.7, marginTop: 8 },
  tagline: { color: colors.ink, fontFamily: fonts.serifItalic, fontSize: 17, lineHeight: 22, marginTop: 8 },
  stamp: { position: "absolute", right: 0, top: 8 },
  about: { minHeight: 250, overflow: "hidden", padding: 22 },
  aboutStamp: { position: "absolute", right: 24, top: 24 },
  aboutPostmark: { left: 22, opacity: 0.6, position: "absolute", top: 80 },
  airmailEdge: { backgroundColor: colors.postalBlue, bottom: 0, left: 0, position: "absolute", top: 0, width: 7 },
  aboutCopy: { gap: 12, paddingRight: 86 },
  aboutTitleRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  editHint: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.7 },
  sectionTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 30, letterSpacing: 0.2 },
  divider: { marginTop: -4 },
  infoLine: { alignItems: "flex-start", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12, paddingBottom: 11 },
  infoText: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 16, lineHeight: 22 },
  infoLabel: { fontFamily: fonts.serifBold },
  italic: { color: "#607A55", fontFamily: fonts.serifItalic },
  ideas: { padding: 18 },
  ideaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  ideaPill: { alignItems: "center", borderRadius: 28, borderWidth: 1, flexDirection: "row", gap: 9, minHeight: 55, paddingHorizontal: 14, width: "100%" },
  ideaText: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 14, lineHeight: 18 },
  previewGrid: { flexDirection: "row", gap: 12 },
  previewPress: { flex: 1 },
  previewCard: { borderRadius: 8, height: 158, overflow: "hidden" },
  previewText: { bottom: 12, left: 12, position: "absolute", right: 12 },
  previewTitleLight: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 19 },
  previewBodyLight: { color: "rgba(255,255,255,0.88)", fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, marginTop: 4 },
  actions: { flexDirection: "row", gap: 12 },
  actionButton: { flex: 1 },
});
