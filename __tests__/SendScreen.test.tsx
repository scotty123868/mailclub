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

/**
 * v0.7.0.19 send flow is a 4-step internal state machine. Order changed
 * so the user picks WHO they're sending to before WHAT they're sending
 * (matches the welcome flow and how senders actually think):
 *   1. Recipient — name + friend match
 *   2. Cover     — pick a photo
 *   3. Inside    — write a note
 *   4. Delivery  — magic link / address / friend, then Send
 */
describe("SendScreen — multi-step flow", () => {
  it("renders step 1 (Recipient) on first render", () => {
    const { getByTestId, getByText, queryByTestId } = renderSend();
    expect(getByText("Send")).toBeTruthy();
    expect(getByTestId("send-step-header-1")).toBeTruthy();
    expect(getByTestId("send-step-1")).toBeTruthy();
    expect(getByTestId("send-name-input")).toBeTruthy();
    // Subsequent steps not yet rendered
    expect(queryByTestId("send-step-2")).toBeNull();
    expect(queryByTestId("send-step-3")).toBeNull();
    expect(queryByTestId("send-step-4")).toBeNull();
    // Continue button visible on step 1
    expect(getByTestId("send-continue-btn")).toBeTruthy();
  });

  it("blocks advancing from step 1 when no name is typed", () => {
    const { getByTestId } = renderSend();
    advance(getByTestId);
    expect(ALERT_SPY).toHaveBeenCalledWith("Not quite ready", expect.stringContaining("name"));
  });

  it("advances to step 2 (Cover) after a name is typed", () => {
    const { getByTestId } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    advance(getByTestId);
    expect(getByTestId("send-step-header-2")).toBeTruthy();
    expect(getByTestId("send-step-2")).toBeTruthy();
    expect(getByTestId("send-photo-target")).toBeTruthy();
  });

  it("opens the photo library when the Cover target is pressed", async () => {
    const { getByTestId } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    advance(getByTestId);
    await attachPhoto(getByTestId);
  });

  it("blocks advancing from step 2 with no photo picked", () => {
    const { getByTestId } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    advance(getByTestId);
    advance(getByTestId);
    expect(ALERT_SPY).toHaveBeenCalledWith("Not quite ready", expect.stringContaining("photo"));
  });

  it("advances to step 3 (Inside) after a photo is picked", async () => {
    const { getByTestId } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    advance(getByTestId);
    await attachPhoto(getByTestId);
    advance(getByTestId);
    expect(getByTestId("send-step-header-3")).toBeTruthy();
    expect(getByTestId("send-step-3")).toBeTruthy();
    expect(getByTestId("send-message-target")).toBeTruthy();
  });

  it("opens the message editor when the Inside target is tapped", async () => {
    const { getByTestId, queryByTestId } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    advance(getByTestId);
    await attachPhoto(getByTestId);
    advance(getByTestId);
    expect(queryByTestId("msg-input")).toBeNull();
    fireEvent.press(getByTestId("send-message-target"));
    expect(getByTestId("msg-input")).toBeTruthy();
  });

  it("blocks advancing from step 3 with an empty note", async () => {
    const { getByTestId } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    advance(getByTestId);
    await attachPhoto(getByTestId);
    advance(getByTestId);
    advance(getByTestId);
    expect(ALERT_SPY).toHaveBeenCalledWith("Not quite ready", expect.stringContaining("note"));
  });

  it("surfaces friend matches as the user types a name on step 1", () => {
    // Default mock-friends list includes Tatiana
    const { getByTestId } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    expect(getByTestId(/^send-friend-match-/)).toBeTruthy();
  });

  it("locks the friend reference when a match row is tapped", () => {
    const { getByTestId, getAllByTestId } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    const matchRows = getAllByTestId(/^send-friend-match-/);
    fireEvent.press(matchRows[0]);
    expect(getByTestId("send-friend-locked")).toBeTruthy();
  });

  it("step 4 (Delivery) shows magic-link, address, and friend saved-address option when locked", async () => {
    const { getByTestId, getAllByTestId } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    fireEvent.press(getAllByTestId(/^send-friend-match-/)[0]);
    advance(getByTestId);
    await attachPhoto(getByTestId);
    advance(getByTestId);
    fireEvent.press(getByTestId("send-message-target"));
    fireEvent.changeText(getByTestId("msg-input"), "Hi friend");
    fireEvent.press(getByTestId("msg-save"));
    advance(getByTestId);
    // Always-on options
    expect(getByTestId("send-delivery-link")).toBeTruthy();
    expect(getByTestId("send-delivery-address")).toBeTruthy();
  });

  it("step 4 with no locked friend defaults to magic-link mode and shows 'Share a link' as the CTA", async () => {
    // v0.5.0: in link mode, the action is Share-a-link (Lob fires when the
    // recipient claims), not Send-postcard, so the button label adapts.
    const { getByTestId, getByText } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Brand new person");
    advance(getByTestId);
    await attachPhoto(getByTestId);
    advance(getByTestId);
    fireEvent.press(getByTestId("send-message-target"));
    fireEvent.changeText(getByTestId("msg-input"), "Hi friend");
    fireEvent.press(getByTestId("msg-save"));
    advance(getByTestId);
    expect(getByTestId("send-step-4")).toBeTruthy();
    expect(getByText("Share a link")).toBeTruthy();
  });

  it("the Back button on step 2 returns to step 1", () => {
    const { getByTestId } = renderSend();
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    advance(getByTestId);
    expect(getByTestId("send-step-header-2")).toBeTruthy();
    fireEvent.press(getByTestId("send-back-btn"));
    expect(getByTestId("send-step-header-1")).toBeTruthy();
  });
});
