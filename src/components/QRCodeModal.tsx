import { Share2, X } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { IdentityAvatar } from "@/src/components/IdentityAvatar";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

// Hash a string into a deterministic 21x21 boolean grid that LOOKS like a QR code.
// MVP placeholder — real QR encoding ships in the next release.
function hashGrid(input: string, size = 21): boolean[][] {
  let seed = 0;
  for (let i = 0; i < input.length; i++) {
    seed = (seed * 31 + input.charCodeAt(i)) >>> 0;
  }
  const grid: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      row.push((seed % 100) < 47);
    }
    grid.push(row);
  }
  // Force the three corner finder patterns (7x7 with a 3x3 dark center) like a real QR
  const placeFinder = (startR: number, startC: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const onCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[startR + r][startC + c] = onBorder || onCenter;
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);
  return grid;
}

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
  const size = 21;
  const cell = 10;
  const grid = hashGrid(`mailclub:${userId}:${name}`, size);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Your Mail Card</Text>
              <Text style={styles.subtitle}>Show this to a friend — they scan it to send you a free first card.</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} testID="qr-modal-close" accessibilityRole="button" accessibilityLabel="Close QR code modal">
              <X color={colors.ink} size={22} strokeWidth={1.5} />
            </Pressable>
          </View>

          <View style={styles.qrBox} testID="qr-svg">
            <Svg width={size * cell} height={size * cell} viewBox={`0 0 ${size * cell} ${size * cell}`}>
              <Rect x={0} y={0} width={size * cell} height={size * cell} fill={colors.white} />
              {grid.map((row, r) =>
                row.map((on, c) => on ? (
                  <Rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell} fill={colors.ink} />
                ) : null)
              )}
            </Svg>
          </View>

          <View style={styles.identity}>
            <IdentityAvatar user={{ name, avatarInitials: "" }} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={styles.identityName}>{name}</Text>
              <Text style={styles.identityCity}>{city}, {state}</Text>
              <Text style={styles.identityCode}>code · {userId.toUpperCase()}</Text>
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

const styles = StyleSheet.create({
  scrim: { alignItems: "center", backgroundColor: "rgba(8,18,40,0.78)", flex: 1, justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: colors.paper, borderRadius: 14, gap: 16, padding: 22, width: "100%" },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 24 },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17, marginTop: 4 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
  qrBox: { alignItems: "center", backgroundColor: colors.white, borderColor: colors.line, borderRadius: 10, borderWidth: 1, padding: 16 },
  identity: { alignItems: "center", backgroundColor: "rgba(255,253,247,0.85)", borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 12, padding: 12 },
  identityName: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22 },
  identityCity: { color: colors.postalBlue, fontFamily: fonts.serif, fontSize: 13 },
  identityCode: { color: colors.postalRed, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.6, marginTop: 3 },
  shareBtn: { alignItems: "center", backgroundColor: colors.ink, borderRadius: 8, flexDirection: "row", gap: 8, justifyContent: "center", paddingVertical: 14 },
  shareBtnText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 16, letterSpacing: 0.3 },
});
