import { ChevronDown, Link as LinkIcon, MapPin, UserPlus, User } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { IllustratedAvatar, AvatarLook } from "@/src/components/Avatar";
import { PostalCard } from "@/src/components/PostalCard";
import type { Friend } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Three ways to address a postcard in the MVP:
 *
 *   1. friend   — pick someone from your saved friends list (cycle through)
 *   2. link     — send the recipient a magic link to fill in their own address
 *                 (they never share it with the sender)
 *   3. address  — paste in a fresh mailing address (one-off, not saved)
 *
 * The UI is a segmented selector + a context panel below. State lives in the
 * parent (the send screen) so the parent can build the right SendInput based
 * on the chosen mode.
 */

export type RecipientMode = "friend" | "link" | "address";

export type AddressDraft = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
};

export const EMPTY_ADDRESS: AddressDraft = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  zip: "",
};

export function isAddressComplete(a: AddressDraft): boolean {
  return (
    a.name.trim().length > 0 &&
    a.line1.trim().length > 0 &&
    a.city.trim().length > 0 &&
    a.state.trim().length > 0 &&
    /^\d{5}(-\d{4})?$/.test(a.zip.trim())
  );
}

type Props = {
  mode: RecipientMode;
  onModeChange: (m: RecipientMode) => void;
  friends: Friend[];
  friendIndex: number;
  onFriendIndexChange: (i: number) => void;
  address: AddressDraft;
  onAddressChange: (a: AddressDraft) => void;
  onAddFriend: () => void;
};

export function RecipientPicker({
  mode,
  onModeChange,
  friends,
  friendIndex,
  onFriendIndexChange,
  address,
  onAddressChange,
  onAddFriend,
}: Props) {
  const friend = useMemo(
    () => (friends.length ? friends[Math.min(friendIndex, friends.length - 1)] : null),
    [friends, friendIndex],
  );

  return (
    <View style={styles.root}>
      {/* Segmented mode selector */}
      <View style={styles.segments}>
        <Segment
          label="Friend"
          icon={User}
          active={mode === "friend"}
          onPress={() => onModeChange("friend")}
        />
        <Segment
          label="Ask"
          icon={LinkIcon}
          active={mode === "link"}
          onPress={() => onModeChange("link")}
        />
        <Segment
          label="Address"
          icon={MapPin}
          active={mode === "address"}
          onPress={() => onModeChange("address")}
        />
      </View>

      {/* Body for each mode */}
      {mode === "friend" ? (
        friend ? (
          <Pressable
            onPress={() => onFriendIndexChange((friendIndex + 1) % friends.length)}
            testID="recipient-friend-cycler"
            accessibilityRole="button"
            accessibilityLabel={`Recipient: ${friend.name}. Tap to cycle.`}
          >
            <PostalCard style={styles.friendCard}>
              <IllustratedAvatar look={friend.id as AvatarLook} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={styles.friendName}>{friend.name}</Text>
                <Text style={styles.friendMeta}>
                  {friend.city}{friend.state ? `, ${friend.state}` : ""}
                </Text>
                {!friend.addressLine1 ? (
                  <Text style={styles.friendWarn}>No address yet — pick "Ask" to request it</Text>
                ) : null}
              </View>
              <ChevronDown color={colors.ink} size={20} />
            </PostalCard>
          </Pressable>
        ) : (
          <PostalCard style={styles.empty} testID="recipient-empty">
            <View style={styles.emptyIcon}>
              <UserPlus color={colors.postalRed} size={22} strokeWidth={1.6} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emptyTitle}>No friends yet.</Text>
              <Text style={styles.emptyBody}>Add one — or send a link instead.</Text>
            </View>
            <Pressable
              onPress={onAddFriend}
              style={styles.emptyBtn}
              testID="recipient-empty-add"
              accessibilityRole="button"
            >
              <Text style={styles.emptyBtnText}>Add</Text>
            </Pressable>
          </PostalCard>
        )
      ) : null}

      {mode === "link" ? (
        <PostalCard style={styles.linkCard} testID="recipient-link">
          <View style={styles.linkIcon}>
            <LinkIcon color={colors.postalRed} size={22} strokeWidth={1.7} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>Ask for their address</Text>
            <Text style={styles.linkBody}>
              We'll generate a magic link to share via iMessage or anywhere. They fill in their
              address privately — you never see it.
            </Text>
          </View>
        </PostalCard>
      ) : null}

      {mode === "address" ? (
        <View style={styles.addressBlock} testID="recipient-address">
          <TextInput
            value={address.name}
            onChangeText={(v) => onAddressChange({ ...address, name: v })}
            placeholder="Full name"
            placeholderTextColor="#9A8D76"
            style={styles.input}
            textContentType="name"
            autoCapitalize="words"
            testID="recipient-address-name"
          />
          <TextInput
            value={address.line1}
            onChangeText={(v) => onAddressChange({ ...address, line1: v })}
            placeholder="Street address"
            placeholderTextColor="#9A8D76"
            style={styles.input}
            textContentType="streetAddressLine1"
            autoCapitalize="words"
            testID="recipient-address-line1"
          />
          <TextInput
            value={address.line2 ?? ""}
            onChangeText={(v) => onAddressChange({ ...address, line2: v })}
            placeholder="Apt, suite (optional)"
            placeholderTextColor="#9A8D76"
            style={styles.input}
            textContentType="streetAddressLine2"
            autoCapitalize="words"
          />
          <View style={styles.row}>
            <TextInput
              value={address.city}
              onChangeText={(v) => onAddressChange({ ...address, city: v })}
              placeholder="City"
              placeholderTextColor="#9A8D76"
              style={[styles.input, { flex: 2 }]}
              textContentType="addressCity"
              autoCapitalize="words"
              testID="recipient-address-city"
            />
            <TextInput
              value={address.state}
              onChangeText={(v) => onAddressChange({ ...address, state: v.toUpperCase().slice(0, 2) })}
              placeholder="ST"
              placeholderTextColor="#9A8D76"
              style={[styles.input, { flex: 1 }]}
              textContentType="addressState"
              autoCapitalize="characters"
              maxLength={2}
              testID="recipient-address-state"
            />
            <TextInput
              value={address.zip}
              onChangeText={(v) => onAddressChange({ ...address, zip: v.replace(/[^\d-]/g, "").slice(0, 10) })}
              placeholder="ZIP"
              placeholderTextColor="#9A8D76"
              style={[styles.input, { flex: 1.2 }]}
              keyboardType="number-pad"
              textContentType="postalCode"
              maxLength={10}
              testID="recipient-address-zip"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Segment({
  label,
  icon: Icon,
  active,
  onPress,
}: {
  label: string;
  icon: any;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segment, active && styles.segmentActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      testID={`recipient-segment-${label.toLowerCase()}`}
    >
      <Icon color={active ? colors.white : colors.ink} size={15} strokeWidth={active ? 2 : 1.7} />
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  segments: { flexDirection: "row", gap: 6 },
  segment: { alignItems: "center", borderColor: colors.line, borderRadius: 10, borderWidth: 1, flex: 1, flexDirection: "row", gap: 6, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 10 },
  segmentActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  segmentText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
  segmentTextActive: { color: colors.white },

  friendCard: { alignItems: "center", flexDirection: "row", gap: 12, padding: 14 },
  friendName: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22 },
  friendMeta: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 2 },
  friendWarn: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.5, marginTop: 6 },

  empty: { alignItems: "center", backgroundColor: "rgba(184,74,58,0.05)", borderColor: "rgba(184,74,58,0.3)", borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  emptyIcon: { alignItems: "center", backgroundColor: "rgba(184,74,58,0.12)", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  emptyTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17 },
  emptyBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 2 },
  emptyBtn: { backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  emptyBtnText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 14 },

  linkCard: { alignItems: "center", backgroundColor: "rgba(184,74,58,0.06)", borderColor: "rgba(184,74,58,0.35)", borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  linkIcon: { alignItems: "center", backgroundColor: "rgba(184,74,58,0.12)", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  linkTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17 },
  linkBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17, marginTop: 4 },

  addressBlock: { gap: 8 },
  input: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 16, paddingHorizontal: 12, paddingVertical: 11 },
  row: { flexDirection: "row", gap: 8 },
});
