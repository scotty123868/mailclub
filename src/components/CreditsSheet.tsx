import { Check, Sparkles, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { CREDIT_PACKS, CATEGORY_LABELS, CARD_COSTS } from "@/src/data/credits";
import { getIap, productIdForPack } from "@/src/services/iap";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function CreditsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { credits, purchaseCredits } = useMailClub();
  const [pending, setPending] = useState<string | null>(null);
  const [purchased, setPurchased] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    getIap().connect().catch(() => undefined);
  }, [visible]);

  async function buy(packId: string) {
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    const iap = getIap();
    setPending(packId);
    Alert.alert(
      iap.isDemo ? "Apple IAP not connected" : "Confirm purchase",
      iap.isDemo
        ? `v0.3 grants ${pack.credits} demo credits locally. Real StoreKit IAP ships next release.`
        : `Confirm purchase of ${pack.credits} credits.`,
      [
        {
          text: iap.isDemo ? "Grant demo credits" : "Buy",
          onPress: async () => {
            const productId = productIdForPack(pack);
            const purchase = await iap.purchase(productId);
            if (!purchase.ok) {
              setPending(null);
              return;
            }
            const result = await purchaseCredits(packId);
            setPending(null);
            if (result.ok) {
              setPurchased(packId);
              setTimeout(() => setPurchased(null), 1800);
            }
          },
        },
        { text: "Cancel", style: "cancel", onPress: () => setPending(null) },
      ]
    );
  }

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
          <View style={styles.packs}>
            {CREDIT_PACKS.map((pack) => {
              const isPending = pending === pack.id;
              const isPurchased = purchased === pack.id;
              return (
                <View key={pack.id} style={styles.packCard}>
                  <View style={styles.packCopy}>
                    <Text style={styles.packCredits}>{pack.credits} credits</Text>
                    <Text style={styles.packPrice}>${pack.priceUsd}</Text>
                  </View>
                  <Pressable
                    onPress={() => buy(pack.id)}
                    disabled={isPending || isPurchased}
                    style={[styles.buyBtn, isPurchased && styles.buyBtnDone]}
                    testID={`credits-buy-${pack.id}`}
                    accessibilityRole="button"
                  >
                    {isPurchased ? (
                      <>
                        <Check color={colors.white} size={16} strokeWidth={2} />
                        <Text style={styles.buyText}>Added</Text>
                      </>
                    ) : (
                      <Text style={styles.buyText}>{isPending ? "..." : "Buy"}</Text>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={styles.explainer}>
            <View style={styles.explainerHeader}>
              <Sparkles color={colors.postalRed} size={18} strokeWidth={1.6} />
              <Text style={styles.explainerTitle}>What can I send?</Text>
            </View>
            <ExplainerRow label={CATEGORY_LABELS.handwritten} cost={CARD_COSTS.handwritten} blurb="Your words, printed in handwriting." />
            <ExplainerRow label={CATEGORY_LABELS.photo} cost={CARD_COSTS.photo} blurb="A photo + a short note, mailed." />
            <ExplainerRow label={CATEGORY_LABELS.place} cost={CARD_COSTS.place} blurb='"Greetings from Florida" style.' />
            <ExplainerRow label={CATEGORY_LABELS.custom} cost={CARD_COSTS.custom} blurb="A designer + AI make it for you." />
          </View>

          <Text style={styles.fineprint}>
            New users get {5} free credits to start. In v0.3, purchases grant demo credits — real Apple IAP is wired in the next release.
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
  buyBtnDone: { backgroundColor: "#607A55" },
  buyText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 14, letterSpacing: 0.3 },
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
