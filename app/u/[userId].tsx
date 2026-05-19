/**
 * v0.7.0.51: Universal Link handler for "scan-to-add-friend."
 *
 * URL: `https://app.themailroom.club/u/{userId}?n={name}&c={city}&s={state}`
 *
 * Flow:
 *   1. Another user shows their QR (encodes the URL above).
 *   2. iOS Camera scans → universal link → THIS route (when Mailroom is
 *      installed). Otherwise Safari → marketing site (build 65+ will
 *      add an App Clip that intercepts before Safari ever loads).
 *   3. Confirm screen: "Add {name} from {city, state} to your rolodex?"
 *   4. On confirm: add via MailClubContext.addFriendByAddress and
 *      navigate to the Friends tab.
 *
 * Edge cases:
 *   - Missing userId: friendly error, "back to home" button.
 *   - Missing name/city in query: show "Mailroom member" placeholder,
 *      still allow adding (with whatever we know).
 *   - User taps "add" twice: button is disabled on submit + idempotent
 *      against the existing rolodex.
 *   - User not signed in: this route is inside the (tabs) auth gate? No —
 *      `app/u/[userId].tsx` is at the root, so it'll show pre-auth. We
 *      need a sign-in nudge in that case.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export default function AddFriendRoute() {
  const { userId, n, c, s } = useLocalSearchParams<{
    userId?: string;
    n?: string;
    c?: string;
    s?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addFriendByAddress, friends, authedUserId } = useMailClub();

  const [submitting, setSubmitting] = useState(false);
  const [added, setAdded] = useState(false);

  const name = (n ?? "").trim() || "Mailroom member";
  const city = (c ?? "").trim();
  const state = (s ?? "").trim();
  const location = state ? `${city}${city ? ", " : ""}${state}` : city;

  const isSelfScan = !!authedUserId && userId === authedUserId;
  const alreadyHas = friends.some(
    (f) => f.name.toLowerCase() === name.toLowerCase()
      && f.city.toLowerCase() === city.toLowerCase()
  );

  function dismiss() {
    router.replace("/");
  }

  async function handleAdd() {
    if (submitting || added) return;
    if (isSelfScan) {
      Alert.alert(
        "That's you!",
        "You can't add yourself as a friend. Share your QR with someone else to let them mail you.",
        [{ text: "OK", onPress: dismiss }],
      );
      return;
    }
    if (alreadyHas) {
      Alert.alert(
        "Already in your rolodex",
        `${name} is already a friend. Open them from the Friends tab.`,
        [{ text: "OK", onPress: () => router.replace("/(tabs)/friends") }],
      );
      return;
    }
    setSubmitting(true);
    try {
      await addFriendByAddress({
        name,
        city,
        state,
      });
      setAdded(true);
      // Give the user a beat to see the success state, then jump to
      // the Friends tab.
      setTimeout(() => router.replace("/(tabs)/friends"), 900);
    } catch (err: any) {
      setSubmitting(false);
      Alert.alert(
        "Couldn't add friend",
        err?.message ?? "Something went wrong. Try again from the Friends tab.",
        [{ text: "OK" }],
      );
    }
  }

  // No userId at all — bad link.
  if (!userId) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 32 }]}>
        <Text style={styles.errorTitle}>Hmm.</Text>
        <Text style={styles.errorBody}>
          This link is missing the user it points to. Ask the sender to share
          their QR again.
        </Text>
        <Pressable onPress={dismiss} style={styles.primaryBtn} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>Back to Mailroom</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <View style={styles.crest}>
        <Text style={styles.kicker}>SCANNED FROM A MAIL CARD</Text>
        <Text style={styles.title}>Add to your rolodex?</Text>
      </View>

      <View style={styles.identity}>
        <IdentityAvatar
          user={{ id: userId, name, city, state } as any}
          size={84}
          variant="hero"
        />
        <Text style={styles.identityName} numberOfLines={1}>{name}</Text>
        {location ? (
          <Text style={styles.identityCity}>{location}</Text>
        ) : null}
        {added ? (
          <View style={styles.addedBadge}>
            <Text style={styles.addedText}>ADDED TO ROLODEX</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.note}>
        We'll save them as a Mailroom contact. You can mail them right away.
        Their address stays private until they share it.
      </Text>

      <Pressable
        onPress={handleAdd}
        disabled={submitting || added}
        style={[styles.primaryBtn, (submitting || added) && styles.primaryBtnDisabled]}
        accessibilityRole="button"
        accessibilityState={{ disabled: submitting || added }}
        testID="add-friend-confirm-btn"
      >
        <Text style={styles.primaryBtnText}>
          {added ? "Added!" : submitting ? "Adding…" : `Add ${name.split(" ")[0]}`}
        </Text>
      </Pressable>

      <Pressable
        onPress={dismiss}
        style={styles.dismissBtn}
        accessibilityRole="button"
        accessibilityLabel="Not now"
      >
        <Text style={styles.dismissBtnText}>Not now</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.paper,
    flex: 1,
    paddingHorizontal: 28,
  },
  crest: {
    alignItems: "center",
    marginBottom: 24,
  },
  kicker: {
    color: colors.mutedInk,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: 6,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 28,
    textAlign: "center",
  },
  identity: {
    alignItems: "center",
    marginBottom: 16,
    padding: 24,
    backgroundColor: "rgba(255,253,247,0.7)",
    borderColor: colors.line,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  identityName: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 26,
    marginTop: 4,
  },
  identityCity: {
    color: colors.postalBlue,
    fontFamily: fonts.serif,
    fontSize: 15,
  },
  addedBadge: {
    backgroundColor: "rgba(96, 122, 85, 0.18)",
    borderColor: "#607A55",
    borderRadius: 99,
    borderWidth: 1,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  addedText: {
    color: "#607A55",
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.4,
  },
  note: {
    color: colors.mutedInk,
    fontFamily: fonts.serif,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 21,
    marginBottom: 24,
    textAlign: "center",
  },
  primaryBtn: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 10,
    marginBottom: 10,
    paddingVertical: 16,
  },
  primaryBtnDisabled: {
    opacity: 0.55,
  },
  primaryBtnText: {
    color: colors.white,
    fontFamily: fonts.serifSemi,
    fontSize: 17,
    letterSpacing: 0.3,
  },
  dismissBtn: {
    alignItems: "center",
    paddingVertical: 14,
  },
  dismissBtnText: {
    color: colors.mutedInk,
    fontFamily: fonts.serif,
    fontSize: 15,
  },
  errorTitle: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 28,
    marginBottom: 12,
    textAlign: "center",
  },
  errorBody: {
    color: colors.mutedInk,
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 32,
    textAlign: "center",
  },
});
