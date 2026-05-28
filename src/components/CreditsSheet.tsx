import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Check, Mail, Sparkles } from "lucide-react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { SheetHeader } from "@/src/components/system/SheetHeader";
import { CREDIT_PACKS, type CreditPack } from "@/src/data/credits";
import { isStripeConfigured, loadStripeSdk, purchasePack, stripeLoadError } from "@/src/services/payments";
import { fetchProfile } from "@/src/services/api";
import { StripeShell } from "@/src/services/StripeShell";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Stamps store. Purchases route through Stripe Payment Sheet (Apple Pay +
 * card). NOT Apple IAP. see src/services/payments.ts for why physical-goods
 * carve-out (Guideline 3.1.5(a)) applies here.
 *
 * Flow:
 * - User taps a pack → purchasePack(pack) opens Payment Sheet
 * - On success, we refetch the profile so balance updates
 * - Stripe webhook fires server-side as authoritative source-of-truth
 *
 * Vocabulary: internally we call the unit `credits` (database column,
 * variable names, test fixtures). but every user-facing string says
 * "stamp" because that's what one credit literally is: enough to mail
 * one printed-and-addressed postcard.
 */
export function CreditsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
 const { credits, refreshProfile } = useMailClub();
 const router = useRouter();
 const [busyPackId, setBusyPackId] = useState<string | null>(null);
 // v0.7.0.49 (Codex P2 #10): inline purchase confirmation state. Was
 // closing the sheet then popping a native Alert. jarring against the
 // cream paper aesthetic. Now shows result inline above the pack list
 // with a "Mail something" CTA that closes the sheet AND deep-links
 // into Send. User stays in the product flow.
 const [purchaseResult, setPurchaseResult] = useState<
 | { status: "credited" | "pending"; credits: number }
 | null
 >(null);

 // Clear stale purchase result when the sheet re-opens so a second
 // visit doesn't see the previous purchase's success state.
 if (!visible && purchaseResult) {
 // setState during render: React batches and re-renders. Acceptable
 // here because the alternative (useEffect on visible) introduces a
 // frame of stale UI on close-then-reopen.
 setPurchaseResult(null);
 }
 // Distinguish "publishable key not set" (dev-config issue) from "native
 // SDK failed to load on this device" (e.g. iOS 26 sim, version skew).
 // CRITICAL: only probe the SDK when the sheet is actually visible. RN's
 // Modal keeps children mounted even when invisible, so an unconditional
 // loadStripeSdk() here fires the synchronous `require()` on every parent
 // render. and on devices where the native module isn't linked, that
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
 try {
 await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
 } catch {
 // simulator without haptic engine. non-fatal
 }
 // v0.7.0.49: don't show "you're in!" until the stripe-webhook
 // has actually credited the user. Before this, the alert fired
 // right after Stripe Sheet dismissed. but webhook delivery is
 // a separate async path that can take seconds. User saw "5
 // stamps added" while their balance still showed the old count.
 // Now we poll fetchProfile (via refreshProfile) for the credit
 // delta. Up to 6 attempts, 1.5s apart = ~9s ceiling. covers
 // typical webhook latency. On timeout, show "pending" copy so
 // the user knows to check back, not that nothing happened.
 const expectedDelta = pack.credits;
 const startCredits = credits;
 let credited = false;
 for (let i = 0; i < 6; i++) {
 await refreshProfile();
 // The credit balance lives in MailClubContext; refreshProfile
 // updates it in state. We rely on the closure value for the
 // check. read the latest by re-importing after each poll.
 // (refreshProfile returns void; we trust the side effect.)
 const fresh = await fetchProfile().catch(() => null);
 const latest = fresh?.credits ?? startCredits;
 if (latest >= startCredits + expectedDelta) {
 credited = true;
 break;
 }
 if (i < 5) await new Promise((r) => setTimeout(r, 1500));
 }
 // v0.7.0.49 (Codex P2 #10): inline confirmation. Was native Alert
 // + onClose; now state-driven success surface above the pack list.
 setPurchaseResult({
 status: credited ? "credited" : "pending",
 credits: result.creditsAdded,
 });
 } else if (result.reason === "cancelled") {
 // No alert on cancel. user knows what they did.
 } else {
 // v0.6.1: distinguish failure modes so the user knows what to do
 // next instead of seeing a generic "Couldn't complete" alert.
 const title =
 result.reason === "config"
 ? "Purchases aren't ready yet"
 : result.reason === "unavailable"
 ? "Payments are unavailable on this device"
 : result.reason === "network"
 ? "Couldn't reach the payment server"
 : result.reason === "declined"
 ? "Card was declined"
 : "Couldn't complete the purchase";
 const body =
 result.message ??
 (result.reason === "config"
 ? "Stripe isn't configured for this build. We're on it."
 : result.reason === "unavailable"
 ? "Try restarting the app, or update to the latest version."
 : result.reason === "network"
 ? "Check your connection and try again."
 : "Try again or use a different card.");
 Alert.alert(title, body);
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
 <SheetHeader
 title="Buy cards"
 subtitle={`${credits} ${credits === 1 ? "card" : "cards"} in your pocket. Each one mails a real postcard, anywhere in the US.`}
 onClose={onClose}
 closeAccessibilityLabel="Close cards sheet"
 closeTestID="credits-sheet-close"
 />

 <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
 {/* v0.7.0.49: inline purchase confirmation. Renders above the
 pack list after a successful Stripe checkout. */}
 {purchaseResult ? (
 <View
 style={[
 styles.resultCard,
 purchaseResult.status === "credited"
 ? styles.resultCardCredited
 : styles.resultCardPending,
 ]}
 testID="credits-result-card"
 >
 <View style={styles.resultIconCircle}>
 <Check color={colors.white} size={20} strokeWidth={2.2} />
 </View>
 <Text style={styles.resultTitle}>
 {purchaseResult.status === "credited"
 ? `${purchaseResult.credits} ${purchaseResult.credits === 1 ? "card" : "cards"} added.`
 : "Payment received."}
 </Text>
 <Text style={styles.resultBody}>
 {purchaseResult.status === "credited"
 ? `Your balance is ${credits} ${credits === 1 ? "card" : "cards"}. Mail something.`
 : `Your ${purchaseResult.credits} ${purchaseResult.credits === 1 ? "card" : "cards"} should appear shortly. Check back in a moment.`}
 </Text>
 <View style={styles.resultActions}>
 <Pressable
 onPress={() => {
 onClose();
 // Deep-link straight into Send so the user goes from
 // "bought" → "writing" without thinking. Falls back
 // gracefully if Send isn't mounted yet.
 setTimeout(() => router.push("/(tabs)/send"), 50);
 }}
 style={({ pressed }) => [styles.resultPrimary, pressed && styles.resultPrimaryPressed]}
 accessibilityRole="button"
 accessibilityLabel="Mail something now"
 testID="credits-result-mail-cta"
 >
 <Mail color={colors.white} size={15} strokeWidth={1.8} />
 <Text style={styles.resultPrimaryText}>Mail something</Text>
 </Pressable>
 <Pressable
 onPress={() => setPurchaseResult(null)}
 style={styles.resultSecondary}
 accessibilityRole="button"
 accessibilityLabel="Buy more cards"
 >
 <Text style={styles.resultSecondaryText}>Buy more</Text>
 </Pressable>
 </View>
 </View>
 ) : null}
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
 The Stripe payment library couldn't load. Try updating the app or restarting your device.
 {stripeLoadError() ? `\n\nDetails: ${stripeLoadError()}` : null}
 </Text>
 </View>
 ) : null}

 <View style={styles.packs}>
 {CREDIT_PACKS.map((pack) => {
 const isBusy = busyPackId === pack.id;
 const disabled = !stripeReady || Boolean(busyPackId);
 // Render as dollars when >= $1, cents otherwise. New pricing
 // ($1.25, $1.00, $0.83 per card) means the entry pack reads
 // in dollars. No more USPS stamp comparison. Mailroom is a
 // premium club, not the cheapest stamp.
 const perCardCents = Math.round((pack.priceUsd / pack.credits) * 100);
 const perCardDisplay =
 perCardCents >= 100
 ? (perCardCents % 100 === 0
 ? `$${perCardCents / 100} per card`
 : `$${(perCardCents / 100).toFixed(2)} per card`)
 : `${perCardCents}¢ per card`;
 return (
 <View
 key={pack.id}
 style={[styles.packCard, pack.featured && styles.packCardFeatured]}
 testID={`credits-pack-${pack.id}`}
 >
 {pack.featured ? (
 <View style={styles.featuredPill}>
 <Sparkles color={colors.white} size={11} strokeWidth={2} />
 <Text style={styles.featuredPillText}>For the regulars</Text>
 </View>
 ) : null}
 <View style={styles.packCopy}>
 <Text style={styles.packCredits}>
 {pack.credits} {pack.credits === 1 ? "card" : "cards"}
 </Text>
 <Text style={styles.packPrice}>{formatPrice(pack)}</Text>
 <Text style={[styles.packPerStamp, pack.featured && styles.packPerStampFeatured]}>
 {perCardDisplay}
 </Text>
 </View>
 <Pressable
 onPress={() => onBuy(pack)}
 disabled={disabled}
 style={[styles.buyBtn, disabled && styles.buyBtnLocked]}
 accessibilityRole="button"
 accessibilityLabel={`Buy ${pack.credits} cards for ${formatPrice(pack)}`}
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
 Payments are processed by Stripe. Mailroom only charges when you buy a pack. never recurring. Cards never expire.
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
 // v0.7.0.49: header/title/subtitle/closeBtn extracted to SheetHeader.
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
 // v0.7.0.49: inline purchase result card. Replaces native Alert that
 // closed the sheet then popped over whatever screen the user came from.
 resultCard: {
 borderRadius: 12,
 borderWidth: 1,
 marginBottom: 14,
 padding: 16,
 },
 resultCardCredited: {
 backgroundColor: "rgba(155,175,155,0.18)",
 borderColor: "rgba(155,175,155,0.45)",
 },
 resultCardPending: {
 backgroundColor: "rgba(217,180,110,0.18)",
 borderColor: "rgba(217,180,110,0.5)",
 },
 resultIconCircle: {
 alignItems: "center",
 backgroundColor: colors.ink,
 borderRadius: 18,
 height: 36,
 justifyContent: "center",
 marginBottom: 10,
 width: 36,
 },
 resultTitle: {
 color: colors.ink,
 fontFamily: fonts.serifSemi,
 fontSize: 18,
 },
 resultBody: {
 color: colors.mutedInk,
 fontFamily: fonts.serifItalic,
 fontSize: 13,
 lineHeight: 18,
 marginTop: 4,
 },
 resultActions: {
 flexDirection: "row",
 gap: 10,
 marginTop: 14,
 },
 resultPrimary: {
 alignItems: "center",
 backgroundColor: colors.ink,
 borderRadius: 10,
 flexDirection: "row",
 gap: 8,
 paddingHorizontal: 16,
 paddingVertical: 10,
 },
 resultPrimaryPressed: {
 opacity: 0.85,
 },
 resultPrimaryText: {
 color: colors.white,
 fontFamily: fonts.serifSemi,
 fontSize: 14,
 },
 resultSecondary: {
 alignItems: "center",
 borderColor: colors.line,
 borderRadius: 10,
 borderWidth: 1,
 justifyContent: "center",
 paddingHorizontal: 16,
 paddingVertical: 10,
 },
 resultSecondaryText: {
 color: colors.ink,
 fontFamily: fonts.serifSemi,
 fontSize: 14,
 },
});
