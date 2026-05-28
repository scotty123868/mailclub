import { Mail } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Persistent stamp-balance pill for the right side of the Header.
 *
 * v0.7.0.27. alignment rewrite (third attempt).
 *
 * Previous two attempts (glyphBox bounding + translateY transform)
 * couldn't get the digit and envelope to sit on the same optical line
 * because we were trying to align a SERIF digit ("0", "1", "3") with
 * a sans-serif/geometric SVG icon. Serif digits have variable cap-
 * height ratios and baseline-relative descenders that don't match
 * SVG icon bounding boxes. no amount of lineHeight or translateY
 * could square the circle without breaking other digits.
 *
 * The fix: use the sans-serif Inter font for the digit. Inter has
 * uniform tabular figures that center cleanly against an SVG icon
 * when both live in a flex row with alignItems:center. Drop every
 * single bounding-box / translateY / lineHeight hack. The render is
 * now whatever iOS gives us for a plain Text in a flex row. which
 * turns out to be exactly right when the font isn't fighting us.
 *
 * Reads `credits` from MailClubContext so the count updates the moment
 * a send completes or a purchase lands. Owns its own CreditsSheet so
 * any tab using <Header /> gets a one-tap path to buy stamps.
 */
export function CreditsPill() {
 const { credits } = useMailClub();
 const [open, setOpen] = useState(false);

 return (
 <>
 <Pressable
 onPress={() => setOpen(true)}
 style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
 accessibilityRole="button"
 accessibilityLabel={`${credits} ${credits === 1 ? "stamp" : "stamps"}. Tap to buy more.`}
 testID="header-credits-pill"
 hitSlop={8}
 >
 <Mail color={colors.ink} size={16} strokeWidth={1.8} />
 <Text style={styles.count} allowFontScaling={false}>
 {credits}
 </Text>
 </Pressable>
 <CreditsSheet visible={open} onClose={() => setOpen(false)} />
 </>
 );
}

const styles = StyleSheet.create({
 pill: {
 alignItems: "center",
 backgroundColor: colors.paper,
 borderColor: colors.line,
 borderRadius: 18,
 borderWidth: 1,
 flexDirection: "row",
 gap: 6,
 paddingHorizontal: 12,
 paddingVertical: 6,
 },
 pillPressed: { opacity: 0.6 },
 // Sans-serif digit. Inter's tabular figures align cleanly against
 // an SVG icon's geometric center when both sit in a flex row.
 // includeFontPadding only matters on Android; on iOS it's a no-op
 // but harmless. No lineHeight override (let the font's natural
 // metrics drive height). No transform hacks. allowFontScaling:false
 // on the Text element above prevents the user's iOS text-size
 // setting from blowing the pill apart on accessibility builds.
 count: {
 color: colors.ink,
 fontFamily: fonts.sansBold,
 fontSize: 14,
 includeFontPadding: false,
 minWidth: 12,
 textAlign: "center",
 },
});
