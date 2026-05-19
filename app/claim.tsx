/**
 * iOS app handler for `/claim?t=<token>` Universal Links.
 *
 * Context: when a sender uses "Share a link" instead of mailing to a known
 * friend, the recipient gets a link like `https://app.themailroom.club/claim?t=XYZ`.
 * The recipient pastes their address; only THEN does the postcard print + ship.
 *
 * The web fallback at `vercel-staging/app/claim/page.tsx` handles ALL users
 * today — that's the canonical claim form. This iOS route exists because
 * the AASA declares `/claim?t=*` as an app intercept; without an app
 * route, an iOS user with the Mailroom app installed gets ROUTED to the
 * app by iOS and then hits a 404 inside the app.
 *
 * Implementation: route to the canonical web form via in-app browser.
 * The recipient is usually NOT a Mailroom user yet (they're entering an
 * address to receive their first card), so duplicating the address-entry
 * UI in the iOS app would be a maintenance tax for a rare edge case.
 *
 * Edge cases handled:
 *   - No `t` query param: show a friendly error + dismiss to home
 *   - User backs out of in-app browser: return to home (no stuck state)
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export default function ClaimRouteHandler() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Guard against double-open if the screen re-mounts (Expo Router can
  // re-mount on focus). Once we've opened the browser, do nothing on
  // subsequent renders.
  const opened = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened.current) return;
    if (!t) {
      setError("This link is missing its token. Ask the sender to share the URL again.");
      return;
    }
    opened.current = true;
    const url = `https://app.themailroom.club/claim?t=${encodeURIComponent(t)}`;
    // Open in external Safari. The web form is the canonical claim
    // surface — duplicating address entry in the iOS app would be a
    // maintenance tax for a rare edge case (existing Mailroom user
    // who taps a claim link). After Safari opens we route back to the
    // home tab so the app isn't stuck on this empty handler.
    Linking.openURL(url)
      .catch(() => {
        setError("Couldn't open the address form. Try again from the link the sender sent.");
      })
      .finally(() => {
        router.replace("/");
      });
  }, [t, router]);

  if (error) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 32 }]}>
        <Text style={styles.errorTitle}>Hmm.</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Pressable
          onPress={() => router.replace("/")}
          style={styles.dismissBtn}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
        >
          <Text style={styles.dismissBtnText}>OK</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 64 }]}>
      <ActivityIndicator color={colors.ink} size="small" />
      <Text style={styles.loadingText}>Opening claim form...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: colors.paper,
    flex: 1,
    paddingHorizontal: 32,
  },
  loadingText: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    marginTop: 14,
  },
  errorTitle: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 28,
  },
  errorBody: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 320,
    textAlign: "center",
  },
  dismissBtn: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    marginTop: 24,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  dismissBtnText: {
    color: colors.paper,
    fontFamily: fonts.serifSemi,
    fontSize: 15,
  },
});
