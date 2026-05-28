/**
 * v0.7.0.49: extracted from the 9+ sheets that copy-pasted the
 * "title + subtitle + closeBtn" header row. Single source of truth for
 * sheet entry typography + spacing.
 *
 * The title uses `fonts.serifSemi` at 28pt. The subtitle uses
 * `fonts.serifItalic` at 13pt @ mutedInk. The close button is the
 * shared SheetCloseButton primitive.
 *
 * If a sheet needs a different visual hierarchy (a back button, a
 * gear icon, a step counter), don't fork this. build a different
 * primitive. This one is intentionally narrow.
 */
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { SheetCloseButton } from "./SheetCloseButton";

type SheetHeaderProps = {
 title: string;
 subtitle?: string;
 onClose: () => void;
 closeAccessibilityLabel?: string;
 closeTestID?: string;
};

export function SheetHeader({
 title,
 subtitle,
 onClose,
 closeAccessibilityLabel,
 closeTestID,
}: SheetHeaderProps) {
 return (
 <View style={styles.row}>
 <View style={styles.textCol}>
 <Text style={styles.title}>{title}</Text>
 {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
 </View>
 <SheetCloseButton
 onPress={onClose}
 accessibilityLabel={closeAccessibilityLabel ?? `Close ${title.toLowerCase()}`}
 testID={closeTestID}
 />
 </View>
 );
}

const styles = StyleSheet.create({
 row: {
 alignItems: "flex-start",
 flexDirection: "row",
 gap: 12,
 justifyContent: "space-between",
 },
 textCol: {
 flex: 1,
 minWidth: 0,
 },
 title: {
 color: colors.ink,
 fontFamily: fonts.serifSemi,
 fontSize: 28,
 },
 subtitle: {
 color: colors.mutedInk,
 fontFamily: fonts.serifItalic,
 fontSize: 13,
 marginTop: 4,
 },
});
