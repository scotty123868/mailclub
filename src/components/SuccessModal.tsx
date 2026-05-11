import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";
import { CircularPostmark } from "./PostmarkDecoration";
import { Stamp } from "./Stamp";

export function SuccessModal({ visible, title, subtitle, onClose }: { visible: boolean; title: string; subtitle?: string; onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <PostalCard style={styles.modal}>
          <View style={styles.stamp}>
            <Stamp motif="dove" tone="red" cents="3¢" rotate={6} />
          </View>
          <View style={styles.postmark}>
            <CircularPostmark size={94} />
          </View>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <Pressable onPress={onClose} style={styles.button}>
            <Text style={styles.buttonText}>Done</Text>
          </Pressable>
        </PostalCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: "center", backgroundColor: "rgba(17, 26, 51, 0.38)", flex: 1, justifyContent: "center", padding: 26 },
  modal: { alignItems: "center", gap: 14, paddingBottom: 24, paddingHorizontal: 26, paddingTop: 70, width: "100%" },
  stamp: { position: "absolute", right: 18, top: 14 },
  postmark: { left: 18, opacity: 0.45, position: "absolute", top: 14 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 24, lineHeight: 30, textAlign: "center" },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14, lineHeight: 20, textAlign: "center" },
  button: { backgroundColor: colors.ink, borderRadius: 8, marginTop: 8, paddingHorizontal: 32, paddingVertical: 13 },
  buttonText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 17, letterSpacing: 0.5 },
});
