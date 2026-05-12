import { fireEvent, render } from "@testing-library/react-native";
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

// v0.5.0: top filter chips (All Friends / Close / New Connections) were
// removed. Tests that referenced those chips are gone. The insights cards
// still cover the meaningful slices.
describe("ConstellationScreen", () => {
  it("renders the header + insight cards", () => {
    const { getByText } = renderConstellation();
    expect(getByText("Constellation")).toBeTruthy();
    expect(getByText("Warmest Thread")).toBeTruthy();
    expect(getByText("Sleeping Stars")).toBeTruthy();
  });

  it("does not render the removed top filter chips", () => {
    const { queryByText, queryByTestId } = renderConstellation();
    expect(queryByText("All Friends")).toBeNull();
    expect(queryByText("Close Friends")).toBeNull();
    expect(queryByText("New Connections")).toBeNull();
    expect(queryByTestId("constellation-filter-close-friends")).toBeNull();
  });

  it("opens a friend detail sheet when Warmest Thread insight is tapped", () => {
    const { getByTestId } = renderConstellation();
    fireEvent.press(getByTestId("constellation-insight-warmest"));
    expect(getByTestId("friend-detail-close")).toBeTruthy();
  });

  it("navigates to /friends when Sleeping Stars insight is tapped", () => {
    const { getByTestId } = renderConstellation();
    fireEvent.press(getByTestId("constellation-insight-sleeping"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith("/friends");
  });
});
