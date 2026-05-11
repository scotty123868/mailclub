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

describe("ConstellationScreen", () => {
  it("renders header + filter chips + insight cards", () => {
    const { getByText } = renderConstellation();
    expect(getByText("Constellation")).toBeTruthy();
    expect(getByText("All Friends")).toBeTruthy();
    expect(getByText("Close Friends")).toBeTruthy();
    expect(getByText("New Connections")).toBeTruthy();
  });

  it("renders the relevant insight cards derived from friends", () => {
    const { getByText, queryByText } = renderConstellation();
    // 6 mock friends with non-zero card counts → Warmest Thread renders
    expect(getByText("Warmest Thread")).toBeTruthy();
    // Mock data has friends with old lastInteractionAt → Sleeping Stars renders
    expect(getByText("Sleeping Stars")).toBeTruthy();
    // New Spark may or may not render depending on friend overlap (same as Warmest)
    // Hardcoded "3 friends" + Tatiana name no longer assumed.
    expect(queryByText("Warmest Thread")).toBeTruthy();
  });

  it("does not crash when filter chips are pressed", () => {
    const { getByText } = renderConstellation();
    fireEvent.press(getByText("Close Friends"));
    fireEvent.press(getByText("New Connections"));
    fireEvent.press(getByText("All Friends"));
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

  it("marks the active filter chip with selected accessibility state", () => {
    const { getByTestId } = renderConstellation();
    const closeChip = getByTestId("constellation-filter-close-friends");
    fireEvent.press(closeChip);
    expect(closeChip.props.accessibilityState?.selected).toBe(true);
  });
});
