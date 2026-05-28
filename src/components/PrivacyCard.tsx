import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChevronRight, ShieldCheck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";
import { CircularPostmark } from "./PostmarkDecoration";
import { Stamp } from "./Stamp";

/**
 * v0.7.0.49: PrivacyCard now collapses after first acknowledgment.
 *
 * Before: rendered at full size on every visit to the friends tab.
 * Audit flagged it as the largest visual on returning-user screens
 * even after the user had read it 50 times. Now: first visit shows
 * the full card with an "OK, got it" button; subsequent visits show
 * a one-line "Privacy" link that expands back to the full card if
 * the user wants a refresher.
 *
 * Acknowledgment persists in AsyncStorage so it survives reloads.
 */
const ACK_KEY = "mailroom:privacy-card-acknowledged-v1";

export function PrivacyCard() {
 const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
 const [expanded, setExpanded] = useState(false);

 useEffect(() => {
 AsyncStorage.getItem(ACK_KEY)
 .then((v) => setAcknowledged(v === "true"))
 .catch(() => setAcknowledged(false));
 }, []);

 // First render before AsyncStorage resolves: render nothing to avoid
 // flicker between the collapsed and expanded states.
 if (acknowledged === null) return null;

 // Collapsed state. small "Privacy" pill that taps to expand.
 if (acknowledged && !expanded) {
 return (
 <Pressable
 onPress={() => setExpanded(true)}
 style={({ pressed }) => [collapsedStyles.pill, pressed && collapsedStyles.pillPressed]}
 accessibilityRole="button"
 accessibilityLabel="Show privacy details"
 testID="privacy-card-collapsed"
 >
 <ShieldCheck color={colors.mutedInk} size={14} strokeWidth={1.6} />
 <Text style={collapsedStyles.text}>Privacy</Text>
 <ChevronRight color={colors.mutedInk} size={14} strokeWidth={1.6} />
 </Pressable>
 );
 }

 const onAcknowledge = () => {
 AsyncStorage.setItem(ACK_KEY, "true").catch(() => undefined);
 setAcknowledged(true);
 setExpanded(false);
 };

 return (
 <PostalCard style={styles.card}>
 <View style={styles.icon}><ShieldCheck color={colors.ink} size={26} strokeWidth={1.4} /></View>
 <View style={styles.copy}>
 <Text style={styles.title}>Addresses stay private.</Text>
 <Text style={styles.body}>Friends can send mail without seeing your full address.</Text>
 {/* OK button only shows on first view (not when the user has
 tapped "Privacy" to re-expand) so we don't keep nagging them. */}
 {!acknowledged ? (
 <Pressable
 onPress={onAcknowledge}
 style={({ pressed }) => [styles.okBtn, pressed && styles.okBtnPressed]}
 accessibilityRole="button"
 accessibilityLabel="Acknowledge privacy"
 testID="privacy-card-ack"
 >
 <Text style={styles.okBtnText}>OK, got it</Text>
 </Pressable>
 ) : null}
 </View>
 <View style={styles.postmark}>
 <CircularPostmark size={68} topText="PRIVATE" bottomText="BY DESIGN" centerYear="" />
 </View>
 <View style={styles.stamp}>
 <Stamp motif="botanical" tone="sage" cents="15¢" rotate={5} size="sm" />
 </View>
 </PostalCard>
 );
}

const STAMP_GUTTER = 72;

const styles = StyleSheet.create({
 card: { alignItems: "center", flexDirection: "row", gap: 14, paddingHorizontal: 18, paddingVertical: 18 },
 icon: { alignItems: "center", backgroundColor: colors.paperDark, borderRadius: 28, height: 50, justifyContent: "center", width: 50 },
 copy: { flex: 1, paddingRight: STAMP_GUTTER },
 title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 18 },
 body: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 14, lineHeight: 19, marginTop: 3 },
 postmark: { opacity: 0.45, position: "absolute", right: 56, top: 16 },
 stamp: { position: "absolute", right: 12, top: 12 },
 okBtn: {
 alignSelf: "flex-start",
 backgroundColor: colors.ink,
 borderRadius: 8,
 marginTop: 10,
 paddingHorizontal: 14,
 paddingVertical: 8,
 },
 okBtnPressed: { opacity: 0.85 },
 okBtnText: { color: colors.paper, fontFamily: fonts.serifSemi, fontSize: 13 },
});

const collapsedStyles = StyleSheet.create({
 pill: {
 alignItems: "center",
 alignSelf: "flex-start",
 backgroundColor: "rgba(155,175,155,0.10)",
 borderColor: "rgba(155,175,155,0.30)",
 borderRadius: 999,
 borderWidth: 1,
 flexDirection: "row",
 gap: 6,
 paddingHorizontal: 12,
 paddingVertical: 7,
 },
 pillPressed: { opacity: 0.7 },
 text: { color: colors.mutedInk, fontFamily: fonts.serifSemi, fontSize: 12 },
});
