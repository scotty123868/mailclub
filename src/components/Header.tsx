import { Settings } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CreditsPill } from "@/src/components/CreditsPill";
import { colors } from "@/src/theme/colors";
import { fonts, type } from "@/src/theme/typography";

/**
 * App header. v0.5.0 single-row layout.
 *
 * Layout: [title] [CreditsPill] [gear?]
 *
 * Decisions locked in the send-flow gallery:
 * • Mailroom wordmark removed. the page title earns the top of every tab.
 * The brand still lives on the icon, splash, and printed postcard back.
 * • Title sits left at type.title (32pt) so each tab announces itself with
 * real type hierarchy instead of a small subheading squeezed between a
 * wordmark and the actions.
 * • CreditsPill is persistent on every tab (one-tap to Buy Stamps). The
 * pill is the ONLY entry to Buy Stamps. the inline "credits · + Buy"
 * row on My Card was removed in the same release.
 * • Gear icon only renders when the screen passes `onPressSettings` .
 * in practice that means My Card only. Other tabs get a clean
 * [title] [pill] row, no gear noise.
 *
 * `hideCreditsPill` exists for onboarding steps that need to suppress all
 * chrome above the welcome content.
 */
export function Header({
 title,
 subtitle,
 onPressSettings,
 hideCreditsPill = false,
}: {
 title: string;
 // v0.7.0.49: optional subtitle for storytelling. Currently used by
 // Map ("4 cities · 7 cards"); other tabs can opt in with light copy
 // when there's something worth telling.
 subtitle?: string;
 onPressSettings?: () => void;
 hideCreditsPill?: boolean;
}) {
 return (
 <View style={styles.header}>
 <View style={styles.titleCol}>
 <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
 {title}
 </Text>
 {subtitle ? (
 <Text style={styles.subtitle} numberOfLines={1}>
 {subtitle}
 </Text>
 ) : null}
 </View>
 <View style={styles.rightActions}>
 {hideCreditsPill ? null : <CreditsPill />}
 {onPressSettings ? (
 <Pressable
 onPress={onPressSettings}
 hitSlop={10}
 style={styles.gearWrap}
 testID="header-settings-btn"
 accessibilityRole="button"
 accessibilityLabel="Open settings"
 >
 <Settings color={colors.mutedInk} size={22} strokeWidth={1.6} />
 </Pressable>
 ) : null}
 </View>
 </View>
 );
}

const styles = StyleSheet.create({
 header: {
 alignItems: "center",
 flexDirection: "row",
 justifyContent: "space-between",
 minHeight: 52,
 paddingTop: 4,
 paddingBottom: 8,
 },
 titleCol: {
 flex: 1,
 paddingRight: 12,
 },
 title: {
 color: colors.ink,
 fontFamily: fonts.serifSemi,
 fontSize: type.title,
 letterSpacing: -0.2,
 lineHeight: type.title + 2,
 },
 // v0.7.0.49: subtitle line under the title. small italic mutedInk so
 // it reads as a quiet kicker, not a competing heading.
 subtitle: {
 color: colors.mutedInk,
 fontFamily: fonts.serifItalic,
 fontSize: 13,
 marginTop: 2,
 },
 rightActions: {
 alignItems: "center",
 flexDirection: "row",
 gap: 8,
 },
 gearWrap: {
 alignItems: "center",
 height: 36,
 justifyContent: "center",
 width: 36,
 },
});
