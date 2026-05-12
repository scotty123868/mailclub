import { useRouter } from "expo-router";
import { Cake, Globe2, Image as ImageIcon, LucideIcon, Mail, MapPinned, Pencil, Send, Star, Tag, UserPlus, Users } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { AppShell } from "@/src/components/AppShell";
import { PrimaryButton, SecondaryButton } from "@/src/components/Buttons";
import { ConstellationPanel } from "@/src/components/ConstellationPanel";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { EditAboutMeSheet } from "@/src/components/EditAboutMeSheet";
import { AboutAppSheet } from "@/src/components/AboutAppSheet";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { Header } from "@/src/components/Header";
import { MailHistorySheet } from "@/src/components/MailHistorySheet";
import { MapPanel } from "@/src/components/MapPanel";
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
 * My Card tab — v0.5.0.
 *
 * Cleanups per the send-flow gallery decisions:
 *   • "First Card Ideas" 4-circle grid removed. The empty-state CTA in the
 *     send flow (and the on-page Send/Add Friend buttons here) absorb that
 *     intent.
 *   • Inline `CreditsBalance` "3 credits · + Buy" row removed. The stamps
 *     pill in the Header is now the only path into the Buy Stamps sheet.
 *   • Header title shortened to "My Card" (was "My Mail Card"). Same screen,
 *     less of a mouthful.
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

      <View style={styles.previewGrid}>
        <Pressable onPress={() => router.push("/constellation")} style={styles.previewPress} testID="preview-constellation">
          <View style={styles.previewCard}>
            <ConstellationPanel compact friends={friends} />
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
  previewGrid: { flexDirection: "row", gap: 12 },
  previewPress: { flex: 1 },
  previewCard: { borderRadius: 8, height: 158, overflow: "hidden" },
  previewText: { bottom: 12, left: 12, position: "absolute", right: 12 },
  previewTitleLight: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 19 },
  previewBodyLight: { color: "rgba(255,255,255,0.88)", fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, marginTop: 4 },
  actions: { flexDirection: "row", gap: 12 },
  actionButton: { flex: 1 },
});
