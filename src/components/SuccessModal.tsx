import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CheckCircle2 } from "lucide-react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";

export function SuccessModal({ visible, title, subtitle, onClose }: { visible: boolean; title: string; subtitle?: string; onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <PostalCard style={styles.modal}>
          <CheckCircle2 color={colors.sage} size={46} strokeWidth={1.4} />
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
  modal: { alignItems: "center", gap: 12, padding: 24, width: "100%" },
  title: { color: colors.ink, fontFamily: fonts.serif, fontSize: 25, textAlign: "center" },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 15, textAlign: "center" },
  button: { backgroundColor: colors.ink, borderRadius: 8, marginTop: 6, paddingHorizontal: 28, paddingVertical: 13 },
  buttonText: { color: colors.white, fontFamily: fonts.sans, fontSize: 15, fontWeight: "700" },
});
