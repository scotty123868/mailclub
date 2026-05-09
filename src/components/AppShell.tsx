import { LinearGradient } from "expo-linear-gradient";
import { PropsWithChildren } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, gradients } from "@/src/theme/colors";

export function AppShell({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={gradients.paper} style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 108 }]}
      >
        <PaperTexture />
        {children}
      </ScrollView>
    </LinearGradient>
  );
}

function PaperTexture() {
  return (
    <View pointerEvents="none" style={styles.texture}>
      <Svg width="100%" height="100%" viewBox="0 0 390 920" preserveAspectRatio="none">
        {Array.from({ length: 70 }).map((_, index) => (
          <Circle
            key={index}
            cx={(index * 67) % 390}
            cy={(index * 109) % 920}
            r={(index % 5) + 0.6}
            fill={index % 3 === 0 ? "#D8C49D" : "#FFFFFF"}
            opacity={index % 3 === 0 ? 0.12 : 0.16}
          />
        ))}
        {Array.from({ length: 18 }).map((_, index) => (
          <Path
            key={`fiber-${index}`}
            d={`M${(index * 43) % 390} ${(index * 79) % 920} C ${((index * 43) % 390) + 22} ${((index * 79) % 920) + 7}, ${((index * 43) % 390) + 42} ${((index * 79) % 920) - 4}, ${((index * 43) % 390) + 72} ${((index * 79) % 920) + 3}`}
            stroke="#BFAE8F"
            strokeWidth="0.7"
            opacity="0.12"
            fill="none"
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 18, gap: 18 },
  texture: {
    ...StyleSheet.absoluteFillObject,
    opacity: 1,
  },
});
