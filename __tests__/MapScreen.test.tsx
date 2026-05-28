import { render } from "@testing-library/react-native";
import React from "react";
import MapScreen from "@/app/(tabs)/map";
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
 useLocalSearchParams: () => ({}),
 };
});

const expoRouter = jest.requireMock("expo-router") as { __mockPush: jest.Mock };

beforeEach(() => {
 expoRouter.__mockPush.mockClear();
});

function renderMap() {
 return render(
 <AllProviders>
 <MapScreen />
 </AllProviders>
 );
}

// v0.7.0.2: Map stripped to just the map. Removed segmented filter chips
// (Friends/Sent/Received), the 3-tile summary (Cities/Friends/Miles), and
// the Recent Routes list. Per user: "just want the map to be the thing
// itself, especially because the map will already be populated with
// something once the user is forced to send."
describe("MapScreen (v0.7.0.2)", () => {
 it("renders the Map header", () => {
 const { getByText } = renderMap();
 expect(getByText("Map")).toBeTruthy();
 });

 it("does NOT render the removed v0.6.x segmented filter chips", () => {
 const { queryByTestId } = renderMap();
 expect(queryByTestId("map-filter-friends")).toBeNull();
 expect(queryByTestId("map-filter-sent")).toBeNull();
 expect(queryByTestId("map-filter-received")).toBeNull();
 });

 it("does NOT render the removed v0.6.x summary tiles (Cities/Miles)", () => {
 const { queryByText } = renderMap();
 expect(queryByText("Cities")).toBeNull();
 expect(queryByText("Miles")).toBeNull();
 });

 it("does NOT render the removed v0.6.x Recent Routes list", () => {
 const { queryByText, queryByTestId } = renderMap();
 expect(queryByText("Recent Routes")).toBeNull();
 expect(queryByTestId("routes-empty")).toBeNull();
 });
});
