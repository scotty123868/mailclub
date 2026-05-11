import { Settings } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "@/src/theme/colors";
import { fonts, type } from "@/src/theme/typography";

export function Header({ title, onPressSettings }: { title: string; onPressSettings?: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandWrap}>
        <Text style={styles.brand}>Mail Club</Text>
        <Svg width={92} height={9} viewBox="0 0 92 9" style={styles.flourish}>
          <Path d="M 0 5 Q 22 1, 44 5 L 46 2 L 48 5 Q 70 9, 92 5" stroke={colors.postalRed} strokeWidth={1.2} fill="none" strokeLinecap="round" />
        </Svg>
      </View>
      <Text style={styles.title}>{title}</Text>
      {onPressSettings ? (
        <Pressable
          onPress={onPressSettings}
          hitSlop={10}
          testID="header-settings-btn"
          accessibilityRole="button"
          accessibilityLabel="Open settings"
        >
          <Settings color={colors.ink} size={26} strokeWidth={1.4} />
        </Pressable>
      ) : (
        <Settings color={colors.ink} size={26} strokeWidth={1.4} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 58, paddingTop: 4 },
  brandWrap: { alignItems: "flex-start" },
  brand: { color: colors.ink, fontFamily: fonts.script, fontSize: type.brand, lineHeight: type.brand + 2, includeFontPadding: false },
  flourish: { marginTop: -4, marginLeft: 4 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: type.heading, letterSpacing: 0.2 },
});
