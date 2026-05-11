import { Clock, Sparkles, X } from "lucide-react-native";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { CARD_COSTS, CATEGORY_BLURBS, CATEGORY_LABELS, CREDIT_PACKS } from "@/src/data/credits";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Credits store preview. The Buy flow is intentionally GATED OFF until real
 * StoreKit IAP is wired (App Store Connect product setup + react-native-iap
 * integration). Selling consumable in-app currency without StoreKit violates
 * Apple Guideline 3.1.1, so the packs are visible but read-only here.
 *
 * To enable real purchases later: replace the "Coming soon" CTA with an
 * `await getIap().purchase(productIdForPack(pack))` flow after wiring
 * react-native-iap in src/services/iap.ts.
 */
export function CreditsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { credits } = useMailClub();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Buy credits</Text>
            <Text style={styles.subtitle}>1 credit = $1. You have {credits} {credits === 1 ? "credit" : "credits"} right now.</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close credits sheet" testID="credits-sheet-close">
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <View style={styles.comingSoonBanner} testID="credits-coming-soon">
            <Clock color={colors.postalRed} size={18} strokeWidth={1.6} />
            <View style={{ flex: 1 }}>
              <Text style={styles.comingSoonTitle}>Credit store opens soon.</Text>
              <Text style={styles.comingSoonBody}>
                We're finishing the payment integration. The packs below show what's coming. For now, your 5 starting credits are on us.
              </Text>
            </View>
          </View>

          <View style={styles.packs}>
            {CREDIT_PACKS.map((pack) => (
              <View key={pack.id} style={styles.packCard} testID={`credits-pack-${pack.id}`}>
                <View style={styles.packCopy}>
                  <Text style={styles.packCredits}>{pack.credits} credits</Text>
                  <Text style={styles.packPrice}>Coming soon</Text>
                </View>
                <View style={[styles.buyBtn, styles.buyBtnLocked]}>
                  <Text style={styles.buyTextLocked}>Soon</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.explainer}>
            <View style={styles.explainerHeader}>
              <Sparkles color={colors.postalRed} size={18} strokeWidth={1.6} />
              <Text style={styles.explainerTitle}>What can I send?</Text>
            </View>
            <ExplainerRow label={CATEGORY_LABELS.handwritten} cost={CARD_COSTS.handwritten} blurb={CATEGORY_BLURBS.handwritten} />
            <ExplainerRow label={CATEGORY_LABELS.photo} cost={CARD_COSTS.photo} blurb={CATEGORY_BLURBS.photo} />
            <ExplainerRow label={CATEGORY_LABELS.place} cost={CARD_COSTS.place} blurb={CATEGORY_BLURBS.place} />
            <ExplainerRow label={CATEGORY_LABELS.custom} cost={CARD_COSTS.custom} blurb={CATEGORY_BLURBS.custom} />
          </View>

          <Text style={styles.fineprint}>
            New users get 5 free credits to start. The store unlocks once payment is wired — we'll email you when it opens.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton title="Done" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function ExplainerRow({ label, cost, blurb }: { label: string; cost: number; blurb: string }) {
  return (
    <View style={styles.explainerRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.explainerLabel}>{label}</Text>
        <Text style={styles.explainerBlurb}>{blurb}</Text>
      </View>
      <Text style={styles.explainerCost}>{cost} {cost === 1 ? "credit" : "credits"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.paper, flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28 },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14, marginTop: 4 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
  body: { flex: 1, marginTop: 14 },
  bodyContent: { paddingBottom: 30 },
  packs: { gap: 10 },
  packCard: { alignItems: "center", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", padding: 14 },
  packCopy: { flex: 1 },
  packCredits: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22 },
  packPrice: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 15, marginTop: 2 },
  buyBtn: { alignItems: "center", backgroundColor: colors.ink, borderRadius: 8, flexDirection: "row", gap: 6, minWidth: 84, paddingHorizontal: 18, paddingVertical: 10 },
  buyBtnLocked: { backgroundColor: "rgba(94,100,114,0.18)" },
  buyText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 14, letterSpacing: 0.3 },
  buyTextLocked: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.5 },
  comingSoonBanner: { alignItems: "flex-start", backgroundColor: "rgba(217,180,110,0.18)", borderColor: "rgba(217,180,110,0.6)", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 14, padding: 12 },
  comingSoonTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
  comingSoonBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16, marginTop: 3 },
  explainer: { backgroundColor: "rgba(60,110,143,0.05)", borderColor: colors.line, borderRadius: 8, borderWidth: 1, marginTop: 18, padding: 14 },
  explainerHeader: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 8 },
  explainerTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17 },
  explainerRow: { alignItems: "center", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", paddingVertical: 8 },
  explainerLabel: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
  explainerBlurb: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, marginTop: 2 },
  explainerCost: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 12, letterSpacing: 0.4 },
  fineprint: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 17, marginTop: 16 },
  footer: { paddingBottom: 12, paddingTop: 8 },
});
