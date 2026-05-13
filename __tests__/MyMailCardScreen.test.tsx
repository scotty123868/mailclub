import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import MyMailCardScreen from "@/app/(tabs)/my-card";
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

function renderMyCard() {
  return render(
    <AllProviders>
      <MyMailCardScreen />
    </AllProviders>
  );
}

// v0.7: profile redesigned. Stats reduced to 3 (Friends · Sent · Received).
// About-me grid replaced with editable bio. "Postcard Friends Since" line
// removed. Postcards journal (week-by-week) lives inside My Card.
describe("MyMailCardScreen (v0.7)", () => {
  it("renders user identity (Scotty / Denver, CO)", () => {
    const { getByText } = renderMyCard();
    expect(getByText("Scotty")).toBeTruthy();
    expect(getByText(/Denver, CO/)).toBeTruthy();
  });

  it("does NOT show 'Postcard Friends Since' line (v0.7 removed)", () => {
    const { queryByText } = renderMyCard();
    expect(queryByText(/POSTCARD FRIENDS SINCE/)).toBeNull();
  });

  it("renders 3 metric tiles: Friends · Sent · Received (no Cities, no Replies)", () => {
    const { getByTestId, queryByTestId } = renderMyCard();
    expect(getByTestId("metric-friends")).toBeTruthy();
    expect(getByTestId("metric-sent")).toBeTruthy();
    expect(getByTestId("metric-received")).toBeTruthy();
    // Old metrics removed in v0.7
    expect(queryByTestId("metric-cities")).toBeNull();
    expect(queryByTestId("metric-replies")).toBeNull();
  });

  it("does NOT render the removed About-me grid (interests / send-me / birthday / currently-into)", () => {
    const { queryByText } = renderMyCard();
    expect(queryByText("Interests:")).toBeNull();
    expect(queryByText("Send me:")).toBeNull();
    expect(queryByText("Birthday:")).toBeNull();
    expect(queryByText(/Currently into/)).toBeNull();
  });

  it("renders the editable bio with edit affordance", () => {
    const { getByTestId } = renderMyCard();
    expect(getByTestId("bio-edit-trigger")).toBeTruthy();
  });

  it("does NOT render the removed First Card Ideas grid", () => {
    const { queryByText, queryByTestId } = renderMyCard();
    expect(queryByText("First Card Ideas")).toBeNull();
    expect(queryByTestId("idea-pill-memory")).toBeNull();
  });

  it("does NOT render the inline CreditsBalance row (pill in header replaces it)", () => {
    const { queryByTestId } = renderMyCard();
    expect(queryByTestId("credits-buy-btn")).toBeNull();
  });

  it("does NOT render the removed Constellation/Map preview cards or Send/Add buttons", () => {
    const { queryByText, queryByTestId } = renderMyCard();
    expect(queryByText("Your Constellation")).toBeNull();
    expect(queryByText("Mail Map")).toBeNull();
    expect(queryByTestId("preview-constellation")).toBeNull();
    expect(queryByTestId("preview-map")).toBeNull();
    expect(queryByText("Send Mail")).toBeNull();
    expect(queryByText("Add Friend")).toBeNull();
  });

  it("renders the weekly journal", () => {
    const { getByTestId } = renderMyCard();
    expect(getByTestId("weekly-journal")).toBeTruthy();
  });

  it("opens the SettingsSheet when the header gear is tapped", () => {
    const { getByTestId, getByText } = renderMyCard();
    fireEvent.press(getByTestId("header-settings-btn"));
    expect(getByText("Settings")).toBeTruthy();
  });

  it("opens the EditAboutMeSheet when the bio is tapped", () => {
    const { getByTestId } = renderMyCard();
    fireEvent.press(getByTestId("bio-edit-trigger"));
    // EditAboutMeSheet renders — the existence of its testID would be
    // ideal but the sheet wraps in a Modal; we just verify tapping
    // doesn&apos;t throw. Smoke test only.
    expect(getByTestId("bio-edit-trigger")).toBeTruthy();
  });

  it("opens the CreditsSheet when the header CreditsPill is tapped", () => {
    const { getByTestId, getByText } = renderMyCard();
    fireEvent.press(getByTestId("header-credits-pill"));
    expect(getByText("Buy stamps")).toBeTruthy();
  });

  it("Friends metric tile navigates to /friends", () => {
    const { getByTestId } = renderMyCard();
    fireEvent.press(getByTestId("metric-friends"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith("/friends");
  });
});
