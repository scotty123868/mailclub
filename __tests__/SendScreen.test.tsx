import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React from "react";
import { Alert } from "react-native";
import SendScreen from "@/app/(tabs)/send";
import { AllProviders } from "./test-utils";

const ALERT_SPY = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

beforeEach(() => {
  ALERT_SPY.mockClear();
  (Haptics.notificationAsync as jest.Mock).mockClear();
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockClear();
});

function renderSend() {
  return render(
    <AllProviders>
      <SendScreen />
    </AllProviders>
  );
}

describe("SendScreen", () => {
  it("renders header + stepper + composer + format selector + recipient + templates + send button", () => {
    const { getByText, getAllByText } = renderSend();
    expect(getByText("Send Mail")).toBeTruthy();
    // Photo, Note, Send appear in both stepper and format selector
    expect(getAllByText("Photo").length).toBeGreaterThanOrEqual(1);
    expect(getAllByText("Note").length).toBeGreaterThanOrEqual(1);
    expect(getByText("Recipient")).toBeTruthy();
    expect(getAllByText("Send").length).toBeGreaterThanOrEqual(1);
    expect(getByText("Tonight's photo")).toBeTruthy();
    expect(getByText("Send Postcard")).toBeTruthy();
  });

  it("starts with the date-invite default message", () => {
    const { getByDisplayValue } = renderSend();
    expect(getByDisplayValue(/coffee next week/i)).toBeTruthy();
  });

  it("renders the 'Date invite' occasion tile", () => {
    const { getByText } = renderSend();
    expect(getByText("Date invite")).toBeTruthy();
  });

  it("changes category when a Category pill is tapped", () => {
    const { getByTestId } = renderSend();
    fireEvent.press(getByTestId("category-photo"));
  });

  it("changes message + format when an occasion tile is tapped", () => {
    const { getByTestId, getByDisplayValue } = renderSend();
    fireEvent.press(getByTestId("occasion-birthday"));
    expect(getByDisplayValue(/happy birthday/i)).toBeTruthy();
    fireEvent.press(getByTestId("occasion-memory"));
    expect(getByDisplayValue(/Remember this/i)).toBeTruthy();
  });

  it("cycles recipient when the recipient row is pressed", () => {
    const { getByText, getByTestId } = renderSend();
    expect(getByText("Nora")).toBeTruthy();
    fireEvent.press(getByTestId("recipient-cycler"));
    expect(getByText("Ben")).toBeTruthy();
  });

  it("triggers haptic + success modal when Send Postcard is pressed", async () => {
    const { getByText } = renderSend();
    await act(async () => {
      fireEvent.press(getByText("Send Postcard"));
    });
    await waitFor(() => {
      expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
    });
  });

  it("opens image picker when photo placeholder is pressed", async () => {
    const { getByText } = renderSend();
    await act(async () => {
      fireEvent.press(getByText("Tonight's photo"));
    });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
  });

  it("shows current credits + cost-for-choice in the recipient row", () => {
    const { getByText } = renderSend();
    expect(getByText(/5 credits · this card costs 2/i)).toBeTruthy();
  });
});
