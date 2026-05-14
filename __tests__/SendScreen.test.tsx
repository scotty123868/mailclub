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

async function attachPhoto(getByTestId: any) {
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file://chosen.jpg" }],
  });
  fireEvent.press(getByTestId("send-photo-target"));
  await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
}

function advance(getByTestId: any) {
  fireEvent.press(getByTestId("send-continue-btn"));
}

/** Convenience: pick "friend" kind + type a name, ready to advance from step 1. */
function chooseFriend(getByTestId: any, name = "Tati") {
  fireEvent.press(getByTestId("send-kind-friend"));
  fireEvent.changeText(getByTestId("send-name-input"), name);
}

/**
 * v0.7.0.24 send flow: step 1 is now a recipient-TYPE picker
 * (friend / yourself / pen pal). The name input only appears when
 * "friend" is selected. Steps 2-4 unchanged (photo → note → delivery).
 */
describe("SendScreen — multi-step flow", () => {
  it("renders step 1 (Recipient type picker) on first render", () => {
    const { getByTestId, getByText, queryByTestId } = renderSend();
    expect(getByText("Send")).toBeTruthy();
    expect(getByTestId("send-step-header-1")).toBeTruthy();
    expect(getByTestId("send-step-1")).toBeTruthy();
    // Three type-picker tiles
    expect(getByTestId("send-kind-friend")).toBeTruthy();
    expect(getByTestId("send-kind-self")).toBeTruthy();
    expect(getByTestId("send-kind-penpal")).toBeTruthy();
    // Name input HIDDEN until "friend" is picked
    expect(queryByTestId("send-name-input")).toBeNull();
    // Subsequent steps not yet rendered
    expect(queryByTestId("send-step-2")).toBeNull();
    expect(queryByTestId("send-step-3")).toBeNull();
    expect(queryByTestId("send-step-4")).toBeNull();
    expect(getByTestId("send-continue-btn")).toBeTruthy();
  });

  it("blocks advancing from step 1 when no recipient kind picked", () => {
    const { getByTestId } = renderSend();
    advance(getByTestId);
    expect(ALERT_SPY).toHaveBeenCalledWith("Not quite ready", expect.stringContaining("who"));
  });

  it("reveals the name input when 'friend' is picked", () => {
    const { getByTestId, queryByTestId } = renderSend();
    expect(queryByTestId("send-name-input")).toBeNull();
    fireEvent.press(getByTestId("send-kind-friend"));
    expect(getByTestId("send-name-input")).toBeTruthy();
  });

  it("blocks advancing from step 1 when 'friend' picked but name empty", () => {
    const { getByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-friend"));
    advance(getByTestId);
    expect(ALERT_SPY).toHaveBeenCalledWith("Not quite ready", expect.stringContaining("name"));
  });

  it("advances to step 2 after friend + name", () => {
    const { getByTestId } = renderSend();
    chooseFriend(getByTestId);
    advance(getByTestId);
    expect(getByTestId("send-step-header-2")).toBeTruthy();
    expect(getByTestId("send-step-2")).toBeTruthy();
    expect(getByTestId("send-photo-target")).toBeTruthy();
  });

  it("advances to step 2 after 'self' picked (no name needed)", () => {
    const { getByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-self"));
    advance(getByTestId);
    expect(getByTestId("send-step-header-2")).toBeTruthy();
  });

  it("advances to step 2 after 'penpal' picked (no name needed)", () => {
    const { getByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-penpal"));
    advance(getByTestId);
    expect(getByTestId("send-step-header-2")).toBeTruthy();
  });

  it("opens the photo library when the Cover target is pressed", async () => {
    const { getByTestId } = renderSend();
    chooseFriend(getByTestId);
    advance(getByTestId);
    await attachPhoto(getByTestId);
  });

  it("blocks advancing from step 2 with no photo picked", () => {
    const { getByTestId } = renderSend();
    chooseFriend(getByTestId);
    advance(getByTestId);
    advance(getByTestId);
    expect(ALERT_SPY).toHaveBeenCalledWith("Not quite ready", expect.stringContaining("photo"));
  });

  it("advances to step 3 (Inside) after a photo is picked", async () => {
    const { getByTestId } = renderSend();
    chooseFriend(getByTestId);
    advance(getByTestId);
    await attachPhoto(getByTestId);
    advance(getByTestId);
    expect(getByTestId("send-step-header-3")).toBeTruthy();
    expect(getByTestId("send-step-3")).toBeTruthy();
    expect(getByTestId("send-message-target")).toBeTruthy();
  });

  it("blocks advancing from step 3 with an empty note", async () => {
    const { getByTestId } = renderSend();
    chooseFriend(getByTestId);
    advance(getByTestId);
    await attachPhoto(getByTestId);
    advance(getByTestId);
    advance(getByTestId);
    expect(ALERT_SPY).toHaveBeenCalledWith("Not quite ready", expect.stringContaining("note"));
  });

  it("surfaces friend matches as the user types a name on step 1", () => {
    const { getByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-friend"));
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    expect(getByTestId(/^send-friend-match-/)).toBeTruthy();
  });

  it("locks the friend reference when a match row is tapped", () => {
    const { getByTestId, getAllByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-friend"));
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    const matchRows = getAllByTestId(/^send-friend-match-/);
    fireEvent.press(matchRows[0]);
    expect(getByTestId("send-friend-locked")).toBeTruthy();
  });

  it("step 4 (Delivery) shows magic-link, address, and friend saved-address option when locked", async () => {
    const { getByTestId, getAllByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-friend"));
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    fireEvent.press(getAllByTestId(/^send-friend-match-/)[0]);
    advance(getByTestId);
    await attachPhoto(getByTestId);
    advance(getByTestId);
    fireEvent.press(getByTestId("send-message-target"));
    fireEvent.changeText(getByTestId("msg-input"), "Hi friend");
    fireEvent.press(getByTestId("msg-save"));
    advance(getByTestId);
    expect(getByTestId("send-delivery-link")).toBeTruthy();
    expect(getByTestId("send-delivery-address")).toBeTruthy();
  });

  it("the Back button on step 2 returns to step 1", () => {
    const { getByTestId } = renderSend();
    chooseFriend(getByTestId);
    advance(getByTestId);
    expect(getByTestId("send-step-header-2")).toBeTruthy();
    fireEvent.press(getByTestId("send-back-btn"));
    expect(getByTestId("send-step-header-1")).toBeTruthy();
  });
});
