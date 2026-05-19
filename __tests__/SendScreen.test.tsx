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

/** Friend flow: pick friend kind → advance to name page → type name. */
function pickFriendThenName(getByTestId: any, name = "Tati") {
  fireEvent.press(getByTestId("send-kind-friend"));
  advance(getByTestId);
  fireEvent.changeText(getByTestId("send-name-input"), name);
}

/**
 * v0.7.0.25 send flow:
 *   • Step 1 (always): TYPE picker (friend / yourself / pen pal).
 *   • Friend flow: type → NAME → cover → inside → delivery   (5 steps)
 *   • Self flow:   type → [selfAddress*] → cover → inside     (3-4 steps)
 *       (*selfAddress only on first-time self sends; cached after.)
 *   • Penpal flow: type → cover → inside                       (3 steps)
 *       (no delivery — card goes to a random network user.)
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
    // Name input is NOT on step 1 anymore — it lives on its own page now.
    expect(queryByTestId("send-name-input")).toBeNull();
    // Subsequent steps not yet rendered
    expect(queryByTestId("send-step-name")).toBeNull();
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

  it("advances to the Name step after 'friend' is picked", () => {
    const { getByTestId, queryByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-friend"));
    expect(queryByTestId("send-name-input")).toBeNull(); // still on type page
    advance(getByTestId);
    expect(getByTestId("send-step-name")).toBeTruthy();
    expect(getByTestId("send-name-input")).toBeTruthy();
  });

  it("blocks advancing from the Name step when name is empty", () => {
    const { getByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-friend"));
    advance(getByTestId);
    advance(getByTestId);
    expect(ALERT_SPY).toHaveBeenCalledWith("Not quite ready", expect.stringContaining("name"));
  });

  it("advances to Cover after friend + name + continue", () => {
    const { getByTestId } = renderSend();
    pickFriendThenName(getByTestId);
    advance(getByTestId);
    expect(getByTestId("send-step-2")).toBeTruthy();
    expect(getByTestId("send-photo-target")).toBeTruthy();
  });

  it("self flow: advances type → selfAddress (first time)", () => {
    const { getByTestId, queryByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-self"));
    advance(getByTestId);
    // First-time self sender: address step appears.
    expect(getByTestId("send-step-self-address")).toBeTruthy();
    // Not the friend name step.
    expect(queryByTestId("send-name-input")).toBeNull();
  });

  it("penpal flow: advances type → cover directly (no name step, no delivery)", () => {
    const { getByTestId, queryByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-penpal"));
    advance(getByTestId);
    expect(getByTestId("send-step-2")).toBeTruthy();
    expect(getByTestId("send-photo-target")).toBeTruthy();
    // No friend name step, no delivery step in penpal flow.
    expect(queryByTestId("send-name-input")).toBeNull();
  });

  it("opens the photo library when the Cover target is pressed", async () => {
    const { getByTestId } = renderSend();
    pickFriendThenName(getByTestId);
    advance(getByTestId);
    await attachPhoto(getByTestId);
  });

  // v0.7.0.49 (Codex P2): photo is now OPTIONAL. The Cover step lets
  // users advance text-only — the front renders a cream Mailroom
  // placeholder, the back's handwriting carries the card. This test
  // used to assert the "must pick a photo" gate; that gate was removed.
  it("advances from Cover with no photo picked (text-only flow)", () => {
    const { getByTestId } = renderSend();
    pickFriendThenName(getByTestId);
    advance(getByTestId);
    advance(getByTestId);
    expect(getByTestId("send-step-3")).toBeTruthy();
    expect(getByTestId("send-message-target")).toBeTruthy();
    expect(ALERT_SPY).not.toHaveBeenCalledWith("Not quite ready", expect.stringContaining("photo"));
  });

  it("advances to Inside after a photo is picked", async () => {
    const { getByTestId } = renderSend();
    pickFriendThenName(getByTestId);
    advance(getByTestId);
    await attachPhoto(getByTestId);
    advance(getByTestId);
    expect(getByTestId("send-step-3")).toBeTruthy();
    expect(getByTestId("send-message-target")).toBeTruthy();
  });

  // v0.7.0.50: empty Inside is blocked only when there's nothing on the
  // front either. Without a photo (text-only skip from Cover), the note
  // is required so the postcard isn't a blank card with nothing on it.
  it("blocks advancing from Inside with no photo AND empty note", () => {
    const { getByTestId } = renderSend();
    pickFriendThenName(getByTestId);
    advance(getByTestId); // → Cover
    advance(getByTestId); // → Inside (text-only skip from Cover)
    advance(getByTestId); // attempt to advance past Inside
    expect(ALERT_SPY).toHaveBeenCalledWith(
      "Not quite ready",
      expect.stringMatching(/photo|note/i),
    );
  });

  // v0.7.0.50: photo-only flow — message is allowed to be empty when a
  // photo is attached so the user can send "just a photo."
  it("allows advancing from Inside with a photo and empty note (photo-only flow)", async () => {
    const { getByTestId, queryByTestId } = renderSend();
    pickFriendThenName(getByTestId);
    advance(getByTestId);
    await attachPhoto(getByTestId);
    advance(getByTestId); // → Inside
    advance(getByTestId); // → Delivery (should succeed without typing)
    // Either the next step renders OR the alert was NOT the "not quite
    // ready" blocker (i.e. some other gate may apply but the message
    // gate specifically should not fire).
    expect(ALERT_SPY).not.toHaveBeenCalledWith(
      "Not quite ready",
      expect.stringMatching(/note/i),
    );
    expect(queryByTestId("send-step-4")).toBeTruthy();
  });

  it("surfaces friend matches as the user types a name on the Name step", () => {
    const { getByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-friend"));
    advance(getByTestId);
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    expect(getByTestId(/^send-friend-match-/)).toBeTruthy();
  });

  it("locks the friend reference when a match row is tapped", () => {
    const { getByTestId, getAllByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-friend"));
    advance(getByTestId);
    fireEvent.changeText(getByTestId("send-name-input"), "Tati");
    const matchRows = getAllByTestId(/^send-friend-match-/);
    fireEvent.press(matchRows[0]);
    expect(getByTestId("send-friend-locked")).toBeTruthy();
  });

  it("friend flow ends on Delivery with magic-link + address + friend saved-address option", async () => {
    const { getByTestId, getAllByTestId } = renderSend();
    fireEvent.press(getByTestId("send-kind-friend"));
    advance(getByTestId);
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

  it("the Back button returns one step at a time", () => {
    const { getByTestId } = renderSend();
    pickFriendThenName(getByTestId);
    advance(getByTestId);
    expect(getByTestId("send-step-2")).toBeTruthy();
    fireEvent.press(getByTestId("send-back-btn"));
    // Back from Cover → Name step.
    expect(getByTestId("send-step-name")).toBeTruthy();
    fireEvent.press(getByTestId("send-back-btn"));
    // Back from Name → Type picker.
    expect(getByTestId("send-step-1")).toBeTruthy();
  });
});
