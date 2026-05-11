import { Check, FileText, Image, MapPin, Palette } from "lucide-react-native";
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
            {active ? <View style={styles.check}><Check color={colors.white} size={14} /></View> : null}
            <Icon color={active ? colors.postalRed : colors.ink} size={25} strokeWidth={1.3} />
            <Text style={[styles.title, active && styles.titleActive]}>{item.title}</Text>
            <Text style={[styles.credits, active && styles.creditsActive]}>{cost} {cost === 1 ? "credit" : "credits"}</Text>
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
  option: { alignItems: "center", borderLeftColor: colors.line, borderLeftWidth: StyleSheet.hairlineWidth, flex: 1, minHeight: 92, padding: 10 },
  active: { backgroundColor: "rgba(184, 74, 58, 0.07)", borderColor: "rgba(184,74,58,0.35)", borderRadius: 8, borderWidth: 1 },
  check: { alignItems: "center", backgroundColor: colors.postalRed, borderRadius: 14, bottom: 8, height: 24, justifyContent: "center", position: "absolute", right: 8, width: 24 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16, marginTop: 6, textAlign: "center" },
  titleActive: { color: colors.postalRed },
  credits: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 12 },
  creditsActive: { color: colors.postalRed },
});
