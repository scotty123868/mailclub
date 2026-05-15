import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox, View } from "react-native";
// v0.7: gesture-handler is now a hard dependency (constellation pan/pinch,
// bottom-sheet on map). It needs to wrap the entire app root or any gesture
// inside any tab will silently no-op. Per react-native-gesture-handler 2.x
// docs: import side-effects + <GestureHandlerRootView> at root.
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Silence the dev-mode RedBox for the Stripe native-module load failure.
// `@stripe/stripe-react-native` constructs a NativeEventEmitter at module
// eval; on iOS-26 simulators and any environment where the native module
// didn't link, that throws synchronously. Our `loadStripeSdk()` catches
// the throw and degrades the Buy flow gracefully — but Expo's global
// error handler also surfaces the throw as a RedBox before our catch runs.
// In production this overlay doesn't exist, but in dev it blocks the
// screen. Suppressing the specific message here keeps dev usable.
LogBox.ignoreLogs([
  /NativeEventEmitter\(\)? requires a non-null argument/,
]);
import { Allura_400Regular } from "@expo-google-fonts/allura";
import { Caveat_500Medium, Caveat_700Bold } from "@expo-google-fonts/caveat";
import {
  CormorantGaramond_500Medium,
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
} from "@expo-google-fonts/cormorant-garamond";
import { Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { CelebrationOverlay } from "@/src/components/CelebrationOverlay";
import { WelcomeGate } from "@/src/components/WelcomeGate";
import { MailClubProvider } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";

/**
 * Root layout — intentionally does NOT mount StripeProvider here.
 *
 * Importing `@stripe/stripe-react-native` at module level constructs a
 * NativeEventEmitter against a native module that may be null (iOS 26
 * simulators, RN-version skew, etc.) — that crash kills the whole app
 * before any tab can render. We defer Stripe initialization to the
 * CreditsSheet, which wraps its body with `<StripeShell>` — a
 * lazy-loaded, crash-safe StripeProvider wrapper.
 *
 * The trade-off: the first time a user opens the Buy sheet, we pay a
 * one-time SDK init. Subsequent opens reuse the cached module. In
 * exchange, the app launches cleanly on any iOS version regardless of
 * Stripe native-module health.
 */
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MailClubProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
          <WelcomeGate />
          {/* v0.7.0.26: global celebration overlay. Triggered via
              MailClubContext.showCelebration(). The link-mode send
              path uses this to play the envelope-balloon animation
              AFTER the iOS share sheet returns sharedAction —
              fixes the build-39 bug where the celebration ran
              regardless of whether the share completed. */}
          <CelebrationOverlay />
        </MailClubProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
