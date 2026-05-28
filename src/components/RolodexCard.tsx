import { Cake, ChevronRight, MapPin } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { Friend } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Friend row in the rolodex deck. Calm and scannable. no stamp+postmark
 * decorative collision. Signal pill, when present, sits to the right of the
 * stats line so the card stays at a single tidy height.
 */
export function RolodexCard({
 friend,
 onPress,
 index = 0,
}: {
 friend: Friend;
 onPress: () => void;
 index?: number;
}) {
 const signalColor = friend.signalTone === "red" ? colors.postalRed : friend.signalTone === "green" ? "#607A55" : colors.postalBlue;
 const signalBg = friend.signalTone === "red" ? "rgba(184,74,58,0.08)" : friend.signalTone === "green" ? "rgba(96,122,85,0.1)" : "rgba(60,110,143,0.08)";
 const isBirthday = (friend.relationshipSignal ?? "").toLowerCase().includes("birthday");
 const offsetStyle = index === 0 ? null : { marginTop: -6 };

 return (
 <Pressable
 onPress={onPress}
 style={[styles.card, offsetStyle]}
 testID={`rolodex-card-${friend.id}`}
 accessibilityRole="button"
 accessibilityLabel={`${friend.name}, ${friend.city}. Tap for details.`}
 >
 <View style={styles.body}>
 <IdentityAvatar user={friend} size={52} />
 <View style={styles.copy}>
 <View style={styles.nameRow}>
 <Text style={styles.name} numberOfLines={1}>{friend.name}</Text>
 {friend.relationshipSignal ? (
 <View style={[styles.signalPill, { backgroundColor: signalBg }]}>
 {isBirthday && <Cake color={signalColor} size={11} strokeWidth={1.7} />}
 <Text style={[styles.signalText, { color: signalColor }]} numberOfLines={1}>{friend.relationshipSignal}</Text>
 </View>
 ) : null}
 </View>
 <View style={styles.metaRow}>
 <MapPin color={colors.mutedInk} size={12} strokeWidth={1.6} />
 <Text style={styles.meta} numberOfLines={1}>{friend.city}{friend.state ? `, ${friend.state}` : ""}</Text>
 <Text style={styles.statDivider}> · </Text>
 <Text style={styles.statText}><Text style={styles.statNum}>{friend.cardsSent}</Text> sent · <Text style={styles.statNum}>{friend.cardsReceived}</Text> received</Text>
 </View>
 </View>
 <ChevronRight color={colors.mutedInk} size={18} strokeWidth={1.5} />
 </View>
 </Pressable>
 );
}

const styles = StyleSheet.create({
 card: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 10, borderWidth: 1, marginBottom: 8, padding: 14, position: "relative", shadowColor: colors.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
 body: { alignItems: "center", flexDirection: "row", gap: 14 },
 copy: { flex: 1 },
 nameRow: { alignItems: "center", flexDirection: "row", gap: 8 },
 name: { color: colors.ink, flexShrink: 1, fontFamily: fonts.serifSemi, fontSize: 22 },
 metaRow: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 4 },
 meta: { color: colors.mutedInk, flexShrink: 0, fontFamily: fonts.serif, fontSize: 13 },
 statText: { color: colors.mutedInk, flexShrink: 1, fontFamily: fonts.sans, fontSize: 11, letterSpacing: 0.2 },
 statNum: { color: colors.ink, fontFamily: fonts.sansBold },
 statDivider: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 11 },
 signalPill: { alignItems: "center", borderRadius: 10, flexDirection: "row", gap: 4, paddingHorizontal: 8, paddingVertical: 3 },
 signalText: { fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.3 },
});
