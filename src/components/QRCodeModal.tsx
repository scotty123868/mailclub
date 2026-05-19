import { Share2 } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { SheetHeader } from "@/src/components/system/SheetHeader";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * v0.7.0.51: QR encoding for end-to-end add-friend.
 *
 * URL format: `https://app.themailroom.club/u/{userId}?n={name}&c={city}`
 *
 * - Path `/u/{userId}` is covered by AASA (deployed on Vercel separately)
 *   and routed by `app/u/[userId].tsx` in this app. So:
 *   • App installed → iOS opens Mailroom directly at the add-friend confirm
 *   • App not installed → Safari → marketing site can render an "Open in
 *     Mailroom / Download" page. App Clip (build 65+) intercepts before
 *     Safari ever loads.
 * - Query params `?n=` and `?c=` are embedded so the confirm screen can
 *   show the friend's name + city WITHOUT a backend lookup. Public info
 *   anyway. Quirk to note: AASA matches the path, not query — query is
 *   passed through to the app intact.
 */
const PROFILE_URL_BASE = "https://app.themailroom.club";

export function QRCodeModal({
  visible,
  onClose,
  name,
  city,
  state,
  userId,
  avatarLook = "scotty",
}: {
  visible: boolean;
  onClose: () => void;
  name: string;
  city: string;
  state: string;
  userId: string;
  avatarLook?: any;
}) {
  // v0.7.0.51: encode userId in the path + name/city in query params so
  // the scanner's app can render the confirm screen without a backend
  // round-trip. Empty userId falls back to the bare homepage.
  const qrValue = userId
    ? `${PROFILE_URL_BASE}/u/${encodeURIComponent(userId)}?n=${encodeURIComponent(name)}&c=${encodeURIComponent(city)}${state ? `&s=${encodeURIComponent(state)}` : ""}`
    : PROFILE_URL_BASE;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <SheetHeader
            title="Your Mail Card"
            subtitle="Show this to a friend — they scan it to send you a free first card."
            onClose={onClose}
            closeAccessibilityLabel="Close QR code modal"
            closeTestID="qr-modal-close"
          />

          <View style={styles.qrBox} testID="qr-svg">
            <QRCode
              value={qrValue}
              size={QR_SIZE}
              backgroundColor={colors.white}
              color={colors.ink}
              ecl="H"
            />
          </View>

          <View style={styles.identity}>
            <IdentityAvatar user={{ name, avatarInitials: "" }} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={styles.identityName}>{name}</Text>
              <Text style={styles.identityCity}>{city}, {state}</Text>
              <Text style={styles.identityCode}>themailroom.club/u/{userId.slice(0, 8)}…</Text>
            </View>
          </View>

          <Pressable onPress={onClose} style={styles.shareBtn} testID="qr-modal-done" accessibilityRole="button">
            <Share2 color={colors.white} size={16} strokeWidth={1.7} />
            <Text style={styles.shareBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const QR_SIZE = 210;

const styles = StyleSheet.create({
  scrim: { alignItems: "center", backgroundColor: "rgba(8,18,40,0.78)", flex: 1, justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: colors.paper, borderRadius: 14, gap: 16, padding: 22, width: "100%" },
  // v0.7.0.49: header/title/subtitle/closeBtn extracted to SheetHeader.
  qrBox: { alignItems: "center", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 10, borderWidth: 1, padding: 16 },
  identity: { alignItems: "center", backgroundColor: "rgba(255,253,247,0.85)", borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 12, padding: 12 },
  identityName: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22 },
  identityCity: { color: colors.postalBlue, fontFamily: fonts.serif, fontSize: 13 },
  // v0.7.0.49: was "code · SCOTTY-001" (the hardcoded userId bug). Now shows
  // the actual short URL the QR encodes, so the user knows what they're
  // sharing if a friend asks to type it manually.
  identityCode: { color: colors.postalRed, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.4, marginTop: 3 },
  shareBtn: { alignItems: "center", backgroundColor: colors.ink, borderRadius: 8, flexDirection: "row", gap: 8, justifyContent: "center", paddingVertical: 14 },
  shareBtnText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 16, letterSpacing: 0.3 },
});
