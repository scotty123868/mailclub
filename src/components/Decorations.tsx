import { StyleSheet, View } from "react-native";
import { colors } from "@/src/theme/colors";

export function AirmailDivider() {
  return <View style={styles.airmail} />;
}

const styles = StyleSheet.create({
  airmail: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.postalBlue,
    borderBottomColor: colors.postalRed,
    borderBottomWidth: 2,
    opacity: 0.85,
  },
});
