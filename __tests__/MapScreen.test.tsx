import { fireEvent, render } from "@testing-library/react-native";
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

describe("MapScreen", () => {
  it("renders all primary sections", () => {
    const { getByText, getAllByText, queryByText } = renderMap();
    expect(getByText("Map")).toBeTruthy();
    // 'Friends' appears in segmented control + summary stats
    expect(getAllByText("Friends").length).toBeGreaterThanOrEqual(1);
    expect(getByText("Sent")).toBeTruthy();
    expect(getByText("Received")).toBeTruthy();
    expect(getByText("Recent Routes")).toBeTruthy();
    // v0.5.0: footer "Every line started with a real connection." was removed
    expect(queryByText(/Every line started/i)).toBeNull();
  });

  it("displays real summary stats derived from state", () => {
    const { getByText, getAllByText } = renderMap();
    expect(getByText("Cities")).toBeTruthy();
    expect(getByText("Miles")).toBeTruthy();
    expect(getAllByText("Friends").length).toBeGreaterThanOrEqual(1);
  });

  it("renders 3 recent routes derived from initial mock postcards", () => {
    // Initial mock postcards: Denver→Nashville, Austin→New York, Denver→Vancouver
    const { getByText } = renderMap();
    expect(getByText("Denver → Nashville")).toBeTruthy();
    expect(getByText("Austin → New York")).toBeTruthy();
    expect(getByText("Denver → Vancouver")).toBeTruthy();
  });

  it("filter chips actually filter — Received shows the empty state", () => {
    // v0.5.0: filter chips wired up. Received has no inbound data yet so we
    // show the empty state copy instead of pretending there's data.
    const { getByText, queryByText } = renderMap();
    fireEvent.press(getByText("Received"));
    expect(getByText(/No replies yet/i)).toBeTruthy();
    expect(queryByText("Denver → Nashville")).toBeNull();
  });

  it("Sent and Friends filters keep the routes visible", () => {
    const { getByText, getAllByText } = renderMap();
    // Start on Friends, routes present
    expect(getByText("Denver → Nashville")).toBeTruthy();
    // Switch to Sent — routes still present (same data slice today)
    fireEvent.press(getByText("Sent"));
    expect(getByText("Denver → Nashville")).toBeTruthy();
    // Back to Friends
    fireEvent.press(getAllByText("Friends")[0]);
    expect(getByText("Denver → Nashville")).toBeTruthy();
  });

  it("opens the route detail sheet when a route row is tapped", () => {
    const { getAllByText, getByTestId, getByText } = renderMap();
    // Tap the Denver → Nashville route row (any derived route id works)
    fireEvent.press(getByText("Denver → Nashville"));
    expect(getByTestId("route-detail-close")).toBeTruthy();
  });

  it("closes the route detail sheet via the X button", () => {
    const { getByTestId, getByText, queryByTestId } = renderMap();
    fireEvent.press(getByText("Austin → New York"));
    expect(getByTestId("route-detail-close")).toBeTruthy();
    fireEvent.press(getByTestId("route-detail-close"));
    expect(queryByTestId("route-detail-close")).toBeNull();
  });

  it("navigates to /send when 'Send a card to this route' is tapped in the sheet", () => {
    const { getByText } = renderMap();
    fireEvent.press(getByText("Denver → Vancouver"));
    fireEvent.press(getByText("Send a card to this route"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith("/send");
  });
});
