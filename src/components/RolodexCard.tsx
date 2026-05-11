import { Cake, ChevronRight, MapPin } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IllustratedAvatar, AvatarLook } from "@/src/components/Avatar";
import { Stamp } from "@/src/components/Stamp";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { Friend } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

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
  const isBirthday = (friend.relationshipSignal ?? "").toLowerCase().includes("birthday");
  const cards = friend.cardsSent + friend.cardsReceived;
  // Subtle visual stack: cards after the first are slightly offset
  const offsetStyle = index === 0 ? null : { marginTop: -8 };

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, offsetStyle]}
      testID={`rolodex-card-${friend.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${friend.name}, ${friend.city}. Tap for details.`}
    >
      <View style={styles.postmark}>
        <CircularPostmark size={52} topText={friend.city.toUpperCase()} bottomText={friend.state.toUpperCase()} centerYear="" />
      </View>
      <View style={styles.stamp}>
        <Stamp motif={index % 2 === 0 ? "dove" : "botanical"} tone={index % 2 === 0 ? "red" : "sage"} cents={`${cards || 1}¢`} rotate={-6} size="sm" />
      </View>

      <View style={styles.body}>
        <IllustratedAvatar look={friend.id as AvatarLook} size={56} />
        <View style={styles.copy}>
          <Text style={styles.name}>{friend.name}</Text>
          <View style={styles.metaRow}>
            <MapPin color={colors.mutedInk} size={12} strokeWidth={1.6} />
            <Text style={styles.meta}>{friend.city}, {friend.state}</Text>
          </View>
          <View style={styles.stats}>
            <Text style={styles.statText}><Text style={styles.statNum}>{friend.cardsSent}</Text> sent</Text>
            <Text style={styles.statDivider}>·</Text>
            <Text style={styles.statText}><Text style={styles.statNum}>{friend.cardsReceived}</Text> received</Text>
          </View>
        </View>
        <ChevronRight color={colors.ink} size={20} strokeWidth={1.5} />
      </View>

      {friend.relationshipSignal ? (
        <View style={styles.signalRow}>
          {isBirthday && <Cake color={colors.postalRed} size={12} strokeWidth={1.6} />}
          <Text style={[styles.signal, { color: signalColor }]}>{friend.relationshipSignal}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, marginBottom: 8, padding: 14, position: "relative", shadowColor: colors.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3 },
  postmark: { opacity: 0.45, position: "absolute", right: 12, top: 12 },
  stamp: { position: "absolute", right: 70, top: 8 },
  body: { alignItems: "center", flexDirection: "row", gap: 14 },
  copy: { flex: 1 },
  name: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 24 },
  metaRow: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 2 },
  meta: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 13 },
  stats: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 6 },
  statText: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 11, letterSpacing: 0.3 },
  statNum: { color: colors.ink, fontFamily: fonts.sansBold },
  statDivider: { color: colors.mutedInk },
  signalRow: { alignItems: "center", borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 4, marginTop: 10, paddingTop: 8 },
  signal: { fontFamily: fonts.serifItalic, fontSize: 13 },
});
