import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { OnboardingFreeCreditsBanner } from "@/src/components/OnboardingFreeCreditsBanner";
import { AllProviders } from "./test-utils";

function renderBanner() {
 return render(
 <AllProviders>
 <OnboardingFreeCreditsBanner />
 </AllProviders>
 );
}

describe("OnboardingFreeCreditsBanner", () => {
 it("renders when freeCreditsRemaining > 0 and intro not seen", async () => {
 const { findByTestId } = renderBanner();
 expect(await findByTestId("free-credits-banner")).toBeTruthy();
 });

 it("shows the correct free-credit count in the title", async () => {
 const { findByText } = renderBanner();
 // v0.7.0.29: FREE_CREDITS=1 → banner says "1 free stamp to start" (singular).
 expect(await findByText(/1 free stamp to start/i)).toBeTruthy();
 });

 it("dismisses on tap of the close button", async () => {
 const { findByTestId, queryByTestId } = renderBanner();
 const dismiss = await findByTestId("free-credits-banner-dismiss");
 await act(async () => {
 fireEvent.press(dismiss);
 });
 await waitFor(() => {
 expect(queryByTestId("free-credits-banner")).toBeNull();
 });
 });
});
