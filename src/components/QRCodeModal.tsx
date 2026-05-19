import { Share2 } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { SheetHeader } from "@/src/components/system/SheetHeader";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * v0.7.0.49: real QR encoding.
 *
 * Before: hashGrid() rendered a 21x21 pattern that LOOKED like a QR (corner
 * finder patterns + random dots) but encoded nothing. Scanning it with iOS
 * Camera or any QR reader returned nothing. Trust-breaker: a user would
 * "Show my code" to a friend, the friend would scan, and nothing would
 * happen. The friend would think the app was broken or the user was lying.
 *
 * Now: react-native-qrcode-svg encodes a real URL. The URL pattern is
 * `https://app.themailroom.club/u/{userId}` — a profile-share URL.
 *
 * Today the /u/* path is NOT yet routed (no AASA entry, no Vercel rewrite,
 * no app route handler). Scanning it on iOS opens Safari to
 * app.themailroom.club, which 200s to the marketing homepage. That's an
 * acceptable web fallback while the full deep-link infrastructure
 * follows. The QR is at least REAL — scans resolve to a Mailroom URL,
 * not nothing. TODO follow-up:
 *   1. Add `/u/*` to AASA in mailroom-site/.well-known/apple-app-site-association
 *   2. Add `/u/(.*)` rewrite in mailroom-site/vercel.json → a profile-share
 *      landing page with App Store link + "send {first name} a card" CTA
 *   3. Add `app/u/[userId].tsx` Expo Router route to deep-link into
 *      send-to-this-friend flow
 */
const PROFILE_URL_BASE = "https://app.themailroom.club/u";

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
  // QR value is a stable profile URL. Even when userId is empty (signed
  // out / local-only mode), encode the base so scans aren't ambiguous.
  const qrValue = userId
    ? `${PROFILE_URL_BASE}/${encodeURIComponent(userId)}`
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
              <Text style={styles.identityCode}>themailroom.club/u/{userId.slice(0, 8)}</Text>
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
