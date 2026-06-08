import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { QrCode, Search, UserPlus, X } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AddFriendSheet } from "@/src/components/AddFriendSheet";
import { AppShell } from "@/src/components/AppShell";
import { FriendDetailSheet } from "@/src/components/FriendDetailSheet";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { Header } from "@/src/components/Header";
import {
  PostcardDetailSheet,
  type PostcardDetailSheetRef,
} from "@/src/components/PostcardDetailSheet";
import { PostalCard } from "@/src/components/PostalCard";
import { PrivacyCard } from "@/src/components/PrivacyCard";
import { QRCodeModal } from "@/src/components/QRCodeModal";
import { RolodexCard } from "@/src/components/RolodexCard";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export default function FriendsScreen() {
  const router = useRouter();
  const { currentUser, friends, postcards, authedUserId } = useMailClub();
  const [qrOpen, setQrOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [activeFriendId, setActiveFriendId] = useState<string | null>(null);
  const activeFriend = friends.find((f) => f.id === activeFriendId) ?? null;
  // v0.7.0.49: search + last-mail sort. Audit flagged this at >20 friends.
  // The search bar only appears when there are 8+ friends so small
  // rolodexes don't get the chrome.
  const [searchQuery, setSearchQuery] = useState("");
  const visibleFriends = useMemo(() => {
    // last-interaction map: for each friend, the timestamp of their
    // most recent postcard exchange (outbound to them OR inbound from them)
    const lastInteractionByFriend = new Map<string, number>();
    for (const p of postcards) {
      const t = p.sentAt ? new Date(p.sentAt).getTime() : 0;
      if (p.toFriendId && p.toFriendId !== "void") {
        const prev = lastInteractionByFriend.get(p.toFriendId) ?? 0;
        if (t > prev) lastInteractionByFriend.set(p.toFriendId, t);
      }
    }
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? friends.filter((f) =>
          [f.name, f.city, f.state].some((s) => (s ?? "").toLowerCase().includes(q)),
        )
      : friends;
    return [...filtered].sort((a, b) => {
      const ta = lastInteractionByFriend.get(a.id) ?? 0;
      const tb = lastInteractionByFriend.get(b.id) ?? 0;
      if (tb !== ta) return tb - ta;
      // Tiebreak alphabetically so untouched friends are predictable.
      return a.name.localeCompare(b.name);
    });
  }, [friends, postcards, searchQuery]);

  // v1.0.1: detail sheet for tapping a postcard inside the friend
  // detail modal's "Recent sends" list. Lives at the friends-tab root
  // (not inside the Modal) so the BottomSheet can render full-screen
  // after the Modal closes.
  const detailRef = useRef<PostcardDetailSheetRef>(null);
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
  // v1.0.1: close the friend Modal first, then open the postcard detail
  // sheet. iOS Modal close takes ~280ms; we defer the detail-sheet open
  // with a setTimeout that matches so the BottomSheet rises into a
  // clean window. Without the delay, the sheet's snapToIndex fires
  // against a still-attached Modal and either gets covered by it or
  // gets its snap dropped.
  function tapPostcardFromFriend(postcardId: string) {
    closeFriend();
    setTimeout(() => detailRef.current?.open(postcardId), 280);
  }

  return (
    <BottomSheetModalProvider>
    <AppShell>
      <Header title="Friends" />

      <View style={styles.yourCardSection}>
        <Text style={styles.yourCardLabel}>YOUR MAIL CARD</Text>
        <Text style={styles.yourCardHint}>What other Mailroom members see when you share your code.</Text>
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
      </View>

      <View style={styles.sectionDivider} />

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

      {/* v0.7.0.49: search bar at 8+ friends. Small rolodexes stay clean. */}
      {friends.length >= 8 ? (
        <View style={styles.searchRow} testID="rolodex-search-row">
          <Search color={colors.mutedInk} size={16} strokeWidth={1.7} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by name or city"
            placeholderTextColor={colors.mutedInk}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.searchInput}
            testID="rolodex-search-input"
          />
          {searchQuery ? (
            <Pressable
              onPress={() => setSearchQuery("")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              testID="rolodex-search-clear"
            >
              <X color={colors.mutedInk} size={16} strokeWidth={1.7} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {friends.length === 0 ? (
        <View style={styles.empty} testID="rolodex-empty">
          <Text style={styles.emptyTitle}>No friends yet.</Text>
          <Text style={styles.emptyBody}>Share your Mail Card to add your first one.</Text>
          {/* v0.5.0: nudge that you don't need to add a friend first to send.
              Magic-link delivery (Phase 3) makes the rolodex optional, but
              even today users can pick "Address" mode on Send. */}
          <Pressable
            onPress={() => router.push({ pathname: "/send", params: { mode: "link" } })}
            style={styles.emptySendBtn}
            testID="rolodex-empty-send"
            accessibilityRole="button"
            accessibilityLabel="Send your first card, it's free"
          >
            <Text style={styles.emptySendBtnText}>Send your first card, it's free →</Text>
          </Pressable>
        </View>
      ) : visibleFriends.length === 0 ? (
        <View style={styles.empty} testID="rolodex-no-matches">
          <Text style={styles.emptyTitle}>No matches.</Text>
          <Text style={styles.emptyBody}>Try a different name or city.</Text>
        </View>
      ) : (
        <View style={styles.rolodex} testID="rolodex-stack">
          {visibleFriends.map((friend, index) => (
            <RolodexCard key={friend.id} friend={friend} index={index} onPress={() => openFriend(friend.id)} />
          ))}
        </View>
      )}

      <PrivacyCard />

      {/* v0.7.0.49: userId was hardcoded "scotty-001" — every user's QR
          modal was rendering the founder's identity hash. The QR's
          internal hashGrid uses `mailroom:<userId>:<name>` so two users
          sharing their QR could collide. Use the real authedUserId
          (falls back to a stable per-session string for unauth/dev). */}
      <QRCodeModal
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        name={currentUser.name}
        city={currentUser.city}
        state={currentUser.state}
        userId={authedUserId ?? "local-self"}
        avatarLook="scotty"
      />

      <FriendDetailSheet
        friend={activeFriend}
        visible={activeFriendId !== null}
        onClose={closeFriend}
        onSend={sendToFriend}
        // v1.0.1: tapping a row in "Recent sends" closes this sheet and
        // opens the postcard detail sheet (photo + message + status).
        onTapPostcard={tapPostcardFromFriend}
      />

      <AddFriendSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(id) => setActiveFriendId(id)}
      />
    </AppShell>
    {/* v1.0.1: lives at root, outside AppShell, so it can render over
        the floating tab bar when a postcard tap surfaces it. */}
    <PostcardDetailSheet ref={detailRef} />
    </BottomSheetModalProvider>
  );
}

const styles = StyleSheet.create({
  yourCardSection: { gap: 4 },
  yourCardLabel: { color: colors.postalBlue, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 1.4, paddingHorizontal: 4 },
  yourCardHint: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16, marginBottom: 6, paddingHorizontal: 4 },
  sectionDivider: { backgroundColor: colors.line, height: 1, marginVertical: 4, opacity: 0.6 },
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
  // v0.7.0.49: rolodex search bar — only renders at 8+ friends.
  searchRow: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    color: colors.ink,
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 14,
    paddingVertical: 0,
  },
  rolodex: { gap: 0 },
  empty: { alignItems: "center", backgroundColor: "rgba(155,175,155,0.12)", borderColor: colors.line, borderRadius: 8, borderWidth: 1, padding: 24 },
  emptyTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 19 },
  emptyBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17, marginTop: 6, textAlign: "center" },
  emptySendBtn: { backgroundColor: colors.ink, borderRadius: 10, marginTop: 14, paddingHorizontal: 18, paddingVertical: 11 },
  emptySendBtnText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 14, letterSpacing: 0.3 },
});
