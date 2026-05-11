import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
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

  it("renders the title, balance line, and all 4 credit packs", () => {
    const { getByText, getByTestId } = render(
      <AllProviders>
        <CreditsSheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    expect(getByText("Buy credits")).toBeTruthy();
    expect(getByText(/1 credit = \$1/)).toBeTruthy();
    expect(getByTestId("credits-buy-p5")).toBeTruthy();
    expect(getByTestId("credits-buy-p10")).toBeTruthy();
    expect(getByTestId("credits-buy-p25")).toBeTruthy();
    expect(getByTestId("credits-buy-p50")).toBeTruthy();
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

  it("tapping Buy on a pack opens the IAP-stub alert", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByTestId } = render(
      <AllProviders>
        <CreditsSheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    await act(async () => {
      fireEvent.press(getByTestId("credits-buy-p10"));
    });
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Apple IAP not connected", expect.any(String), expect.any(Array));
    });
    alertSpy.mockRestore();
  });
});
