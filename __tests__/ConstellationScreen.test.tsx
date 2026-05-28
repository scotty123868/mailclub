import { render } from "@testing-library/react-native";
import React from "react";
import ConstellationScreen from "@/app/(tabs)/constellation";
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

function renderConstellation() {
 return render(
 <AllProviders>
 <ConstellationScreen />
 </AllProviders>
 );
}

// v0.7: full-screen force-directed social graph (ported from teteapp).
// Replaces the v0.6.x insight cards (Warmest Thread / Sleeping Stars).
// Renders nodes via react-native-svg, supports pan + pinch + double-tap
// to reset, tapping a node opens FriendDetailSheet. Gold ring lights
// up on reciprocated nodes (D.3 magical moment).
describe("ConstellationScreen (v0.7 force-directed)", () => {
 it("renders the screen + header", () => {
 const { getByTestId, getByText } = renderConstellation();
 expect(getByTestId("constellation-screen")).toBeTruthy();
 expect(getByText("Constellation")).toBeTruthy();
 });

 it("does NOT render the removed v0.6.x insight cards", () => {
 const { queryByText, queryByTestId } = renderConstellation();
 expect(queryByText("Warmest Thread")).toBeNull();
 expect(queryByText("Sleeping Stars")).toBeNull();
 expect(queryByText("New Spark")).toBeNull();
 expect(queryByTestId("constellation-insight-warmest")).toBeNull();
 expect(queryByTestId("constellation-insight-sleeping")).toBeNull();
 });

 it("does not render the removed v0.5.x filter chips", () => {
 const { queryByText, queryByTestId } = renderConstellation();
 expect(queryByText("All Friends")).toBeNull();
 expect(queryByText("Close Friends")).toBeNull();
 expect(queryByText("New Connections")).toBeNull();
 expect(queryByTestId("constellation-filter-close-friends")).toBeNull();
 });
});
