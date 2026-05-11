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
    expect(queryByText("Buy credits")).toBeNull();
  });

  it("renders the title, balance line, all 4 packs, and the 'coming soon' banner", () => {
    const { getByText, getByTestId } = render(
      <AllProviders>
        <CreditsSheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    expect(getByText("Buy credits")).toBeTruthy();
    expect(getByText(/1 credit = \$1/)).toBeTruthy();
    expect(getByTestId("credits-coming-soon")).toBeTruthy();
    expect(getByTestId("credits-pack-p5")).toBeTruthy();
    expect(getByTestId("credits-pack-p10")).toBeTruthy();
    expect(getByTestId("credits-pack-p25")).toBeTruthy();
    expect(getByTestId("credits-pack-p50")).toBeTruthy();
  });

  it("renders the explainer rows for all 4 card categories", () => {
    const { getByText } = render(
      <AllProviders>
        <CreditsSheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    expect(getByText("Handwritten note")).toBeTruthy();
    expect(getByText("Photo postcard")).toBeTruthy();
    expect(getByText("Place postcard")).toBeTruthy();
    expect(getByText("Custom art card")).toBeTruthy();
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

  it("packs are read-only (no purchase action) — store is gated until IAP wires", () => {
    const { queryByTestId } = render(
      <AllProviders>
        <CreditsSheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    // The old credits-buy-* testIDs no longer exist — purchase flow is gated.
    expect(queryByTestId("credits-buy-p5")).toBeNull();
    expect(queryByTestId("credits-buy-p10")).toBeNull();
    expect(queryByTestId("credits-buy-p25")).toBeNull();
    expect(queryByTestId("credits-buy-p50")).toBeNull();
  });
});
