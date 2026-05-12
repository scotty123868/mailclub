import { fireEvent, render, waitFor } from "@testing-library/react-native";
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
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
});

function renderSend() {
  return render(
    <AllProviders>
      <SendScreen />
    </AllProviders>,
  );
}

describe("SendScreen — simplified MVP flow", () => {
  it("renders the flip card, photo + note buttons, recipient picker, and send button", () => {
    const { getByText, getByTestId } = renderSend();
    expect(getByText("Send Mail")).toBeTruthy();
    expect(getByTestId("postcard-flip")).toBeTruthy();
    expect(getByTestId("compose-photo-btn")).toBeTruthy();
    expect(getByTestId("compose-note-btn")).toBeTruthy();
    expect(getByTestId("recipient-segment-friend")).toBeTruthy();
    expect(getByTestId("recipient-segment-ask")).toBeTruthy();
    expect(getByTestId("recipient-segment-address")).toBeTruthy();
    expect(getByText("Send postcard")).toBeTruthy();
  });

  it("opens the photo library when the Photo button is pressed", async () => {
    const { getByTestId } = renderSend();
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file://chosen.jpg" }],
    });
    fireEvent.press(getByTestId("compose-photo-btn"));
    await waitFor(() => {
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    });
  });

  it("opens the message editor sheet when the Note button is pressed", () => {
    const { getByTestId, queryByTestId } = renderSend();
    expect(queryByTestId("msg-input")).toBeNull();
    fireEvent.press(getByTestId("compose-note-btn"));
    expect(getByTestId("msg-input")).toBeTruthy();
  });

  it("switches recipient mode when a different segment is pressed", () => {
    const { getByTestId, queryByTestId } = renderSend();
    expect(queryByTestId("recipient-link")).toBeNull();
    fireEvent.press(getByTestId("recipient-segment-ask"));
    expect(getByTestId("recipient-link")).toBeTruthy();
    fireEvent.press(getByTestId("recipient-segment-address"));
    expect(getByTestId("recipient-address")).toBeTruthy();
  });

  it("blocks sending when there is no photo and prompts to choose one", () => {
    const { getByText } = renderSend();
    fireEvent.press(getByText("Send postcard"));
    expect(ALERT_SPY).toHaveBeenCalledWith("Not quite ready", expect.stringContaining("photo"));
  });

  it("blocks sending when the address fields are incomplete", async () => {
    const { getByTestId, getByText, queryByTestId } = renderSend();
    // Add a photo
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file://chosen.jpg" }],
    });
    fireEvent.press(getByTestId("compose-photo-btn"));
    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
    // Add a note
    fireEvent.press(getByTestId("compose-note-btn"));
    fireEvent.changeText(getByTestId("msg-input"), "Hi friend");
    fireEvent.press(getByTestId("msg-save"));
    await waitFor(() => expect(queryByTestId("msg-input")).toBeNull());
    // Switch to address mode with empty form
    fireEvent.press(getByTestId("recipient-segment-address"));
    fireEvent.press(getByText("Send postcard"));
    expect(ALERT_SPY).toHaveBeenCalledWith("Not quite ready", expect.stringContaining("address"));
  });

  it("cycles through saved friends when the friend card is tapped", () => {
    // The default mock-friends list starts with Tatiana. Tap to cycle → Alex.
    const { getByTestId, getAllByText } = renderSend();
    expect(getAllByText("Tatiana").length).toBeGreaterThan(0);
    fireEvent.press(getByTestId("recipient-friend-cycler"));
    expect(getAllByText("Alex").length).toBeGreaterThan(0);
  });
});
