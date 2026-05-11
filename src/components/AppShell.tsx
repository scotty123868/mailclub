import { LinearGradient } from "expo-linear-gradient";
import { PropsWithChildren } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, gradients } from "@/src/theme/colors";
import { PaperTexture } from "./PaperTexture";

export function AppShell({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={gradients.paper} style={styles.root}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <PaperTexture />
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 108 }]}
      >
        {children}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 18, gap: 18 },
});
