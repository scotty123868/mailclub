import { Cake, Camera, Clock, FileText, Hand, Heart, HeartHandshake, Palette, PartyPopper, Plane, Send, Sparkles, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { OCCASIONS, type Occasion } from "@/src/data/occasions";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";

const ICONS: Record<string, LucideIcon> = {
  Plane,
  Cake,
  PartyPopper,
  Camera,
  FileText,
  Hand,
  Heart,
  Sparkles,
  Clock,
  HeartHandshake,
  Palette,
  Send,
};

const TONE_COLORS: Record<Occasion["tone"], { bg: string; ink: string; accent: string }> = {
  red: { bg: "rgba(184,74,58,0.07)", ink: "#7B2D24", accent: colors.postalRed },
  sage: { bg: "rgba(155,175,155,0.18)", ink: "#3F5239", accent: "#5F7559" },
  blue: { bg: "rgba(60,110,143,0.1)", ink: "#1F4660", accent: colors.postalBlue },
  gold: { bg: "rgba(217,180,110,0.18)", ink: "#5F4416", accent: "#9B7331" },
  night: { bg: "rgba(17,26,51,0.9)", ink: "#F2E2B6", accent: "#D9B46E" },
};

export function OccasionGrid({
  selectedId,
  onSelect,
}: {
  selectedId: Occasion["id"] | null;
  onSelect: (occasion: Occasion) => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Or pick an occasion</Text>
        <Text style={styles.headingMeta}>{OCCASIONS.length} ideas</Text>
      </View>

      <View style={styles.grid}>
        {OCCASIONS.map((occ) => {
          const Icon = ICONS[occ.icon] ?? FileText;
          const colorPair = TONE_COLORS[occ.tone];
          const active = selectedId === occ.id;
          const isVoid = occ.special === "random-recipient";
          return (
            <Pressable
              key={occ.id}
              onPress={() => onSelect(occ)}
              style={[styles.tile, { backgroundColor: colorPair.bg, borderColor: active ? colorPair.accent : colors.line }, active && styles.activeTile]}
              testID={`occasion-${occ.id}`}
            >
              <View style={[styles.iconChip, { backgroundColor: colorPair.accent }]}>
                <Icon color={isVoid ? "#F2E2B6" : "#FFF8E9"} size={16} strokeWidth={1.7} />
              </View>
              <Text style={[styles.tileTitle, { color: colorPair.ink }]} numberOfLines={2}>{occ.title}</Text>
              <Text style={[styles.tileBlurb, { color: colorPair.ink }]} numberOfLines={1}>{occ.blurb}</Text>
              {isVoid && <Text style={[styles.tileTag, { color: colorPair.accent }]}>RANDOM</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  headerRow: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between" },
  heading: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 20 },
  headingMeta: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { borderRadius: 10, borderWidth: 1, gap: 4, minHeight: 90, paddingHorizontal: 10, paddingVertical: 10, width: "48.5%" },
  activeTile: { borderWidth: 2 },
  iconChip: { alignItems: "center", borderRadius: 8, height: 28, justifyContent: "center", width: 28 },
  tileTitle: { fontFamily: fonts.serifSemi, fontSize: 15, lineHeight: 18, marginTop: 4 },
  tileBlurb: { fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 14, opacity: 0.8 },
  tileTag: { fontFamily: fonts.sansBold, fontSize: 9, letterSpacing: 0.6, marginTop: 2 },
});
