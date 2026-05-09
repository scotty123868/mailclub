import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MailClubProvider } from "@/src/state/MailClubContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <MailClubProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </MailClubProvider>
    </SafeAreaProvider>
  );
}
