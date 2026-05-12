import { useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Sparkles, X } from "lucide-react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { CREDIT_PACKS, type CreditPack } from "@/src/data/credits";
import { isStripeConfigured, loadStripeSdk, purchasePack } from "@/src/services/payments";
import { StripeShell } from "@/src/services/StripeShell";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Stamps store. Purchases route through Stripe Payment Sheet (Apple Pay +
 * card). NOT Apple IAP — see src/services/payments.ts for why physical-goods
 * carve-out (Guideline 3.1.5(a)) applies here.
 *
 * Flow:
 *   - User taps a pack → purchasePack(pack) opens Payment Sheet
 *   - On success, we refetch the profile so balance updates
 *   - Stripe webhook fires server-side as authoritative source-of-truth
 *
 * Vocabulary: internally we call the unit `credits` (database column,
 * variable names, test fixtures) — but every user-facing string says
 * "stamp" because that's what one credit literally is: enough to mail
 * one printed-and-addressed postcard.
 */
export function CreditsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { credits, refreshProfile } = useMailClub();
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  // Distinguish "publishable key not set" (dev-config issue) from "native
  // SDK failed to load on this device" (e.g. iOS 26 sim, version skew).
  // CRITICAL: only probe the SDK when the sheet is actually visible. RN's
  // Modal keeps children mounted even when invisible, so an unconditional
  // loadStripeSdk() here fires the synchronous `require()` on every parent
  // render — and on devices where the native module isn't linked, that
  // pops a dev-mode RedBox even though the underlying error is caught.
  const stripeKeySet = isStripeConfigured();
  const stripeSdkLoaded = visible && stripeKeySet ? loadStripeSdk() !== null : false;
  const stripeReady = stripeKeySet && stripeSdkLoaded;

  const onBuy = async (pack: CreditPack) => {
    if (busyPackId) return;
    setBusyPackId(pack.id);
    try {
      const result = await purchasePack(pack);
      if (result.ok) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await refreshProfile();
        Alert.alert(
          "You're in!",
          `${result.creditsAdded} stamp${result.creditsAdded === 1 ? "" : "s"} added to your balance. Go mail something.`,
        );
        onClose();
      } else if (result.reason === "cancelled") {
        // No alert on cancel — user knows what they did.
      } else {
        Alert.alert(
          "Couldn't complete the purchase",
          result.message ?? "Try again or use a different card.",
        );
      }
    } catch (err: any) {
      Alert.alert("Something went wrong", err?.message ?? "Try again.");
    } finally {
      setBusyPackId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? (
      <StripeShell>
        <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Buy stamps</Text>
            <Text style={styles.subtitle}>
              {credits} {credits === 1 ? "stamp" : "stamps"} in your pocket. Each one mails a real postcard, anywhere in the US.
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close stamps sheet"
            testID="credits-sheet-close"
          >
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {!stripeKeySet ? (
            <View style={styles.warnBanner} testID="credits-stripe-missing">
              <Text style={styles.warnTitle}>Stripe not configured yet.</Text>
              <Text style={styles.warnBody}>
                Set `stripePublishableKey` in app.json `extra` to enable purchases. See STRIPE_SETUP.md.
              </Text>
            </View>
          ) : !stripeSdkLoaded ? (
            <View style={styles.warnBanner} testID="credits-stripe-sdk-missing">
              <Text style={styles.warnTitle}>Purchases aren't available on this device.</Text>
              <Text style={styles.warnBody}>
                The Stripe payment library couldn't load on this iOS version. Try updating the app or restarting your device.
              </Text>
            </View>
          ) : null}

          <View style={styles.packs}>
            {CREDIT_PACKS.map((pack) => {
              const isBusy = busyPackId === pack.id;
              const disabled = !stripeReady || Boolean(busyPackId);
              const perStampCents = Math.round((pack.priceUsd / pack.credits) * 100);
              const perStampDisplay = `${perStampCents}¢ per stamp`;
              return (
                <View
                  key={pack.id}
                  style={[styles.packCard, pack.featured && styles.packCardFeatured]}
                  testID={`credits-pack-${pack.id}`}
                >
                  {pack.featured ? (
                    <View style={styles.featuredPill}>
                      <Sparkles color={colors.white} size={11} strokeWidth={2} />
                      <Text style={styles.featuredPillText}>Less than a stamp</Text>
                    </View>
                  ) : null}
                  <View style={styles.packCopy}>
                    <Text style={styles.packCredits}>
                      {pack.credits} {pack.credits === 1 ? "stamp" : "stamps"}
                    </Text>
                    <Text style={styles.packPrice}>{formatPrice(pack)}</Text>
                    <Text style={[styles.packPerStamp, pack.featured && styles.packPerStampFeatured]}>
                      {perStampDisplay}
                      {pack.featured ? " · the USPS Forever Stamp is 82¢" : null}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => onBuy(pack)}
                    disabled={disabled}
                    style={[styles.buyBtn, disabled && styles.buyBtnLocked]}
                    accessibilityRole="button"
                    accessibilityLabel={`Buy ${pack.credits} stamps for ${formatPrice(pack)}`}
                    testID={`credits-pack-${pack.id}-buy`}
                  >
                    {isBusy ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Text style={[styles.buyText, disabled && styles.buyTextLocked]}>
                        {disabled && !stripeReady ? "Soon" : "Buy"}
                      </Text>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Text style={styles.taxNote}>
            Prices shown exclude state sales tax, calculated at checkout.
          </Text>

          <Text style={styles.fineprint}>
            Payments are processed by Stripe. Mailroom charges only when you buy stamps — never recurring. Stamps don't expire.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton title="Done" onPress={onClose} />
        </View>
        </View>
      </StripeShell>
      ) : null}
    </Modal>
  );
}

function formatPrice(pack: CreditPack): string {
  return `$${pack.priceUsd}`;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.paper, flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28 },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14, lineHeight: 19, marginTop: 4 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
  body: { flex: 1, marginTop: 14 },
  bodyContent: { paddingBottom: 30 },
  packs: { gap: 12 },
  packCard: { alignItems: "center", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", padding: 14, position: "relative" },
  packCardFeatured: { borderColor: colors.postalRed, borderWidth: 1.5, paddingTop: 22 },
  featuredPill: { position: "absolute", top: -10, left: 14, backgroundColor: colors.postalRed, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4 },
  featuredPillText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase" },
  packCopy: { flex: 1 },
  packCredits: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22 },
  packPrice: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 15, marginTop: 2 },
  packPerStamp: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, marginTop: 4 },
  packPerStampFeatured: { color: colors.postalRed },
  buyBtn: { alignItems: "center", backgroundColor: colors.ink, borderRadius: 8, flexDirection: "row", gap: 6, justifyContent: "center", minWidth: 84, paddingHorizontal: 18, paddingVertical: 10 },
  buyBtnLocked: { backgroundColor: "rgba(94,100,114,0.18)" },
  buyText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 14, letterSpacing: 0.3 },
  buyTextLocked: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.5 },
  warnBanner: { backgroundColor: "rgba(217,180,110,0.18)", borderColor: "rgba(217,180,110,0.6)", borderRadius: 10, borderWidth: 1, marginBottom: 14, padding: 12 },
  warnTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
  warnBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16, marginTop: 3 },
  taxNote: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 17, marginTop: 16, textAlign: "center" },
  fineprint: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 17, marginTop: 8 },
  footer: { paddingBottom: 12, paddingTop: 8 },
});
