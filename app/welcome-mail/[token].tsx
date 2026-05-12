import * as AppleAuthentication from "expo-apple-authentication";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowRight, MailOpen, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PostalCard } from "@/src/components/PostalCard";
import { getSignedPhotoUrl, lookupReciprocation, recordReciprocationScan } from "@/src/services/api";
import { clearPendingInvite, setPendingInvite } from "@/src/state/pendingInvite";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors, gradients } from "@/src/theme/colors";
import { fonts, type } from "@/src/theme/typography";

/**
 * /welcome-mail/[token] — the receiver's first moment in the app after
 * scanning the QR on a Mailroom postcard.
 *
 * Two phases:
 *   1. Anonymous lookup (no auth required) via lookupReciprocation. Renders
 *      the sender's name + city + message preview while the user is still
 *      pre-onboarded. Shows a Get Mailroom CTA if they aren't signed in.
 *   2. Authenticated scan via recordReciprocationScan. Inserts the sender
 *      into the receiver's friends rolodex and returns enough state to
 *      render the hero. Continues into the send flow on tap.
 *
 * Routed by Expo Router based on filesystem path. Deep links from
 * mailroom://welcome-mail/TOKEN and https://mailroom.app/r/TOKEN (when
 * Universal Links are configured) both land here.
 */
export default function WelcomeMailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const { hasCompletedSignup, signInWithApple } = useMailClub();
  const token = (params?.token as string | undefined) ?? "";

  const [lookup, setLookup] = useState<Awaited<ReturnType<typeof lookupReciprocation>> | null>(null);
  const [scanResult, setScanResult] = useState<Awaited<ReturnType<typeof recordReciprocationScan>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step 1: public lookup. Runs on every mount, no auth needed.
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setError("Missing token in the link.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await lookupReciprocation(token);
        if (cancelled) return;
        setLookup(res);
        // Phase 3.5: if the lookup succeeded AND we're not signed in yet,
        // stash the token in AsyncStorage so the upcoming sign-up flow
        // can consume it and seed the receiver state. Fire-and-forget —
        // a stash failure shouldn't block the welcome screen render.
        if (res.ok && !hasCompletedSignup) {
          setPendingInvite(token).catch(() => undefined);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Couldn't look up this card.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, hasCompletedSignup]);

  // Phase 3.5: mint a signed URL for the postcard photo so the receiver
  // can see the actual image (not just the message preview). The photo
  // path on lookup is the Supabase Storage key; the bucket isn't public.
  useEffect(() => {
    if (!lookup?.ok || !lookup.photo_path) return;
    let cancelled = false;
    getSignedPhotoUrl(lookup.photo_path)
      .then((url) => {
        if (!cancelled) setPhotoUrl(url ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lookup]);

  // Step 2: authenticated scan. Fires the FIRST time we have BOTH a valid
  // lookup AND a signed-in user. Idempotent on the server (already-scanned
  // tokens return the existing friend_id).
  useEffect(() => {
    if (!token) return;
    if (!hasCompletedSignup) return;
    if (!lookup || !lookup.ok) return;
    if (scanResult) return;
    let cancelled = false;
    (async () => {
      setScanning(true);
      try {
        const res = await recordReciprocationScan(token);
        if (cancelled) return;
        setScanResult(res);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Couldn't record the scan.");
      } finally {
        if (!cancelled) setScanning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, hasCompletedSignup, lookup, scanResult]);

  function dismiss() {
    // codex P2, Phase 3.5 review: an unauthed user who closes the welcome
    // screen has chosen to ignore the card; don't haunt a later signup
    // with it. Authed users already consumed (or are about to), so
    // clearing here is a no-op for them.
    if (!hasCompletedSignup) {
      clearPendingInvite().catch(() => undefined);
    }
    router.replace("/(tabs)/my-card");
  }

  function replyNow() {
    if (scanResult?.ok && scanResult.friend_id) {
      router.replace({
        pathname: "/(tabs)/send",
        params: { friendId: scanResult.friend_id },
      });
    } else {
      router.replace("/(tabs)/send");
    }
  }

  // -- Render branches ----------------------------------------------------

  if (loading) {
    return (
      <BackdropShell>
        <ActivityIndicator color={colors.ink} size="large" />
        <Text style={styles.loadingText}>Opening your card...</Text>
      </BackdropShell>
    );
  }

  if (error || !lookup) {
    return (
      <BackdropShell>
        <Text style={styles.errorTitle}>Hmm.</Text>
        <Text style={styles.errorBody}>{error ?? "Couldn't load this card."}</Text>
        <Pressable onPress={dismiss} style={styles.dismissBtn}>
          <Text style={styles.dismissBtnText}>OK</Text>
        </Pressable>
      </BackdropShell>
    );
  }

  if (!lookup.ok) {
    const msg =
      lookup.reason === "EXPIRED"
        ? "This card's link has expired. The sender can send you another one."
        : lookup.reason === "NOT_FOUND"
          ? "This card link couldn't be found."
          : "Couldn't load this card.";
    return (
      <BackdropShell>
        <Text style={styles.errorTitle}>Hmm.</Text>
        <Text style={styles.errorBody}>{msg}</Text>
        <Pressable onPress={dismiss} style={styles.dismissBtn}>
          <Text style={styles.dismissBtnText}>OK</Text>
        </Pressable>
      </BackdropShell>
    );
  }

  // Successful lookup. Render the hero.
  const senderFirst = (lookup.sender_name ?? "Someone").split(" ")[0];
  const senderCity = lookup.sender_city ?? "";

  return (
    <LinearGradient colors={gradients.paper} style={styles.root}>
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <Pressable onPress={dismiss} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
            <X color={colors.mutedInk} size={22} strokeWidth={1.8} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.kicker}>You got mail</Text>
          <Text style={styles.hero}>
            {lookup.sender_name}{"\n"}sent you a postcard
          </Text>
          {senderCity ? (
            <Text style={styles.sub}>From {senderCity} · Mailed via Mailroom</Text>
          ) : (
            <Text style={styles.sub}>Mailed via Mailroom</Text>
          )}

          <View style={styles.cardWrap}>
            <PostalCard style={styles.card}>
              {photoUrl ? (
                <View style={styles.cardPhotoWrap}>
                  <Image source={{ uri: photoUrl }} style={styles.cardPhoto} resizeMode="cover" />
                </View>
              ) : null}
              <View style={styles.cardFromLine}>
                <Text style={styles.cardFromLabel}>FROM</Text>
                <Text style={styles.cardFromName}>
                  {senderFirst}
                  {senderCity ? ` · ${senderCity}` : ""}
                </Text>
              </View>
              <Text style={styles.cardMessage}>
                {lookup.message_preview || "(message will appear when you flip the printed card)"}
              </Text>
            </PostalCard>
          </View>

          {!hasCompletedSignup ? (
            <View style={styles.signinPrompt}>
              <Text style={styles.signinTitle}>Want to keep it?</Text>
              <Text style={styles.signinBody}>
                Join Mailroom to add {senderFirst} as a friend and send one back. 3 free stamps to start.
              </Text>

              {Platform.OS === "ios" ? (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={14}
                  style={styles.appleBtn}
                  onPress={async () => {
                    if (signingIn) return;
                    setSigningIn(true);
                    try {
                      const res = await signInWithApple();
                      if (res.ok && res.isNewUser) {
                        // Apple gave us a session but the user still needs to
                        // pick city + state. The WelcomeSheet handles that
                        // when we route them to /; pendingInvite is already
                        // stashed so completeSignup will consume it.
                        router.replace("/");
                      } else if (res.ok) {
                        // Returning user — context.signInWithApple consumed
                        // the pendingInvite already. Stay here and let the
                        // scan effect re-run with hasCompletedSignup=true.
                        // (No nav needed; the useEffect chain reacts.)
                      } else {
                        Alert.alert("Sign in cancelled", "No worries — your card is still on the printed page.");
                      }
                    } catch (e: any) {
                      Alert.alert("Sign in failed", e?.message ?? "Try again in a moment.");
                    } finally {
                      setSigningIn(false);
                    }
                  }}
                />
              ) : null}

              <Pressable
                onPress={() => router.replace("/")}
                style={[styles.secondaryBtn, { marginTop: 4 }]}
                accessibilityRole="button"
                accessibilityLabel="Sign up with email instead"
              >
                <Text style={styles.secondaryBtnText}>Or sign up with email →</Text>
              </Pressable>
            </View>
          ) : scanning ? (
            <View style={styles.scanningRow}>
              <ActivityIndicator color={colors.mutedInk} size="small" />
              <Text style={styles.scanningText}>Adding {senderFirst} to your rolodex...</Text>
            </View>
          ) : scanResult && scanResult.ok ? (
            <View style={styles.successBlock}>
              <View style={styles.successHeader}>
                <MailOpen color={colors.postalBlue} size={20} strokeWidth={1.8} />
                <Text style={styles.successTitle}>
                  {scanResult.already_scanned
                    ? `Already in your rolodex.`
                    : `${senderFirst} is now in your rolodex.`}
                </Text>
              </View>
              <Text style={styles.successBody}>
                The postcard is saved on your Map. Tap below to write back.
              </Text>
              <Pressable
                onPress={replyNow}
                style={styles.primaryBtn}
                accessibilityRole="button"
                accessibilityLabel={`Send a card back to ${senderFirst}`}
              >
                <ArrowRight color={colors.white} size={18} strokeWidth={1.8} />
                <Text style={styles.primaryBtnText}>Send one back · free</Text>
              </Pressable>
              <Pressable onPress={dismiss} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Save for later</Text>
              </Pressable>
            </View>
          ) : scanResult && !scanResult.ok ? (
            <View style={styles.signinPrompt}>
              <Text style={styles.signinTitle}>
                {scanResult.reason === "OWN_CARD"
                  ? "That's your own card."
                  : scanResult.reason === "ALREADY_SCANNED_BY_OTHER"
                    ? "Someone else already opened this link."
                    : "Couldn't claim this card."}
              </Text>
              <Text style={styles.signinBody}>
                {scanResult.reason === "OWN_CARD"
                  ? "You can't reciprocate your own send. Pass the card to a friend!"
                  : "Each Mailroom card link works for one Mailroom account. Your postcard is still yours to keep on the physical card."}
              </Text>
              <Pressable onPress={dismiss} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>OK</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function BackdropShell({ children }: { children: React.ReactNode }) {
  return (
    <LinearGradient colors={gradients.paper} style={styles.root}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.center}>
        {children}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: "center", flex: 1, gap: 16, justifyContent: "center", padding: 32 },
  loadingText: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 16 },
  errorTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28 },
  errorBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 15, lineHeight: 22, maxWidth: 320, textAlign: "center" },
  dismissBtn: { backgroundColor: colors.ink, borderRadius: 12, marginTop: 12, paddingHorizontal: 28, paddingVertical: 12 },
  dismissBtnText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 15 },

  topBar: { alignItems: "flex-end", paddingHorizontal: 18, paddingTop: 8 },
  closeBtn: { backgroundColor: "rgba(15,37,66,0.06)", borderRadius: 18, padding: 8 },

  scroll: { gap: 4, paddingBottom: 48, paddingHorizontal: 24, paddingTop: 8 },
  kicker: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 12, letterSpacing: 1.6, textTransform: "uppercase" },
  hero: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: type.title + 4, letterSpacing: -0.4, lineHeight: type.title + 8, marginTop: 8 },
  sub: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 15, lineHeight: 20, marginTop: 6 },

  cardWrap: { marginTop: 22, transform: [{ rotate: "-1.5deg" }] },
  card: { padding: 22 },
  cardPhotoWrap: { aspectRatio: 3 / 2, borderRadius: 4, marginBottom: 14, overflow: "hidden" },
  cardPhoto: { height: "100%", width: "100%" },
  cardFromLine: { marginBottom: 12 },
  cardFromLabel: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 9, letterSpacing: 1.8 },
  cardFromName: { color: colors.ink, fontFamily: fonts.serifItalic, fontSize: 17, marginTop: 3 },
  cardMessage: { color: colors.ink, fontFamily: fonts.hand, fontSize: 22, lineHeight: 30 },

  signinPrompt: { gap: 10, marginTop: 28 },
  signinTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22 },
  signinBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14, lineHeight: 20 },

  scanningRow: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "center", marginTop: 28 },
  scanningText: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14 },

  successBlock: { gap: 10, marginTop: 28 },
  successHeader: { alignItems: "center", flexDirection: "row", gap: 8 },
  successTitle: { color: colors.ink, flex: 1, fontFamily: fonts.serifSemi, fontSize: 17 },
  successBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14, lineHeight: 20 },

  primaryBtn: { alignItems: "center", backgroundColor: colors.ink, borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 14, paddingHorizontal: 22, paddingVertical: 14 },
  primaryBtnText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 16 },
  secondaryBtn: { alignItems: "center", marginTop: 6, padding: 10 },
  secondaryBtnText: { color: colors.postalBlue, fontFamily: fonts.serifSemi, fontSize: 14, textDecorationLine: "underline" },
  // Apple Sign In button — fixed 48pt height per Apple HIG. Width fills the
  // container. Sits above the email signup fallback so it's the obvious tap.
  appleBtn: { height: 48, marginTop: 12, width: "100%" },
});
