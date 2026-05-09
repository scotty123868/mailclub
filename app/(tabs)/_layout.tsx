import { Tabs } from "expo-router";
import { BottomTabs } from "@/src/components/BottomTabs";

export default function TabLayout() {
  return (
    <Tabs
      initialRouteName="my-card"
      tabBar={(props) => <BottomTabs {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="map" options={{ title: "Map" }} />
      <Tabs.Screen name="constellation" options={{ title: "Constellation" }} />
      <Tabs.Screen name="send" options={{ title: "Send" }} />
      <Tabs.Screen name="friends" options={{ title: "Friends" }} />
      <Tabs.Screen name="my-card" options={{ title: "My Card" }} />
    </Tabs>
  );
}
