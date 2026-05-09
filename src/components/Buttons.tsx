import * as Haptics from "expo-haptics";
import { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

type ButtonProps = {
  title: string;
  onPress: () => void;
  icon?: LucideIcon;
  style?: ViewStyle;
};

export function PrimaryButton({ title, onPress, icon: Icon, style }: ButtonProps) {
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => [styles.base, styles.primary, pressed && styles.pressed, style]}
    >
      {Icon ? <Icon color={colors.white} size={21} strokeWidth={1.8} /> : null}
      <Text style={[styles.text, styles.primaryText]}>{title}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, icon: Icon, style }: ButtonProps) {
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => [styles.base, styles.secondary, pressed && styles.pressed, style]}
    >
      {Icon ? <Icon color={colors.sage} size={21} strokeWidth={1.8} /> : null}
      <Text style={[styles.text, styles.secondaryText]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", borderRadius: 8, flexDirection: "row", gap: 10, justifyContent: "center", minHeight: 58, paddingHorizontal: 18 },
  primary: { backgroundColor: colors.ink, shadowColor: colors.ink, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.24, shadowRadius: 12 },
  secondary: { backgroundColor: "rgba(248, 241, 227, 0.72)", borderColor: colors.sage, borderWidth: 1.2 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  text: { fontFamily: fonts.serif, fontSize: 22 },
  primaryText: { color: colors.white },
  secondaryText: { color: "#637C5E" },
});
