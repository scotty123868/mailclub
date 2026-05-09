import { Settings } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { PostmarkDecoration } from "@/src/components/PostmarkDecoration";
import { colors } from "@/src/theme/colors";
import { fonts, type } from "@/src/theme/typography";

export function Header({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brand}>Mail Club</Text>
        <Svg width={94} height={13} viewBox="0 0 94 13" style={styles.swoosh}>
          <Path d="M2 10 C28 2, 60 4, 92 1" stroke={colors.ink} strokeWidth="2" strokeLinecap="round" fill="none" />
        </Svg>
        <PostmarkDecoration compact />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Settings color={colors.ink} size={27} strokeWidth={1.8} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 58 },
  brand: { color: colors.ink, fontFamily: "Snell Roundhand", fontSize: 34, fontWeight: "700" },
  swoosh: { marginTop: -9 },
  title: { color: colors.ink, fontFamily: fonts.serif, fontSize: type.heading, marginLeft: -18 },
});
