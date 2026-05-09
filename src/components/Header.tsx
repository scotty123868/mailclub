import { Settings } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { PostmarkDecoration } from "@/src/components/PostmarkDecoration";
import { colors } from "@/src/theme/colors";
import { fonts, type } from "@/src/theme/typography";

export function Header({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brand}>Mail Club</Text>
        <PostmarkDecoration compact />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Settings color={colors.ink} size={27} strokeWidth={1.8} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 58 },
  brand: { color: colors.ink, fontFamily: fonts.serif, fontSize: 29, fontStyle: "italic", fontWeight: "700", textDecorationLine: "underline" },
  title: { color: colors.ink, fontFamily: fonts.serif, fontSize: type.heading, marginLeft: -18 },
});
