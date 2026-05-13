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

// v0.5.0: First Card Ideas grid removed. Inline CreditsBalance row removed.
// Buy Stamps is now reached only via the header CreditsPill. Header title is
// "My Card" (was "My Mail Card").
describe("MyMailCardScreen", () => {
  it("renders user identity (Scotty / Denver, CO)", () => {
    const { getByText } = renderMyCard();
    expect(getByText("Scotty")).toBeTruthy();
    expect(getByText(/Denver, CO/)).toBeTruthy();
  });

  it("shows POSTCARD FRIENDS SINCE 2026 + tagline", () => {
    const { getByText } = renderMyCard();
    expect(getByText(/POSTCARD FRIENDS SINCE 2026/)).toBeTruthy();
    expect(getByText(/For the friends you love/)).toBeTruthy();
  });

  it("displays real metric values derived from state", () => {
    const { getByTestId, getAllByText } = renderMyCard();
    // 6 mock friends + 6 distinct cities — both render "6" in the strip
    expect(getAllByText("6").length).toBeGreaterThanOrEqual(2);
    expect(getByTestId("metric-friends")).toBeTruthy();
    expect(getByTestId("metric-sent")).toBeTruthy();
    expect(getByTestId("metric-replies")).toBeTruthy();
    expect(getByTestId("metric-cities")).toBeTruthy();
  });

  it("displays About me section with all info lines", () => {
    const { getByText } = renderMyCard();
    expect(getByText("About me")).toBeTruthy();
    expect(getByText("Interests:")).toBeTruthy();
    expect(getByText("Send me:")).toBeTruthy();
    expect(getByText("Birthday:")).toBeTruthy();
    expect(getByText(/Currently into/)).toBeTruthy();
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

  // v0.6.1: Constellation + Mail Map preview cards removed. Send Mail +
  // Add Friend buttons removed. Both were redundant shortcuts to other
  // tabs and felt like clutter on the profile screen.
  it("does NOT render the removed Constellation/Map preview cards", () => {
    const { queryByText, queryByTestId } = renderMyCard();
    expect(queryByText("Your Constellation")).toBeNull();
    expect(queryByText("Mail Map")).toBeNull();
    expect(queryByTestId("preview-constellation")).toBeNull();
    expect(queryByTestId("preview-map")).toBeNull();
  });

  it("does NOT render the removed Send Mail / Add Friend bottom buttons", () => {
    const { queryByText } = renderMyCard();
    expect(queryByText("Send Mail")).toBeNull();
    expect(queryByText("Add Friend")).toBeNull();
  });

  it("opens the SettingsSheet when the header gear is tapped", () => {
    const { getByTestId, getByText } = renderMyCard();
    fireEvent.press(getByTestId("header-settings-btn"));
    expect(getByText("Settings")).toBeTruthy();
  });

  it("opens the EditAboutMeSheet when the About me card is tapped", () => {
    const { getByTestId, getAllByText } = renderMyCard();
    fireEvent.press(getByTestId("about-me-edit-trigger"));
    // Both the screen ("About me") and the sheet header ("About me") render the same text.
    expect(getAllByText("About me").length).toBeGreaterThanOrEqual(2);
  });

  it("opens the CreditsSheet when the header CreditsPill is tapped", () => {
    const { getByTestId, getByText } = renderMyCard();
    fireEvent.press(getByTestId("header-credits-pill"));
    expect(getByText("Buy stamps")).toBeTruthy();
  });

  it("metric tiles still navigate to their respective tabs", () => {
    const { getByTestId } = renderMyCard();
    fireEvent.press(getByTestId("metric-friends"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith("/friends");
    fireEvent.press(getByTestId("metric-cities"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith("/map");
  });
});
