import { FileText, Image, MapPin, Palette } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CARD_COSTS } from "@/src/data/credits";
import { CardCategory } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";

const options: Array<{ id: CardCategory; title: string; icon: typeof FileText }> = [
 { id: "handwritten", title: "Note", icon: FileText },
 { id: "photo", title: "Photo", icon: Image },
 { id: "place", title: "Place", icon: MapPin },
 { id: "custom", title: "Custom", icon: Palette },
];

/**
 * Four card categories priced in credits. Active state is a tinted background
 * + colored top bar + heavier title. no overlay check badge clipping the
 * credit count.
 */
export function CategoryPicker({ selected, onSelect }: { selected: CardCategory; onSelect: (category: CardCategory) => void }) {
 return (
 <PostalCard style={styles.row}>
 {options.map((item) => {
 const active = selected === item.id;
 const Icon = item.icon;
 const cost = CARD_COSTS[item.id];
 return (
 <Pressable
 key={item.id}
 onPress={() => onSelect(item.id)}
 style={[styles.option, active && styles.active]}
 testID={`category-${item.id}`}
 accessibilityRole="button"
 accessibilityLabel={`${item.title}, ${cost} credit${cost === 1 ? "" : "s"}`}
 accessibilityState={{ selected: active }}
 >
 {active ? <View style={styles.activeBar} /> : null}
 <Icon color={active ? colors.postalRed : colors.ink} size={24} strokeWidth={1.4} />
 <Text style={[styles.title, active && styles.titleActive]} numberOfLines={1}>{item.title}</Text>
 <Text style={[styles.credits, active && styles.creditsActive]} numberOfLines={1}>{cost} {cost === 1 ? "credit" : "credits"}</Text>
 </Pressable>
 );
 })}
 </PostalCard>
 );
}

export function creditCostFor(category: CardCategory): number {
 return CARD_COSTS[category];
}

const styles = StyleSheet.create({
 row: { flexDirection: "row", overflow: "hidden", padding: 0 },
 option: { alignItems: "center", borderLeftColor: colors.line, borderLeftWidth: StyleSheet.hairlineWidth, flex: 1, minHeight: 96, paddingHorizontal: 6, paddingVertical: 14 },
 active: { backgroundColor: "rgba(184, 74, 58, 0.07)" },
 activeBar: { backgroundColor: colors.postalRed, height: 3, left: 0, position: "absolute", right: 0, top: 0 },
 title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15, marginTop: 7, textAlign: "center" },
 titleActive: { color: colors.postalRed, fontFamily: fonts.serifBold },
 credits: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 11, letterSpacing: 0.2, marginTop: 2 },
 creditsActive: { color: colors.postalRed, fontFamily: fonts.sansBold },
});
