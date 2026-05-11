import { PropsWithChildren } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MailClubProvider } from "@/src/state/MailClubContext";

export function AllProviders({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <MailClubProvider>{children}</MailClubProvider>
    </SafeAreaProvider>
  );
}
