import { Gift, X } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function OnboardingFreeCreditsBanner() {
  const { freeCreditsRemaining, hasSeenFreeCreditsIntro, markFreeCreditsIntroSeen } = useMailClub();

  if (hasSeenFreeCreditsIntro) return null;
  if (freeCreditsRemaining <= 0) return null;

  return (
    <View style={styles.banner} testID="free-credits-banner">
      <View style={styles.iconWrap}>
        <Gift color={colors.postalRed} size={20} strokeWidth={1.7} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {freeCreditsRemaining} free {freeCreditsRemaining === 1 ? "card" : "cards"} to start
        </Text>
        <Text style={styles.body}>A photo, a note, a friend. Mail one on the house.</Text>
      </View>
      <Pressable
        onPress={() => markFreeCreditsIntroSeen()}
        style={styles.close}
        testID="free-credits-banner-dismiss"
        accessibilityRole="button"
        accessibilityLabel="Dismiss free credits banner"
      >
        <X color={colors.ink} size={18} strokeWidth={1.6} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: "center", backgroundColor: "rgba(217,180,110,0.18)", borderColor: "rgba(217,180,110,0.6)", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 12, padding: 12 },
  iconWrap: { alignItems: "center", backgroundColor: "rgba(184,74,58,0.12)", borderRadius: 22, height: 40, justifyContent: "center", width: 40 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 15 },
  body: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, lineHeight: 16, marginTop: 1 },
  close: { padding: 4 },
});
