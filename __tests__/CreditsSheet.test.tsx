import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { AllProviders } from "./test-utils";

describe("CreditsSheet", () => {
 it("renders nothing meaningful when not visible", () => {
 const { queryByText } = render(
 <AllProviders>
 <CreditsSheet visible={false} onClose={() => {}} />
 </AllProviders>
 );
 expect(queryByText("Buy stamps")).toBeNull();
 });

 it("renders the title, balance line, and both packs", () => {
 const { getByText, getByTestId } = render(
 <AllProviders>
 <CreditsSheet visible={true} onClose={() => {}} />
 </AllProviders>
 );
 expect(getByText("Buy stamps")).toBeTruthy();
 // v0.7.0.29: FREE_CREDITS=1 means initial balance is "1 stamp" (singular)
 // not "stamps" (plural). Match either form so the test survives future
 // tweaks to the starter balance.
 expect(getByText(/cards? in your pocket/)).toBeTruthy();
 expect(getByTestId("credits-pack-p5")).toBeTruthy();
 expect(getByTestId("credits-pack-p10")).toBeTruthy();
 expect(getByTestId("credits-pack-p25")).toBeTruthy();
 });

 it("does not render retired packs (p50)", () => {
 const { queryByTestId } = render(
 <AllProviders>
 <CreditsSheet visible={true} onClose={() => {}} />
 </AllProviders>
 );
 // Old p50 (50/$35) was retired in the Mail Club repricing.
 expect(queryByTestId("credits-pack-p50")).toBeNull();
 });

 it("features the 30-pack with a 'For the regulars' pill", () => {
 const { getByText } = render(
 <AllProviders>
 <CreditsSheet visible={true} onClose={() => {}} />
 </AllProviders>
 );
 expect(getByText("For the regulars")).toBeTruthy();
 });

 it("shows the per-card math on each pack", () => {
 const { getByText } = render(
 <AllProviders>
 <CreditsSheet visible={true} onClose={() => {}} />
 </AllProviders>
 );
 // Mail Club repricing: dollar amounts above $1.00, cents below.
 // p5: $5 / 4 = $1.25 per card
 expect(getByText(/\$1\.25 per card/)).toBeTruthy();
 // p10: $10 / 10 = $1 per card
 expect(getByText(/\$1 per card/)).toBeTruthy();
 // p25 featured: $25 / 30 = 83¢ per card (no USPS comparison anymore)
 expect(getByText(/83¢ per card/)).toBeTruthy();
 });

 it("shows the 'Stripe not configured' banner when key missing", () => {
 // Default test env has no stripePublishableKey set
 const { getByTestId } = render(
 <AllProviders>
 <CreditsSheet visible={true} onClose={() => {}} />
 </AllProviders>
 );
 expect(getByTestId("credits-stripe-missing")).toBeTruthy();
 });

 it("includes the sales-tax disclaimer", () => {
 const { getByText } = render(
 <AllProviders>
 <CreditsSheet visible={true} onClose={() => {}} />
 </AllProviders>
 );
 expect(
 getByText(/sales tax, calculated at checkout/i),
 ).toBeTruthy();
 });

 it("calls onClose when the X is tapped", () => {
 const onClose = jest.fn();
 const { getByTestId } = render(
 <AllProviders>
 <CreditsSheet visible={true} onClose={onClose} />
 </AllProviders>
 );
 fireEvent.press(getByTestId("credits-sheet-close"));
 expect(onClose).toHaveBeenCalled();
 });

 it("each pack has a Buy button (testID -buy)", () => {
 const { getByTestId } = render(
 <AllProviders>
 <CreditsSheet visible={true} onClose={() => {}} />
 </AllProviders>
 );
 expect(getByTestId("credits-pack-p5-buy")).toBeTruthy();
 expect(getByTestId("credits-pack-p25-buy")).toBeTruthy();
 });

 it("shows the new $5/$20 pricing", () => {
 const { getByText } = render(
 <AllProviders>
 <CreditsSheet visible={true} onClose={() => {}} />
 </AllProviders>
 );
 expect(getByText("$5")).toBeTruthy();
 expect(getByText("$20")).toBeTruthy();
 });
});
