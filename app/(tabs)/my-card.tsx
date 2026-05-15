import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { Mail, Pencil, Send, Users } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
import {
  PostcardDetailSheet,
  type PostcardDetailSheetRef,
} from "@/src/components/PostcardDetailSheet";
import { PrivacySheet } from "@/src/components/PrivacySheet";
import { SettingsSheet } from "@/src/components/SettingsSheet";
import { WeeklyJournal } from "@/src/components/WeeklyJournal";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * My Card tab — v0.7.
 *
 * Restructured per user spec:
 *   • Hero: avatar + name + city. **No** "Postcard Friends Since 2026"
 *     line (it&apos;s your own profile, you know when you joined).
 *   • Bio: one editable textarea, replaces the old About-me grid
 *     (interests / send-me / birthday / currently-into). Tap → opens
 *     EditAboutMeSheet which now scopes down to just the bio field.
 *   • Stats: **3** tiles — Friends · Sent · Received. Replaced "Replies"
 *     copy with "Received"; removed "Cities" (lived on the Map tab anyway).
 *   • Rest of the screen: the week-by-week postcard journal. This used
 *     to be a separate "Postcards" tab in earlier v0.7 drafts; per user
 *     spec it lives inside My Card now where your own postcard history
 *     naturally belongs.
 *
 * The Settings sheet still mounts here so old paths (Buy stamps,
 * Address book, Notifications, Privacy, About) all still reach. The
 * AppShell + Header pattern is unchanged from v0.6.x.
 */
export default function MyMailCardScreen() {
  const router = useRouter();
  const { currentUser, friends, postcards, voidReplies, authedUserId } = useMailClub();
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editAboutOpen, setEditAboutOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState<null | "sent" | "replies">(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // v0.7.0.7: per-card detail sheet for the gallery. Tap a journal tile
  // → opens the postcard's photo + message + (for send-link cards) the
  // claim URL + Share Again button.
  const detailSheetRef = useRef<PostcardDetailSheetRef>(null);

  // Real metrics derived from state. We DON'T fake-inflate these — if you
  // sent zero, "0" is the right number, and the empty-week whisper on the
  // journal below will nudge accordingly.
  //
  // v0.7.1: senderId is now exposed on Postcard. Sent = postcards where
  // senderId matches the current user (or undefined, legacy fallback).
  // Received = postcards where senderId is OTHER + void replies.
  const sentCount = useMemo(() => {
    return postcards.filter((p) => {
      const isOutbound = p.senderId
        ? p.senderId === authedUserId
        : true; // legacy: cards without senderId are outbound by default
      // v0.7.0.19: include "awaiting_address" (the send-link path before
      // the recipient claims). From the user's POV they took the action;
      // the card counts as sent even if it's pending a claim. Previously
      // only `status === "sent"` was counted, so welcome-flow Share-a-link
      // cards never landed in the user's Sent metric — which read as
      // "my postcard didn't save."
      return isOutbound && (p.status === "sent" || p.status === "awaiting_address");
    }).length;
  }, [postcards, authedUserId]);

  const receivedCount = useMemo(() => {
    const inboundPostcards = postcards.filter((p) => {
      if (!p.senderId) return false; // legacy: outbound-only
      return p.senderId !== authedUserId;
    }).length;
    return inboundPostcards + voidReplies.length;
  }, [postcards, authedUserId, voidReplies]);

  // friendId → friend name lookup table for the WeeklyJournal to label
  // inbound cards by who they came from.
  const friendNamesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of friends) m.set(f.id, f.name.split(" ")[0] ?? f.name);
    return m;
  }, [friends]);

  const bioText = currentUser.tagline?.trim();

  return (
    <BottomSheetModalProvider>
    <AppShell>
      <Header title="My Card" onPressSettings={() => setSettingsOpen(true)} />

      <OnboardingFreeCreditsBanner />

      {/* Hero: avatar + name + city. No since-line. */}
      <View style={styles.hero}>
        <IdentityAvatar user={currentUser} size={96} variant="hero" />
        <View style={styles.heroCopy}>
          <Text
            style={styles.name}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {currentUser.name}
          </Text>
          <Text style={styles.city}>
            ⌖ {currentUser.city}
            {currentUser.state ? `, ${currentUser.state}` : ""}
          </Text>
        </View>
      </View>

      {/* Editable bio. Tap opens the edit sheet. Shows a placeholder
          state when bio is empty so the affordance is visible. */}
      <Pressable
        onPress={() => setEditAboutOpen(true)}
        testID="bio-edit-trigger"
        accessibilityRole="button"
        accessibilityLabel={bioText ? "Edit your bio" : "Add a bio"}
        style={styles.bio}
      >
        <Text
          style={[styles.bioText, !bioText && styles.bioPlaceholder]}
          numberOfLines={3}
        >
          {bioText || "Tap to add a bio — one line about you."}
        </Text>
        <Pencil color={colors.mutedInk} size={14} strokeWidth={1.6} style={styles.bioPencil} />
      </Pressable>

      {/* 3 metric tiles. No more 4-tile strip; Cities is gone (lives on
          the Map tab where it belongs). */}
      <MetricStrip
        metrics={[
          {
            icon: Users,
            value: friends.length,
            label: "Friends",
            onPress: () => router.push("/friends"),
            testID: "metric-friends",
          },
          {
            icon: Send,
            value: sentCount,
            label: "Sent",
            accent: "#607A55",
            onPress: () => setMailOpen("sent"),
            testID: "metric-sent",
          },
          {
            icon: Mail,
            value: receivedCount,
            label: "Received",
            accent: colors.postalBlue,
            onPress: () => setMailOpen("replies"),
            testID: "metric-received",
          },
        ]}
      />

      {/* Section heading for the journal. */}
      <View style={styles.journalHeader}>
        <Text style={styles.journalTitle}>Your postcard journal</Text>
      </View>

      <ScrollView
        horizontal={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.journalScroll}
      >
        <WeeklyJournal
          postcards={postcards}
          voidReplies={voidReplies}
          currentUserId={authedUserId}
          friendNamesById={friendNamesById}
          onPressCard={(cardId) => detailSheetRef.current?.open(cardId)}
          onPressEmptyTile={() => router.push("/send")}
        />
      </ScrollView>

      {/* Mounted sheets */}
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
        onPressRow={(postcardId) => {
          // v0.7.0.25: tap a row in the "Your mail" sheet → close it +
          // open the PostcardDetailSheet for that card. The detail sheet
          // exposes the claim URL + Share Again for link-mode cards so
          // the user can re-share without going back through Compose.
          setMailOpen(null);
          // Defer the snap to the next frame so the modal dismiss
          // animation finishes before the bottom sheet rises — keeps
          // the visual handoff clean instead of competing.
          requestAnimationFrame(() => {
            detailSheetRef.current?.open(postcardId);
          });
        }}
      />
      <NotificationsSheet visible={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      <PrivacySheet visible={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <AboutAppSheet visible={aboutOpen} onClose={() => setAboutOpen(false)} />
    </AppShell>
    {/* PostcardDetailSheet mounts outside AppShell so the bottom-sheet
        portal renders over the tab bar + safe area. */}
    <PostcardDetailSheet ref={detailSheetRef} />
    </BottomSheetModalProvider>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    marginTop: 8,
  },
  heroCopy: { flex: 1 },
  name: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 36,
    lineHeight: 40,
  },
  city: {
    color: colors.postalBlue,
    fontFamily: fonts.serif,
    fontSize: 16,
    marginTop: 2,
  },

  // Bio — single line, editable, replaces the 4-row About-me grid.
  bio: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingRight: 32, // room for pencil
    marginTop: 14,
    position: "relative",
  },
  bioText: {
    color: colors.ink,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 19,
  },
  bioPlaceholder: { color: colors.mutedInk },
  bioPencil: {
    position: "absolute",
    top: 12,
    right: 12,
  },

  journalHeader: {
    marginTop: 18,
    marginBottom: 8,
  },
  journalTitle: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 20,
    letterSpacing: -0.2,
  },

  journalScroll: {
    paddingBottom: 24,
  },
});
