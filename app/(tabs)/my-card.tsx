import { useRouter } from "expo-router";
import { Cake, Globe2, Image as ImageIcon, LucideIcon, Mail, Pencil, Send, Star, Tag, Users } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { AppShell } from "@/src/components/AppShell";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { EditAboutMeSheet } from "@/src/components/EditAboutMeSheet";
import { AboutAppSheet } from "@/src/components/AboutAppSheet";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { Header } from "@/src/components/Header";
import { MailHistorySheet } from "@/src/components/MailHistorySheet";
import { MetricStrip } from "@/src/components/MetricStrip";
import { NotificationsSheet } from "@/src/components/NotificationsSheet";
import { OnboardingFreeCreditsBanner } from "@/src/components/OnboardingFreeCreditsBanner";
import { PrivacySheet } from "@/src/components/PrivacySheet";
import { PostalCard } from "@/src/components/PostalCard";
import { SettingsSheet } from "@/src/components/SettingsSheet";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * My Card tab — v0.6.1.
 *
 * v0.6.1 cleanup: the bottom Send Mail / Add Friend buttons + the Constellation
 * / Map preview-card grid were all just navigation shortcuts to other tabs
 * (Send, Friends, Constellation, Map are all in the tab bar). User feedback
 * after build 6: "the stuff at the bottom of the profile page just redirects
 * to the other tabs. maybe redundant." Removed both. The MetricStrip at the
 * top remains — those metric tiles are status indicators that happen to be
 * tappable shortcuts, not pure navigation.
 *
 * Older cleanups still in effect:
 *   • "First Card Ideas" 4-circle grid removed.
 *   • Inline `CreditsBalance` row removed. The stamps pill in the Header
 *     is now the only path into the Buy Stamps sheet.
 *   • The CreditsSheet stays mounted on this screen only so that opening
 *     "Buy stamps" from the Settings sheet still works.
 */
export default function MyMailCardScreen() {
  const router = useRouter();
  const { currentUser, friends, postcards, voidReplies } = useMailClub();
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

  return (
    <AppShell>
      <Header title="My Card" onPressSettings={() => setSettingsOpen(true)} />

      <OnboardingFreeCreditsBanner />

      <View style={styles.hero}>
        <IdentityAvatar user={currentUser} size={104} variant="hero" />
        <View style={styles.heroCopy}>
          <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{currentUser.name}</Text>
          <Text style={styles.city}>⌖ {currentUser.city}{currentUser.state ? `, ${currentUser.state}` : ""}</Text>
          <Text style={styles.since}>POSTCARD FRIENDS SINCE {currentUser.since}</Text>
        </View>
      </View>
      {currentUser.tagline ? (
        <Text style={styles.tagline}>{currentUser.tagline}</Text>
      ) : null}

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
          <View style={styles.aboutCopy}>
            <View style={styles.aboutTitleRow}>
              <Text style={styles.sectionTitle}>About me</Text>
              <Pencil color={colors.mutedInk} size={15} strokeWidth={1.5} />
            </View>
            <View style={styles.divider}>
              <Svg18 />
            </View>
            <InfoLine icon={Star} label="Interests:" value={currentUser.interests || "Tap to add"} />
            <InfoLine icon={ImageIcon} label="Send me:" value={currentUser.sendMe || "Tap to add"} />
            <InfoLine icon={Cake} label="Birthday:" value={currentUser.birthday || "Tap to add"} />
            <InfoLine icon={Tag} label="Currently into:" value={currentUser.currentlyInto || "Tap to add"} italic />
          </View>
        </PostalCard>
      </Pressable>

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

const styles = StyleSheet.create({
  hero: { alignItems: "center", flexDirection: "row", gap: 18, marginTop: 8 },
  heroCopy: { flex: 1 },
  name: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 40, lineHeight: 44 },
  city: { color: colors.postalBlue, fontFamily: fonts.serif, fontSize: 17, marginTop: 0 },
  since: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.9, marginTop: 8 },
  tagline: { color: colors.ink, fontFamily: fonts.serifItalic, fontSize: 17, lineHeight: 22, marginTop: 4, paddingHorizontal: 2 },
  about: { overflow: "hidden", padding: 20, paddingLeft: 22 },
  airmailEdge: { backgroundColor: colors.postalBlue, bottom: 0, left: 0, position: "absolute", top: 0, width: 5 },
  aboutCopy: { gap: 12 },
  aboutTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 26, letterSpacing: 0.2 },
  divider: { marginTop: -4 },
  infoLine: { alignItems: "flex-start", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12, paddingBottom: 11 },
  infoText: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 16, lineHeight: 22 },
  infoLabel: { fontFamily: fonts.serifBold },
  italic: { color: "#607A55", fontFamily: fonts.serifItalic },
});
