/**
 * v0.7.0.49: shared empty-state primitive. Each tab used to have its
 * own treatment (sage-rgba card on friends, backdrop pills on map,
 * italic-only line on constellation, dashed-tile-with-+ on journal).
 *
 * This primitive is for STATES, not for empty illustrations. Use it
 * when a list/grid has no data AND there's a clear action the user
 * should take to populate it.
 *
 * Convention:
 *   - title is a sentence ("Mail a card to see your friends here.")
 *   - subtitle expands with a hint, optional
 *   - cta is a Pressable wrapped in this; click navigates to the next
 *     step. Optional — some empty states are read-only.
 */
import { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

type EmptyStateProps = {
  title: string;
  subtitle?: string;
  cta?: { label: string; onPress: () => void };
  icon?: ReactNode;
  testID?: string;
};

export function EmptyState({ title, subtitle, cta, icon, testID }: EmptyStateProps) {
  return (
    <View style={styles.root} testID={testID}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {cta ? (
        <Pressable
          onPress={cta.onPress}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel={cta.label}
        >
          <Text style={styles.ctaText}>{cta.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: "rgba(155,175,155,0.18)",
    borderColor: "rgba(155,175,155,0.40)",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 28,
  },
  icon: {
    marginBottom: 14,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 17,
    textAlign: "center",
  },
  subtitle: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 6,
    maxWidth: 320,
    textAlign: "center",
  },
  cta: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    marginTop: 18,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaText: {
    color: colors.paper,
    fontFamily: fonts.serifSemi,
    fontSize: 14,
  },
});
