/**
 * iOS app handler for `/claim?t=<token>` Universal Links.
 *
 * Context: when a sender uses "Share a link" instead of mailing to a known
 * friend, the recipient gets a link like `https://app.themailroom.club/claim?t=XYZ`.
 * The recipient pastes their address; only THEN does the postcard print + ship.
 *
 * The web fallback at app.themailroom.club/claim handles ALL users today —
 * that's the canonical claim form. This iOS route exists because the AASA
 * declares `/claim?t=*` as an app intercept; without an app route, an iOS
 * user with the Mailroom app installed gets ROUTED to the app by iOS and
 * then hits a 404 inside the app.
 *
 * v0.7.0.57: added self-link detection. Before, tapping your own sent link
 * would open the web form and let you fill in your own address — which is
 * not what the link is for and burned the one-shot claim. Now we check the
 * postcard_claims table for `sender_id = auth.uid()` and show a friendly
 * "this is your own card — share with someone else" UI when it matches.
 *
 * Implementation: route non-self claims to the canonical web form via
 * Safari. Self claims show an in-app message + reshare CTA.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/src/services/supabase";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

type RouteState =
  | { kind: "loading" }
  | { kind: "self"; claimUrl: string }
  | { kind: "error"; message: string };

export default function ClaimRouteHandler() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Guard against double-process if the screen re-mounts (Expo Router can
  // re-mount on focus). Once we've routed/decided, do nothing on later renders.
  const decided = useRef(false);
  const [state, setState] = useState<RouteState>({ kind: "loading" });

  useEffect(() => {
    if (decided.current) return;
    if (!t) {
      decided.current = true;
      setState({
        kind: "error",
        message:
          "This link is missing its token. Ask the sender to share the URL again.",
      });
      return;
    }

    (async () => {
      decided.current = true;
      const claimUrl = `https://app.themailroom.club/claim?t=${encodeURIComponent(t)}`;

      // Self-link check: if the signed-in user is the sender of this
      // claim, RLS lets us see the row. Otherwise we get no row + we
      // treat the link as belonging to someone else and open Safari.
      try {
        const { data: session } = await supabase.auth.getSession();
        const myUserId = session?.session?.user?.id;
        if (myUserId) {
          const { data: claimRow } = await supabase
            .from("postcard_claims")
            .select("id, claimed_at")
            .eq("claim_token", t)
            .eq("sender_id", myUserId)
            .maybeSingle();
          if (claimRow) {
            // This is the user's own outbound claim. Don't let them
            // burn it on themselves.
            setState({ kind: "self", claimUrl });
            return;
          }
        }
      } catch {
        // Network/RLS error — fall through to the web form, same as
        // the unauthed path. We'd rather route a real recipient to the
        // form than hard-fail because of a transient lookup error.
      }

      // Not the sender (or unauthenticated). Open the canonical web
      // form. We open external Safari rather than an in-app browser so
      // form autofill + iCloud Keychain + Google Places work cleanly.
      try {
        await Linking.openURL(claimUrl);
        router.replace("/");
      } catch {
        setState({
          kind: "error",
          message:
            "Couldn't open the address form. Try again from the link the sender sent.",
        });
      }
    })();
  }, [t, router]);

  if (state.kind === "error") {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 32 }]}>
        <Text style={styles.errorTitle}>Hmm.</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
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

  if (state.kind === "self") {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 48 }]}>
        <Text style={styles.selfKicker}>YOUR OWN LINK</Text>
        <Text style={styles.selfTitle}>This card's waiting for the recipient.</Text>
        <Text style={styles.selfBody}>
          You sent this link out yourself. Don't fill in your own address —
          it'll use up the one-shot claim and your friend won't get the
          card. Share the link with the person you wanted to mail.
        </Text>

        <Pressable
          onPress={async () => {
            try {
              await Share.share({
                url: state.claimUrl,
                message: `I sent you a postcard via Mailroom. Tap to claim it: ${state.claimUrl}`,
              });
            } catch {
              // user dismissed the share sheet — no-op
            }
          }}
          style={styles.primaryBtn}
          accessibilityRole="button"
          accessibilityLabel="Share this link"
        >
          <Text style={styles.primaryBtnText}>Share the link again</Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace("/")}
          style={styles.secondaryBtn}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
        >
          <Text style={styles.secondaryBtnText}>Back to Mailroom</Text>
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
  selfKicker: {
    color: colors.postalRed,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.6,
    marginBottom: 10,
  },
  selfTitle: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 28,
    lineHeight: 33,
    maxWidth: 320,
    textAlign: "center",
  },
  selfBody: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    maxWidth: 320,
    textAlign: "center",
  },
  primaryBtn: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    marginTop: 32,
    paddingHorizontal: 24,
    paddingVertical: 14,
    minWidth: 240,
    alignItems: "center",
  },
  primaryBtnText: {
    color: colors.paper,
    fontFamily: fonts.serifSemi,
    fontSize: 15,
  },
  secondaryBtn: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    minWidth: 240,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
  },
});
