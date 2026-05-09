import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Map, Send, Sparkles, User, Users } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const icons = { map: Map, constellation: Sparkles, send: Send, friends: Users, "my-card": User };
const labels = { map: "Map", constellation: "Constellation", send: "Send", friends: "Friends", "my-card": "My Card" };

export function BottomTabs({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const Icon = icons[route.name as keyof typeof icons];
        const label = labels[route.name as keyof typeof labels] ?? descriptors[route.key].options.title ?? route.name;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            onPress={() => navigation.navigate(route.name)}
            style={styles.item}
          >
            <View style={[styles.iconPill, focused && styles.iconPillActive]}>
              <Icon color={focused ? colors.ink : "#9A8D76"} fill={focused ? colors.ink : "none"} size={25} strokeWidth={1.7} />
            </View>
            <Text style={[styles.label, focused && styles.active]} numberOfLines={1}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabbar: {
    backgroundColor: "rgba(255, 248, 233, 0.96)",
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    flexDirection: "row",
    left: 0,
    paddingTop: 10,
    position: "absolute",
    right: 0,
  },
  item: { alignItems: "center", flex: 1, gap: 2 },
  iconPill: { alignItems: "center", borderRadius: 16, height: 35, justifyContent: "center", width: 44 },
  iconPillActive: { backgroundColor: "rgba(239, 226, 204, 0.86)" },
  label: { color: "#80745F", fontFamily: fonts.serif, fontSize: 12 },
  active: { color: colors.ink, fontWeight: "700" },
});
