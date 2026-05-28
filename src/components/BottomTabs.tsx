import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Map, Send, Sparkles, User, Users } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * v0.7 tab bar: five slots, but the middle slot is a centered raised
 * floating action button (Send). NOT a regular tab.
 *
 * Order, left to right: Map · Constellation · [Send FAB] · Friends · My Card
 *
 * Why FAB instead of a tab: Send is the verb the whole app exists for.
 * Making it the loudest, biggest, never-moves button on every screen is
 * how Snapchat and Instagram solved the "the create action is the app"
 * problem. Four ambient tabs surround it, two on each side.
 *
 * Render strategy: the underlying expo-router still has 5 tab screens
 * (map / constellation / send / friends / my-card). This component
 * reads the route state and renders the four ambient routes as normal
 * tabs while replacing the "send" entry with a raised FAB. Tapping the
 * FAB routes to /send, same as the original tab. Navigation contract
 * unchanged.
 */
const ICON_BY_ROUTE = {
 map: Map,
 constellation: Sparkles,
 send: Send,
 friends: Users,
 "my-card": User,
} as const;

const LABEL_BY_ROUTE = {
 map: "Map",
 constellation: "Constellation",
 send: "Send",
 friends: "Friends",
 "my-card": "My Card",
} as const;

// The visual order we want, regardless of the order expo-router happens
// to register the screens in.
const ORDER = ["map", "constellation", "send", "friends", "my-card"] as const;

export function BottomTabs({ state, navigation }: BottomTabBarProps) {
 const insets = useSafeAreaInsets();

 // Re-sort routes into our intended display order. Any route not in
 // ORDER (shouldn't happen with current tabs but stays defensive) goes
 // to the end.
 const orderedRoutes = [...state.routes].sort((a, b) => {
 const ai = ORDER.indexOf(a.name as typeof ORDER[number]);
 const bi = ORDER.indexOf(b.name as typeof ORDER[number]);
 if (ai === -1) return 1;
 if (bi === -1) return -1;
 return ai - bi;
 });

 return (
 <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
 {orderedRoutes.map((route) => {
 const focused = state.index === state.routes.findIndex((r) => r.key === route.key);
 const Icon = ICON_BY_ROUTE[route.name as keyof typeof ICON_BY_ROUTE] ?? User;
 const label = LABEL_BY_ROUTE[route.name as keyof typeof LABEL_BY_ROUTE] ?? route.name;

 // The Send tab renders as a raised, centered FAB. Same nav
 // target, different presentation. Tapping it still routes to
 // /send so all existing send-flow logic continues to work.
 if (route.name === "send") {
 return (
 <View key={route.key} style={styles.fabSlot}>
 <Pressable
 accessibilityRole="button"
 accessibilityLabel="Mail a card"
 accessibilityState={focused ? { selected: true } : {}}
 testID="bottom-tab-send"
 onPress={() => navigation.navigate(route.name)}
 style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
 hitSlop={4}
 >
 <Send color={colors.paper} size={26} strokeWidth={1.9} />
 </Pressable>
 </View>
 );
 }

 return (
 <Pressable
 key={route.key}
 accessibilityRole="button"
 accessibilityLabel={label}
 accessibilityState={focused ? { selected: true } : {}}
 testID={`bottom-tab-${route.name}`}
 onPress={() => navigation.navigate(route.name)}
 style={styles.item}
 >
 <View style={[styles.iconPill, focused && styles.iconPillActive]}>
 <Icon
 color={focused ? colors.ink : "#9A8D76"}
 fill={focused ? colors.ink : "none"}
 size={25}
 strokeWidth={1.7}
 />
 </View>
 <Text style={[styles.label, focused && styles.active]} numberOfLines={1}>
 {label}
 </Text>
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
 alignItems: "flex-start",
 },
 item: { alignItems: "center", flex: 1, gap: 2 },
 iconPill: {
 alignItems: "center",
 borderRadius: 16,
 height: 35,
 justifyContent: "center",
 width: 44,
 },
 iconPillActive: { backgroundColor: "rgba(239, 226, 204, 0.86)" },
 label: { color: "#80745F", fontFamily: fonts.serif, fontSize: 12 },
 active: { color: colors.ink, fontFamily: fonts.serifSemi },

 // FAB centered + raised. Slot keeps flex:1 like ambient tabs so the
 // spacing across the bar stays even, but the actual button is bigger
 // and pulled up above the tab-bar plane by negative marginTop.
 fabSlot: {
 alignItems: "center",
 flex: 1,
 justifyContent: "flex-start",
 },
 fab: {
 width: 58,
 height: 58,
 borderRadius: 100,
 backgroundColor: colors.ink,
 alignItems: "center",
 justifyContent: "center",
 marginTop: -22,
 shadowColor: "#000",
 shadowOpacity: 0.22,
 shadowOffset: { width: 0, height: 4 },
 shadowRadius: 10,
 elevation: 8,
 borderWidth: 3,
 borderColor: "rgba(255, 248, 233, 0.96)",
 },
 fabPressed: {
 opacity: 0.85,
 transform: [{ scale: 0.96 }],
 },
});
