import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Allura_400Regular } from "@expo-google-fonts/allura";
import { Caveat_500Medium, Caveat_700Bold } from "@expo-google-fonts/caveat";
import {
  CormorantGaramond_500Medium,
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
} from "@expo-google-fonts/cormorant-garamond";
import { Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { MailClubProvider } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Allura_400Regular,
    Caveat_500Medium,
    Caveat_700Bold,
    CormorantGaramond_500Medium,
    CormorantGaramond_500Medium_Italic,
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  }

  return (
    <SafeAreaProvider>
      <MailClubProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </MailClubProvider>
    </SafeAreaProvider>
  );
}
