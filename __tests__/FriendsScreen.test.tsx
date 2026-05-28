import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import FriendsScreen from "@/app/(tabs)/friends";
import { AllProviders } from "./test-utils";

jest.mock("expo-router", () => {
 const mockPush = jest.fn();
 return {
 __mockPush: mockPush,
 Redirect: () => null,
 Stack: ({ children }: any) => children ?? null,
 Tabs: ({ children }: any) => children ?? null,
 Link: ({ children }: any) => children ?? null,
 useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
 };
});

const expoRouter = jest.requireMock("expo-router") as { __mockPush: jest.Mock };

beforeEach(() => {
 expoRouter.__mockPush.mockClear();
});

function renderFriends() {
 return render(
 <AllProviders>
 <FriendsScreen />
 </AllProviders>
 );
}

describe("FriendsScreen. rolodex layout", () => {
 it("renders the compact mail card with name + show-QR button", () => {
 const { getByText, getByTestId } = renderFriends();
 expect(getByText("Scotty")).toBeTruthy();
 expect(getByTestId("show-qr-btn")).toBeTruthy();
 });

 it("renders the rolodex header with an Add button", () => {
 const { getByText, getByTestId } = renderFriends();
 expect(getByText("Your rolodex")).toBeTruthy();
 expect(getByTestId("add-friend-btn")).toBeTruthy();
 });

 it("renders one rolodex card per friend", () => {
 const { getByTestId } = renderFriends();
 expect(getByTestId("rolodex-card-tatiana")).toBeTruthy();
 expect(getByTestId("rolodex-card-alex")).toBeTruthy();
 expect(getByTestId("rolodex-card-maya")).toBeTruthy();
 expect(getByTestId("rolodex-card-nora")).toBeTruthy();
 expect(getByTestId("rolodex-card-ben")).toBeTruthy();
 expect(getByTestId("rolodex-card-sam")).toBeTruthy();
 });

 it("opens the QR modal when the show-QR button is tapped", () => {
 const { getByTestId, queryByTestId } = renderFriends();
 expect(queryByTestId("qr-svg")).toBeNull();
 fireEvent.press(getByTestId("show-qr-btn"));
 expect(getByTestId("qr-svg")).toBeTruthy();
 });

 it("opens the friend detail sheet when a rolodex card is tapped", () => {
 const { getByTestId, getByText } = renderFriends();
 fireEvent.press(getByTestId("rolodex-card-tatiana"));
 // detail sheet shows the 'Recent sends' section title. unique to the sheet
 expect(getByText("Recent sends")).toBeTruthy();
 expect(getByTestId("friend-detail-close")).toBeTruthy();
 });

 it("opens the add-friend sheet when Add is tapped", () => {
 const { getByTestId, getByText } = renderFriends();
 fireEvent.press(getByTestId("add-friend-btn"));
 expect(getByText("Add a friend")).toBeTruthy();
 });

 it("adds a friend to the rolodex via the form", async () => {
 const { getByTestId, getByText, getAllByText } = renderFriends();
 fireEvent.press(getByTestId("add-friend-btn"));
 await act(async () => {
 fireEvent.changeText(getByTestId("add-friend-name"), "Jamie River");
 fireEvent.changeText(getByTestId("add-friend-city"), "Boise");
 fireEvent.changeText(getByTestId("add-friend-state"), "ID");
 });
 await act(async () => {
 fireEvent.press(getByText("Add to rolodex"));
 });
 // The new friend appears in the rolodex AND in the auto-opened detail sheet
 await waitFor(() => {
 expect(getAllByText("Jamie River").length).toBeGreaterThan(0);
 }, { timeout: 3000 });
 });

 it("shows the validation error when name + city are missing", async () => {
 const { getByTestId, getByText } = renderFriends();
 fireEvent.press(getByTestId("add-friend-btn"));
 await act(async () => {
 fireEvent.press(getByText("Add to rolodex"));
 });
 await waitFor(() => {
 expect(getByTestId("add-friend-error")).toBeTruthy();
 });
 });
});
