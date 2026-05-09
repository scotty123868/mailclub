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
    <View style={styles.row}>
      {options.map((item) => {
        const active = selected === item.id;
        const Icon = item.icon;
        return (
          <Pressable key={item.id} onPress={() => onSelect(item.id)} style={styles.optionWrap}>
            <PostalCard style={[styles.option, active && styles.active]}>
              {active ? <View style={styles.check}><Check color={colors.white} size={14} /></View> : null}
              <Icon color={active ? colors.ink : "#8B806C"} size={28} strokeWidth={1.3} />
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.stamps}>{item.stamps} {item.stamps === 1 ? "stamp" : "stamps"}</Text>
            </PostalCard>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  optionWrap: { flex: 1 },
  option: { alignItems: "center", minHeight: 112, padding: 13 },
  active: { borderColor: colors.ink, borderWidth: 1.4 },
  check: { alignItems: "center", backgroundColor: colors.ink, borderRadius: 15, height: 25, justifyContent: "center", position: "absolute", right: -3, top: -3, width: 25 },
  title: { color: colors.ink, fontFamily: fonts.serif, fontSize: 18, marginTop: 10, textAlign: "center" },
  stamps: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 13 },
});
