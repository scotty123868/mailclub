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
    const { getByText, getAllByText } = renderMap();
    expect(getByText("Map")).toBeTruthy();
    // 'Friends' appears in segmented control + summary stats
    expect(getAllByText("Friends").length).toBeGreaterThanOrEqual(1);
    expect(getByText("Sent")).toBeTruthy();
    expect(getByText("Received")).toBeTruthy();
    expect(getByText("Recent Routes")).toBeTruthy();
    expect(getByText(/real connection/i)).toBeTruthy();
  });

  it("displays real summary stats derived from state", () => {
    const { getByText, getAllByText } = renderMap();
    expect(getByText("Cities")).toBeTruthy();
    expect(getByText("Miles")).toBeTruthy();
    // 6 mock friends with 6 distinct cities
    expect(getAllByText("6").length).toBeGreaterThanOrEqual(1);
    // Total miles from mock routes: 612 + 1512 + 1049 = 3,173
    expect(getByText("3,173")).toBeTruthy();
  });

  it("renders 3 recent routes from mock data", () => {
    const { getByText } = renderMap();
    expect(getByText("Denver → Nashville")).toBeTruthy();
    expect(getByText("Austin → New York")).toBeTruthy();
    expect(getByText("Vancouver → Denver")).toBeTruthy();
  });

  it("displays mile counts for each route", () => {
    const { getByText } = renderMap();
    expect(getByText("612 mi")).toBeTruthy();
    expect(getByText("1,512 mi")).toBeTruthy();
    expect(getByText("1,049 mi")).toBeTruthy();
  });

  it("does not crash when segmented control is changed", () => {
    const { getByText, getAllByText } = renderMap();
    fireEvent.press(getByText("Sent"));
    fireEvent.press(getByText("Received"));
    const friendsButtons = getAllByText("Friends");
    fireEvent.press(friendsButtons[0]);
  });

  it("opens the route detail sheet when a route row is tapped", () => {
    const { getByTestId } = renderMap();
    fireEvent.press(getByTestId("route-row-r1"));
    expect(getByTestId("route-detail-close")).toBeTruthy();
  });

  it("closes the route detail sheet via the X button", () => {
    const { getByTestId, queryByTestId } = renderMap();
    fireEvent.press(getByTestId("route-row-r2"));
    expect(getByTestId("route-detail-close")).toBeTruthy();
    fireEvent.press(getByTestId("route-detail-close"));
    expect(queryByTestId("route-detail-close")).toBeNull();
  });

  it("navigates to /send when 'Send a card to this route' is tapped in the sheet", () => {
    const { getByTestId, getByText } = renderMap();
    fireEvent.press(getByTestId("route-row-r3"));
    fireEvent.press(getByText("Send a card to this route"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith("/send");
  });
});
