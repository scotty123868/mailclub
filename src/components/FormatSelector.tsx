import { Check, Heart, Image, Layers, Mail } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Postcard } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";

const options: Array<{ id: Postcard["type"]; title: string; stamps: number; icon: typeof Mail }> = [
  { id: "note", title: "Note", stamps: 1, icon: Mail },
  { id: "photo", title: "Photo", stamps: 3, icon: Image },
  { id: "keepsake", title: "Keepsake", stamps: 5, icon: Layers },
  { id: "ask-out", title: "Ask Out", stamps: 3, icon: Heart },
];

export function stampCostFor(format: Postcard["type"]) {
  return options.find((item) => item.id === format)?.stamps ?? 1;
}

export function FormatSelector({ selected, onSelect }: { selected: Postcard["type"]; onSelect: (format: Postcard["type"]) => void }) {
  return (
    <PostalCard style={styles.row}>
      {options.map((item) => {
        const active = selected === item.id;
        const Icon = item.icon;
        return (
          <Pressable key={item.id} onPress={() => onSelect(item.id)} style={[styles.option, active && styles.active]}>
            {active ? <View style={styles.check}><Check color={colors.white} size={14} /></View> : null}
            <Icon color={active ? colors.postalRed : colors.ink} size={25} strokeWidth={1.3} />
            <Text style={[styles.title, active && styles.titleActive]}>{item.title}</Text>
            <Text style={[styles.stamps, active && styles.stampsActive]}>{item.stamps} {item.stamps === 1 ? "stamp" : "stamps"}</Text>
          </Pressable>
        );
      })}
    </PostalCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", overflow: "hidden", padding: 0 },
  option: { alignItems: "center", borderLeftColor: colors.line, borderLeftWidth: StyleSheet.hairlineWidth, flex: 1, minHeight: 92, padding: 10 },
  active: { backgroundColor: "rgba(184, 74, 58, 0.07)", borderColor: "rgba(184,74,58,0.35)", borderRadius: 8, borderWidth: 1 },
  check: { alignItems: "center", backgroundColor: colors.postalRed, borderRadius: 14, bottom: 8, height: 24, justifyContent: "center", position: "absolute", right: 8, width: 24 },
  title: { color: colors.ink, fontFamily: fonts.serif, fontSize: 17, marginTop: 8, textAlign: "center" },
  titleActive: { color: colors.postalRed },
  stamps: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 13 },
  stampsActive: { color: colors.postalRed },
});
