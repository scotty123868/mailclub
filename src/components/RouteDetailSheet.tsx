import { Globe2, MapPin, Users, X } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/src/components/Buttons";
import { MiniPostcardArt } from "@/src/components/PostalIllustrations";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { Stamp } from "@/src/components/Stamp";
import { MailRoute } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { formatMiles } from "@/src/utils/format";

export function RouteDetailSheet({
  route,
  visible,
  onClose,
  onSendSimilar,
}: {
  route: MailRoute | null;
  visible: boolean;
  onClose: () => void;
  onSendSimilar?: () => void;
}) {
  if (!route) return null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{route.from} → {route.to}</Text>
            <Text style={styles.subtitle}>{route.date}</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            testID="route-detail-close"
            accessibilityRole="button"
            accessibilityLabel="Close route details"
          >
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

        <View style={styles.artWrap}>
          <MiniPostcardArt variant="mountain" />
          <View style={styles.stamp}>
            <Stamp motif="compass" tone="red" cents={`${Math.max(1, Math.floor(route.miles / 100))}¢`} rotate={-6} size="sm" />
          </View>
          <View style={styles.postmark}>
            <CircularPostmark size={70} topText={route.from.toUpperCase()} bottomText={route.to.toUpperCase()} centerYear="" />
          </View>
        </View>

        <View style={styles.statRow}>
          <Stat icon={Globe2} value={formatMiles(route.miles)} label="MILES" />
          <Stat icon={Users} value={String(route.people.split("&").length)} label="PEOPLE" />
          <Stat icon={MapPin} value={`${route.from.slice(0, 3).toUpperCase()}→${route.to.slice(0, 3).toUpperCase()}`} label="ROUTE" />
        </View>

        <View style={styles.body}>
          <Text style={styles.bodyTitle}>People on this route</Text>
          <Text style={styles.bodyText}>{route.people}</Text>
          <Text style={styles.bodyHintText}>
            A real-world line — both ends started with someone you actually know.
          </Text>
        </View>

        {onSendSimilar ? (
          <PrimaryButton title="Send a card to this route" onPress={onSendSimilar} />
        ) : null}
      </View>
    </Modal>
  );
}

function Stat({ icon: Icon, value, label }: { icon: any; value: string; label: string }) {
  return (
    <View style={statStyles.cell}>
      <Icon color={colors.postalBlue} size={18} strokeWidth={1.5} />
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.paper, flex: 1, gap: 16, paddingHorizontal: 20, paddingTop: 18 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28, lineHeight: 32 },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14, marginTop: 4 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
  artWrap: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 10, borderWidth: 1, height: 168, overflow: "hidden", position: "relative" },
  stamp: { position: "absolute", right: 12, top: 12 },
  postmark: { left: 14, opacity: 0.45, position: "absolute", top: 14 },
  statRow: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", padding: 14 },
  body: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, gap: 6, padding: 14 },
  bodyTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
  bodyText: { color: colors.ink, fontFamily: fonts.serif, fontSize: 16 },
  bodyHintText: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 18, marginTop: 6 },
});

const statStyles = StyleSheet.create({
  cell: { alignItems: "center", flex: 1, gap: 4 },
  value: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17, textAlign: "center" },
  label: { color: colors.mutedInk, fontFamily: fonts.sansBold, fontSize: 9, letterSpacing: 0.7 },
});
