import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { Friend } from "@/src/types/mail";

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
  return (
    <View style={styles.row}>
      <Avatar initials={friend.avatarInitials} />
      <View style={styles.copy}>
        <Text style={styles.name}>{friend.name}</Text>
        <Text style={styles.meta}>{friend.city}, {friend.state}</Text>
      </View>
      <Text style={styles.cards}>{cards === 0 ? "new" : `${cards}\ncards`}</Text>
      <View style={styles.signalWrap}>
        <Text style={[styles.signal, { color: signalColor }]} numberOfLines={2}>{friend.relationshipSignal}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 10, paddingVertical: 12 },
  avatar: { alignItems: "center", backgroundColor: colors.paperDark, borderColor: colors.white, borderWidth: 2, justifyContent: "center" },
  initials: { color: colors.ink, fontFamily: fonts.serif, fontWeight: "700" },
  copy: { flex: 1 },
  name: { color: colors.ink, fontFamily: fonts.serif, fontSize: 19 },
  meta: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 13 },
  cards: { color: colors.postalRed, fontFamily: fonts.sans, fontSize: 13, fontWeight: "700" },
  signalWrap: { alignItems: "flex-end", flex: 0.52 },
  signal: { fontFamily: fonts.serif, fontSize: 13, lineHeight: 17, textAlign: "right" },
});
