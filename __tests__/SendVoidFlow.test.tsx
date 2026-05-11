import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import React from "react";
import { Alert } from "react-native";
import SendScreen from "@/app/(tabs)/send";
import { AllProviders } from "./test-utils";

const ALERT_SPY = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

beforeEach(() => {
  ALERT_SPY.mockClear();
  (Haptics.notificationAsync as jest.Mock).mockClear();
});

function renderSend() {
  return render(
    <AllProviders>
      <SendScreen />
    </AllProviders>
  );
}

describe("Send screen — AIPromptCard", () => {
  it("renders the Describe-your-postcard input + Imagine button", () => {
    const { getByText, getByTestId } = renderSend();
    expect(getByText("Describe your postcard")).toBeTruthy();
    expect(getByTestId("imagine-button")).toBeTruthy();
  });

  it("renders 4 quick suggestions", () => {
    const { getByText } = renderSend();
    expect(getByText("Birthday card for my mom who loves gardening")).toBeTruthy();
    expect(getByText("Just saying hi to my grandma")).toBeTruthy();
    expect(getByText("Thank-you to a friend who helped me move")).toBeTruthy();
    expect(getByText("Reconnect with my college roommate")).toBeTruthy();
  });

  it("disables Imagine button when input is empty", () => {
    const { getByTestId } = renderSend();
    const btn = getByTestId("imagine-button");
    expect(btn.props.accessibilityState?.disabled || btn.props["aria-disabled"]).toBeTruthy();
  });

  it("tapping a suggestion fills the message + sets format from the matched occasion", () => {
    const { getByText, queryAllByDisplayValue } = renderSend();
    fireEvent.press(getByText("Birthday card for my mom who loves gardening"));
    expect(queryAllByDisplayValue(/Mom/).length).toBeGreaterThan(0);
  });
});

describe("Send screen — OccasionGrid", () => {
  it("renders all 12 occasion tiles", () => {
    const { getByTestId } = renderSend();
    const ids = ["travel", "birthday", "party", "memory", "just-note", "saying-hi", "thank-you", "new-friend", "reconnect", "date", "ai-art", "void"];
    ids.forEach((id) => {
      expect(getByTestId(`occasion-${id}`)).toBeTruthy();
    });
  });

  it("tapping an occasion changes the message in the composer", () => {
    const { getByTestId, getByDisplayValue } = renderSend();
    fireEvent.press(getByTestId("occasion-thank-you"));
    expect(getByDisplayValue(/Thank you. Truly/i)).toBeTruthy();
  });

  it("tapping the void occasion switches recipient UI to anonymous mode", () => {
    const { getByTestId, getByText } = renderSend();
    fireEvent.press(getByTestId("occasion-void"));
    expect(getByText("Someone in Mail Club")).toBeTruthy();
  });

  it("Cancel button on void mode returns to normal recipient", () => {
    const { getByTestId, getByText, queryByText } = renderSend();
    fireEvent.press(getByTestId("occasion-void"));
    expect(getByText("Someone in Mail Club")).toBeTruthy();
    fireEvent.press(getByText("Cancel"));
    expect(queryByText("Someone in Mail Club")).toBeNull();
  });

  it("Send button label changes to 'Send into the void' in void mode", () => {
    const { getByTestId, getByText } = renderSend();
    fireEvent.press(getByTestId("occasion-void"));
    expect(getByText("Send into the void")).toBeTruthy();
  });

  it("Sending into the void fires success haptic and shows reply preview in modal", async () => {
    const { getByTestId, getByText } = renderSend();
    fireEvent.press(getByTestId("occasion-void"));
    await act(async () => {
      fireEvent.press(getByText("Send into the void"));
    });
    await waitFor(() => {
      expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
      expect(getByText(/Queued for a stranger/)).toBeTruthy();
    });
  });
});
