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
    expect(getByText(/stamps in your pocket/)).toBeTruthy();
    expect(getByTestId("credits-pack-p5")).toBeTruthy();
    expect(getByTestId("credits-pack-p25")).toBeTruthy();
  });

  it("does not render retired packs (p10, p50)", () => {
    const { queryByTestId } = render(
      <AllProviders>
        <CreditsSheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    expect(queryByTestId("credits-pack-p10")).toBeNull();
    expect(queryByTestId("credits-pack-p50")).toBeNull();
  });

  it("features the 25-pack with a 'Less than a stamp' pill", () => {
    const { getByText } = render(
      <AllProviders>
        <CreditsSheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    expect(getByText("Less than a stamp")).toBeTruthy();
  });

  it("shows the per-stamp math on each pack", () => {
    const { getByText } = render(
      <AllProviders>
        <CreditsSheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    // 5-pack at $5 → 100¢ per stamp
    expect(getByText(/100¢ per stamp/)).toBeTruthy();
    // 25-pack at $20 → 80¢ per stamp, with USPS comparison
    expect(getByText(/80¢ per stamp · the USPS Forever Stamp is 82¢/)).toBeTruthy();
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
