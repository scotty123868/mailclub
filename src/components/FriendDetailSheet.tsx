import { Mail, Trash2 } from "lucide-react-native";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { PrimaryButton } from "@/src/components/Buttons";
import { SheetCloseButton } from "@/src/components/system/SheetCloseButton";
import { useMailClub } from "@/src/state/MailClubContext";
import { Friend, Postcard } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function FriendDetailSheet({
 friend,
 visible,
 onClose,
 onSend,
 onTapPostcard,
}: {
 friend: Friend | null;
 visible: boolean;
 onClose: () => void;
 onSend: (friendId: string) => void;
 /**
 * v1.0.1: emit the postcard id when a "recent sends" row is tapped.
 * Parent should close this sheet then open the PostcardDetailSheet
 * (photo + message + status). Before this prop, tapping a row in
 * the friend detail did nothing at all.
 */
 onTapPostcard?: (postcardId: string) => void;
}) {
 const { postcards, removeFriend } = useMailClub();
 if (!friend) return null;
 const recentSends = postcards.filter((p) => p.toFriendId === friend.id).slice(0, 3);
 const totalCards = friend.cardsSent + friend.cardsReceived;

 function confirmRemove() {
 Alert.alert(
 `Remove ${friend!.name}?`,
 "This removes them from your rolodex. Their address is wiped from this device.",
 [
 { text: "Cancel", style: "cancel" },
 {
 text: "Remove",
 style: "destructive",
 onPress: async () => {
 await removeFriend(friend!.id);
 onClose();
 },
 },
 ]
 );
 }

 return (
 <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
 <View style={styles.root}>
 <View style={styles.header}>
 <SheetCloseButton
 onPress={onClose}
 accessibilityLabel={`Close ${friend.name} details`}
 testID="friend-detail-close"
 />
 </View>

 <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
 <View style={styles.identity}>
 <IdentityAvatar user={friend} size={92} variant="hero" />
 <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{friend.name}</Text>
 <Text style={styles.city}>{friend.city}{friend.state ? `, ${friend.state}` : ""}</Text>
 {friend.relationshipSignal ? (
 <View style={styles.signalBadge}>
 <Text style={styles.signalText}>{friend.relationshipSignal.toUpperCase()}</Text>
 </View>
 ) : null}
 </View>

 <View style={styles.statRow}>
 <StatCell value={friend.cardsSent} label="Sent" />
 <StatCell value={friend.cardsReceived} label="Received" />
 <StatCell value={totalCards} label="Total" tone="red" />
 </View>

 <View style={styles.section}>
 <Text style={styles.sectionTitle}>Recent sends</Text>
 {recentSends.length === 0 ? (
 <Text style={styles.empty}>No cards yet. Send your first one.</Text>
 ) : (
 recentSends.map((card) => (
 <PostcardRow
 key={card.id}
 card={card}
 onPress={onTapPostcard ? () => onTapPostcard(card.id) : undefined}
 />
 ))
 )}
 </View>

 <PrimaryButton
 title="Send a postcard"
 icon={Mail}
 onPress={() => onSend(friend.id)}
 />

 <Pressable onPress={confirmRemove} style={styles.removeBtn} testID="friend-remove-btn" accessibilityRole="button">
 <Trash2 color={colors.postalRed} size={16} strokeWidth={1.6} />
 <Text style={styles.removeBtnText}>Remove from rolodex</Text>
 </Pressable>
 </ScrollView>
 </View>
 </Modal>
 );
}

function StatCell({ value, label, tone }: { value: number; label: string; tone?: "red" }) {
 return (
 <View style={statStyles.cell}>
 <Text style={[statStyles.value, tone === "red" && statStyles.valueRed]}>{value}</Text>
 <Text style={statStyles.label}>{label}</Text>
 </View>
 );
}

function PostcardRow({ card, onPress }: { card: Postcard; onPress?: () => void }) {
 // v0.7.0.55: rolodex rows used to be "PHOTO. 1c". the category enum
 // and credit cost are internal accounting, not what the user wants to see
 // about a card they sent to a friend. Now: photo thumbnail + handwritten-
 // message preview + relative date. If no photo, render a small paper-color
 // placeholder square so the row layout stays consistent.
 //
 // v1.0.1: wrap in Pressable so taps open the PostcardDetailSheet via the
 // parent's onTapPostcard callback. Before this, tapping a row was a
 // no-op. the user reported "clicking the postcard doesn't do anything"
 // on the friend detail page. Fallback to a plain View when no onPress
 // is provided (defensive, but parents now always pass it).
 const photoSrc = card.photoUri || undefined;
 const dateLabel = formatRelativeSentAt(card.sentAt);
 const body = (
 <>
 {photoSrc ? (
 <Image source={{ uri: photoSrc }} style={postcardStyles.thumb} resizeMode="cover" />
 ) : (
 <View style={[postcardStyles.thumb, postcardStyles.thumbEmpty]} />
 )}
 <View style={postcardStyles.body}>
 <Text style={postcardStyles.message} numberOfLines={2}>
 {card.message?.trim() || "No note"}
 </Text>
 <Text style={postcardStyles.date}>{dateLabel}</Text>
 </View>
 </>
 );
 if (!onPress) {
 return <View style={postcardStyles.row}>{body}</View>;
 }
 return (
 <Pressable
 onPress={onPress}
 style={({ pressed }) => [postcardStyles.row, pressed && { opacity: 0.6 }]}
 accessibilityRole="button"
 accessibilityLabel={`Open postcard sent ${dateLabel || "recently"}`}
 testID={`friend-detail-postcard-row-${card.id}`}
 >
 {body}
 </Pressable>
 );
}

function formatRelativeSentAt(iso: string): string {
 try {
 const sent = new Date(iso).getTime();
 if (Number.isNaN(sent)) return "";
 const diffMs = Date.now() - sent;
 const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
 if (diffDays === 0) return "Sent today";
 if (diffDays === 1) return "Yesterday";
 if (diffDays < 7) return `${diffDays} days ago`;
 if (diffDays < 30) {
 const wks = Math.floor(diffDays / 7);
 return wks === 1 ? "1 week ago" : `${wks} weeks ago`;
 }
 if (diffDays < 365) {
 const mos = Math.floor(diffDays / 30);
 return mos === 1 ? "1 month ago" : `${mos} months ago`;
 }
 const yrs = Math.floor(diffDays / 365);
 return yrs === 1 ? "1 year ago" : `${yrs} years ago`;
 } catch {
 return "";
 }
}

const styles = StyleSheet.create({
 root: { backgroundColor: colors.paper, flex: 1 },
 // v0.7.0.49: closeBtn extracted to SheetCloseButton. Header is just the close-button row.
 header: { alignItems: "flex-end", paddingHorizontal: 16, paddingTop: 12 },
 scroll: { flex: 1 },
 scrollContent: { gap: 18, paddingBottom: 40, paddingHorizontal: 20 },
 identity: { alignItems: "center", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 10, borderWidth: 1, gap: 6, overflow: "hidden", padding: 24 },
 name: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 32, marginTop: 8 },
 city: { color: colors.postalBlue, fontFamily: fonts.serif, fontSize: 16, marginTop: 0 },
 signalBadge: { backgroundColor: "rgba(184,74,58,0.1)", borderRadius: 4, marginTop: 8, paddingHorizontal: 10, paddingVertical: 4 },
 signalText: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.7 },
 statRow: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", padding: 14 },
 section: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, padding: 14 },
 sectionTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17, marginBottom: 8 },
 empty: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13 },
 removeBtn: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "center", paddingVertical: 10 },
 removeBtnText: { color: colors.postalRed, fontFamily: fonts.serifSemi, fontSize: 14 },
});

const statStyles = StyleSheet.create({
 cell: { alignItems: "center", flex: 1 },
 value: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28 },
 valueRed: { color: colors.postalRed },
 label: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 11, letterSpacing: 0.5, marginTop: 2 },
});

const postcardStyles = StyleSheet.create({
 row: {
 alignItems: "center",
 borderBottomColor: colors.line,
 borderBottomWidth: StyleSheet.hairlineWidth,
 flexDirection: "row",
 gap: 12,
 paddingVertical: 10,
 },
 thumb: {
 width: 56,
 height: 56,
 borderRadius: 4,
 backgroundColor: colors.paper,
 },
 thumbEmpty: {
 borderColor: colors.line,
 borderWidth: StyleSheet.hairlineWidth,
 },
 body: {
 flex: 1,
 gap: 4,
 },
 message: {
 color: colors.ink,
 fontFamily: fonts.serif,
 fontSize: 14,
 lineHeight: 19,
 },
 date: {
 color: colors.mutedInk,
 fontFamily: fonts.sansBold,
 fontSize: 10,
 letterSpacing: 0.5,
 textTransform: "uppercase",
 },
});
