import { PropsWithChildren } from "react";
import { AccessibilityProps, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { colors } from "@/src/theme/colors";

type PostalCardProps = PropsWithChildren<
  AccessibilityProps & {
    style?: StyleProp<ViewStyle>;
    testID?: string;
  }
>;

export function PostalCard({ children, style, testID, ...rest }: PostalCardProps) {
  return (
    <View style={[styles.card, style]} testID={testID} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255, 253, 247, 0.74)",
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 3,
  },
});
