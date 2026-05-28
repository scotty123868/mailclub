import { Cake, MapPin } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { Friend } from "@/src/types/mail";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";

function PostcardStack({ color = "#5E6472" }: { color?: string }) {
 return (
 <Svg width={26} height={22} viewBox="0 0 26 22">
 <Path d="M 4 6 L 18 6 L 18 18 L 4 18 Z" fill="#FFF8E9" stroke={color} strokeWidth={1} />
 <Path d="M 5 7 L 11 11 L 17 7" stroke={color} strokeWidth={0.8} fill="none" />
 <Path d="M 8 4 L 22 4 L 22 16 L 20 16" fill="#FFF8E9" stroke={color} strokeWidth={1} />
 </Svg>
 );
}

export function Avatar({ initials, size = 42 }: { initials: string; size?: number }) {
 return (
 <View style={[styles.avatar, { height: size, width: size, borderRadius: size / 2 }]}>
 <Text style={[styles.initials, { fontSize: size * 0.34 }]}>{initials}</Text>
 </View>
 );
}

export function FriendRow({ friend }: { friend: Friend }) {
 const cards = friend.cardsSent + friend.cardsReceived;
 const signalColor = friend.signalTone === "red" ? colors.postalRed : friend.signalTone === "green" ? "#607A55" : colors.postalBlue;
 const isBirthday = (friend.relationshipSignal ?? "").toLowerCase().includes("birthday");
 return (
 <View style={styles.row}>
 <IdentityAvatar user={friend} size={48} />
 <View style={styles.copy}>
 <Text style={styles.name}>{friend.name}</Text>
 <View style={styles.metaRow}>
 <MapPin color={colors.mutedInk} size={11} strokeWidth={1.6} />
 <Text style={styles.meta}>{friend.city}, {friend.state}</Text>
 </View>
 </View>
 <View style={styles.cardsCol}>
 <PostcardStack color={colors.mutedInk} />
 <Text style={styles.cardCount}>{cards === 0 ? "new" : cards}</Text>
 <Text style={styles.cardLabel}>cards</Text>
 </View>
 <View style={styles.signalWrap}>
 {isBirthday && <Cake color={colors.postalRed} size={12} strokeWidth={1.6} />}
 <Text style={[styles.signal, { color: signalColor }]} numberOfLines={2}>{friend.relationshipSignal}</Text>
 </View>
 </View>
 );
}

const styles = StyleSheet.create({
 row: { alignItems: "center", flexDirection: "row", gap: 10, paddingVertical: 12 },
 avatar: { alignItems: "center", backgroundColor: colors.paperDark, borderColor: colors.white, borderWidth: 2, justifyContent: "center" },
 initials: { color: colors.ink, fontFamily: fonts.serifBold },
 copy: { flex: 1.1 },
 name: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 20 },
 metaRow: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 2 },
 meta: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 13 },
 cardsCol: { alignItems: "center", flexDirection: "row", gap: 6, paddingHorizontal: 4 },
 cardCount: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16 },
 cardLabel: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 11 },
 signalWrap: { alignItems: "flex-end", flex: 0.65, flexDirection: "row", gap: 4, justifyContent: "flex-end" },
 signal: { fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 16, textAlign: "right" },
});
