import { LinearGradient } from "expo-linear-gradient";
import { PropsWithChildren } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, gradients } from "@/src/theme/colors";
import { PaperTexture } from "./PaperTexture";

/**
 * AppShell. the cream-paper background, paper texture, and scroll container
 * every tab sits inside.
 *
 * v0.5.0 keyboard behavior (gallery decision):
 * • `keyboardDismissMode="on-drag"`. swipe down anywhere in the scroll
 * view to dismiss the keyboard. Fixes the TestFlight 0.4.1 complaint
 * that the keyboard blocked the address fields and couldn't be
 * dismissed without a finicky tap-outside.
 * • `keyboardShouldPersistTaps="handled"`. taps inside the scroll view
 * can still hit buttons even while the keyboard is up (otherwise the
 * first tap just dismisses the keyboard and you have to tap again).
 */
export function AppShell({ children }: PropsWithChildren) {
 const insets = useSafeAreaInsets();
 return (
 <LinearGradient colors={gradients.paper} style={styles.root}>
 <View style={StyleSheet.absoluteFill} pointerEvents="none">
 <PaperTexture />
 </View>
 <ScrollView
 showsVerticalScrollIndicator={false}
 keyboardDismissMode="on-drag"
 keyboardShouldPersistTaps="handled"
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
