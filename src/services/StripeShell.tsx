/**
 * StripeShell — lazy, crash-safe wrapper around `StripeProvider`.
 *
 * Why this exists: importing `@stripe/stripe-react-native` at module level
 * crashes the app on iOS 26 simulators and any environment where the native
 * module isn't loaded — the SDK constructs a NativeEventEmitter with a null
 * arg and throws synchronously. We can't have that at the root layout.
 *
 * StripeShell defers the require to runtime, catches the failure, and falls
 * back to rendering children without the provider. Anything inside that needs
 * Stripe (purchasePack) checks `loadStripeSdk()` and shows a degraded "Stripe
 * unavailable on this device" state when the SDK didn't load.
 *
 * Usage: wrap any subtree that needs `useStripe`, `initPaymentSheet`, or
 * `presentPaymentSheet`. The CreditsSheet modal does this. Do NOT wrap the
 * whole app — the root layout has to boot even if Stripe can't.
 */

import React, { ReactNode } from "react";
import { loadStripeSdk, STRIPE_PUBLISHABLE_KEY } from "./payments";

export function StripeShell({ children }: { children: ReactNode }) {
  const sdk = loadStripeSdk();
  if (!sdk) {
    // SDK failed to load (or returned without the expected exports).
    // Render children unchanged — any purchase attempt downstream will
    // bail out with reason: "unavailable" and show a friendly message.
    return <>{children}</>;
  }
  const { StripeProvider } = sdk;
  return (
    <StripeProvider
      publishableKey={STRIPE_PUBLISHABLE_KEY || "pk_test_placeholder"}
      merchantIdentifier="merchant.com.mailrooms.app"
    >
      {children}
    </StripeProvider>
  );
}
