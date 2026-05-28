import { Inbox, Mail, Send as SendIcon, Sparkles } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CATEGORY_LABELS } from "@/src/data/credits";
import { SheetHeader } from "@/src/components/system/SheetHeader";
import { useMailClub } from "@/src/state/MailClubContext";
import { Postcard } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

type Tab = "sent" | "replies";

export function MailHistorySheet({
 visible,
 onClose,
 initialTab = "sent",
 onPressRow,
}: {
 visible: boolean;
 onClose: () => void;
 initialTab?: Tab;
 /**
 * v0.7.0.25: optional tap handler for a row. When set, each Sent row
 * becomes a Pressable that fires this callback with the postcard id.
 * My Card uses this to open PostcardDetailSheet so the user can
 * re-share a claim link or retry shipping from inside the mail
 * history. (Replies are read-only. they don't have a detail surface
 * yet.) If omitted, rows render as plain Views (legacy behavior).
 */
 onPressRow?: (postcardId: string) => void;
}) {
 const { postcards, voidReplies, friends } = useMailClub();
 const [tab, setTab] = useState<Tab>(initialTab);

 // Reset to the requested tab whenever the sheet opens. Otherwise a previous
 // visit's tab state persists across re-opens.
 useEffect(() => {
 if (visible) setTab(initialTab);
 }, [visible, initialTab]);

 function friendName(id: string) {
 if (id === "void") return "Someone, somewhere";
 return friends.find((f) => f.id === id)?.name ?? "Unknown";
 }

 function fmtDate(iso: string) {
 try {
 const d = new Date(iso);
 return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
 } catch {
 return iso;
 }
 }

 const sentSorted = [...postcards].sort((a, b) => (b.sentAt > a.sentAt ? 1 : -1));
 const repliesSorted = [...voidReplies].sort((a, b) => (b.receivedAt > a.receivedAt ? 1 : -1));

 return (
 <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
 <View style={styles.root}>
 <SheetHeader
 title="Your mail"
 subtitle="Every card you've sent, and every reply from the void."
 onClose={onClose}
 closeAccessibilityLabel="Close mail history"
 closeTestID="mail-history-close"
 />

 <View style={styles.tabs}>
 <Pressable
 onPress={() => setTab("sent")}
 style={[styles.tab, tab === "sent" && styles.tabActive]}
 testID="mail-history-tab-sent"
 accessibilityRole="button"
 accessibilityState={{ selected: tab === "sent" }}
 >
 <SendIcon color={tab === "sent" ? colors.white : colors.ink} size={16} strokeWidth={1.6} />
 <Text style={[styles.tabText, tab === "sent" && styles.tabTextActive]}>Sent ({postcards.length})</Text>
 </Pressable>
 <Pressable
 onPress={() => setTab("replies")}
 style={[styles.tab, tab === "replies" && styles.tabActive]}
 testID="mail-history-tab-replies"
 accessibilityRole="button"
 accessibilityState={{ selected: tab === "replies" }}
 >
 <Mail color={tab === "replies" ? colors.white : colors.ink} size={16} strokeWidth={1.6} />
 <Text style={[styles.tabText, tab === "replies" && styles.tabTextActive]}>Replies ({voidReplies.length})</Text>
 </Pressable>
 </View>

 <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
 {tab === "sent" ? (
 sentSorted.length === 0 ? (
 <EmptyState
 icon={Inbox}
 title="No cards sent yet."
 body="Send your first one. it'll show up here."
 testID="mail-history-sent-empty"
 />
 ) : (
 sentSorted.map((card) => (
 <SentRow
 key={card.id}
 card={card}
 friendName={friendName(card.toFriendId)}
 when={fmtDate(card.sentAt)}
 onPress={onPressRow ? () => onPressRow(card.id) : undefined}
 />
 ))
 )
 ) : (
 repliesSorted.length === 0 ? (
 <EmptyState
 icon={Sparkles}
 title="No void replies yet."
 body="Send into the void and a stranger might write back."
 testID="mail-history-replies-empty"
 />
 ) : (
 repliesSorted.map((reply) => (
 <ReplyRow key={reply.id} reply={reply} when={fmtDate(reply.receivedAt)} />
 ))
 )
 )}
 </ScrollView>
 </View>
 </Modal>
 );
}

function EmptyState({ icon: Icon, title, body, testID }: { icon: any; title: string; body: string; testID?: string }) {
 return (
 <View style={emptyStyles.wrap} testID={testID}>
 <Icon color={colors.postalBlue} size={36} strokeWidth={1.4} />
 <Text style={emptyStyles.title}>{title}</Text>
 <Text style={emptyStyles.body}>{body}</Text>
 </View>
 );
}

function SentRow({
 card,
 friendName,
 when,
 onPress,
}: {
 card: Postcard;
 friendName: string;
 when: string;
 onPress?: () => void;
}) {
 const isCustom = card.category === "custom";
 // v0.7.0.25: wrap in Pressable when onPress is provided so users can
 // tap any sent row in the mail history to open the PostcardDetailSheet
 // (which exposes "Share again" for claim-link cards + "Retry shipping"
 // for orphans). Without onPress, render as plain View for back-compat.
 const Wrapper: any = onPress ? Pressable : View;
 return (
 <Wrapper
 onPress={onPress}
 style={({ pressed }: any) => [rowStyles.row, pressed && rowStyles.rowPressed]}
 accessibilityRole={onPress ? "button" : undefined}
 accessibilityLabel={onPress ? `Open postcard to ${friendName}` : undefined}
 testID={`mail-history-row-${card.id}`}
 >
 <View style={[rowStyles.iconWrap, isCustom && rowStyles.iconWrapCustom]}>
 <SendIcon color={isCustom ? colors.postalRed : colors.postalBlue} size={18} strokeWidth={1.6} />
 </View>
 <View style={{ flex: 1 }}>
 <View style={rowStyles.lineTop}>
 <Text style={rowStyles.name}>{friendName}</Text>
 <Text style={rowStyles.when}>{when}</Text>
 </View>
 <Text style={rowStyles.category}>{CATEGORY_LABELS[card.category]} · {card.creditCost}c {card.status === "draft" ? "· DRAFT" : ""}</Text>
 <Text style={rowStyles.message} numberOfLines={2}>{card.message || "no note"}</Text>
 </View>
 </Wrapper>
 );
}

function ReplyRow({ reply, when }: { reply: { id: string; from: string; message: string }; when: string }) {
 return (
 <View style={rowStyles.row}>
 <View style={[rowStyles.iconWrap, rowStyles.iconWrapReply]}>
 <Sparkles color="#76733B" size={18} strokeWidth={1.6} />
 </View>
 <View style={{ flex: 1 }}>
 <View style={rowStyles.lineTop}>
 <Text style={rowStyles.name}>{reply.from}</Text>
 <Text style={rowStyles.when}>{when}</Text>
 </View>
 <Text style={rowStyles.category}>Void reply</Text>
 <Text style={rowStyles.message} numberOfLines={3}>{reply.message}</Text>
 </View>
 </View>
 );
}

const styles = StyleSheet.create({
 root: { backgroundColor: colors.paper, flex: 1, paddingHorizontal: 20, paddingTop: 18 },
 // v0.7.0.49: header/title/subtitle/closeBtn extracted to SheetHeader.
 tabs: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 0, marginTop: 14, padding: 4 },
 tab: { alignItems: "center", borderRadius: 6, flex: 1, flexDirection: "row", gap: 6, justifyContent: "center", paddingVertical: 8 },
 tabActive: { backgroundColor: colors.ink },
 tabText: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 14 },
 tabTextActive: { color: colors.white },
 scroll: { flex: 1, marginTop: 12 },
 scrollContent: { gap: 8, paddingBottom: 40 },
});

const emptyStyles = StyleSheet.create({
 wrap: { alignItems: "center", backgroundColor: "rgba(60,110,143,0.05)", borderColor: colors.line, borderRadius: 8, borderWidth: 1, gap: 8, padding: 30 },
 title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17, marginTop: 8 },
 body: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17, textAlign: "center" },
});

const rowStyles = StyleSheet.create({
 row: { alignItems: "flex-start", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 12, padding: 12 },
 rowPressed: { opacity: 0.7 },
 iconWrap: { alignItems: "center", backgroundColor: "rgba(60,110,143,0.08)", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
 iconWrapCustom: { backgroundColor: "rgba(184,74,58,0.1)" },
 iconWrapReply: { backgroundColor: "rgba(217,180,110,0.18)" },
 lineTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
 name: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16 },
 when: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.4 },
 category: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.6, marginTop: 2, textTransform: "uppercase" },
 message: { color: colors.ink, fontFamily: fonts.serif, fontSize: 14, lineHeight: 19, marginTop: 4 },
});
