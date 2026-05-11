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

  it("displays the metric strip with all 4 values", () => {
    const { getByText } = renderMyCard();
    expect(getByText("42")).toBeTruthy();
    // 128 + 3 starter postcards
    expect(getByText("131")).toBeTruthy();
    expect(getByText("97")).toBeTruthy();
    expect(getByText("23")).toBeTruthy();
  });

  it("displays About Me section with all info lines", () => {
    const { getByText } = renderMyCard();
    expect(getByText("About Me")).toBeTruthy();
    expect(getByText("Interests:")).toBeTruthy();
    expect(getByText("Send me:")).toBeTruthy();
    expect(getByText("Birthday:")).toBeTruthy();
    expect(getByText(/Currently into/)).toBeTruthy();
  });

  it("renders First Card Ideas with all 4 prompts", () => {
    const { getByText } = renderMyCard();
    expect(getByText("First Card Ideas")).toBeTruthy();
    expect(getByText("Send me the photo from tonight")).toBeTruthy();
    expect(getByText("Send me your favorite place in your city")).toBeTruthy();
    expect(getByText("Send me a weird sign")).toBeTruthy();
    expect(getByText("Invite me on a date?")).toBeTruthy();
  });

  it("renders Constellation + Mail Map preview cards", () => {
    const { getByText } = renderMyCard();
    expect(getByText("Your Constellation")).toBeTruthy();
    expect(getByText("Mail Map")).toBeTruthy();
  });

  it("Send Mail button navigates to /send", () => {
    const { getByText } = renderMyCard();
    fireEvent.press(getByText("Send Mail"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith("/send");
  });

  it("Add Friend button navigates to /friends", () => {
    const { getByText } = renderMyCard();
    fireEvent.press(getByText("Add Friend"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith("/friends");
  });

  it("opens the SettingsSheet when the header gear is tapped", () => {
    const { getByTestId, getByText } = renderMyCard();
    fireEvent.press(getByTestId("header-settings-btn"));
    expect(getByText("Settings")).toBeTruthy();
  });

  it("opens the EditAboutMeSheet when the About Me card is tapped", () => {
    const { getByTestId, getByText } = renderMyCard();
    fireEvent.press(getByTestId("about-me-edit-trigger"));
    expect(getByText("About me")).toBeTruthy();
  });

  it("opens the CreditsSheet when the Buy button on the balance pill is tapped", () => {
    const { getByTestId, getByText } = renderMyCard();
    fireEvent.press(getByTestId("credits-buy-btn"));
    expect(getByText("Buy credits")).toBeTruthy();
  });

  it("idea pill seeds Send with the occasion param", () => {
    const { getByTestId } = renderMyCard();
    fireEvent.press(getByTestId("idea-pill-memory"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith({ pathname: "/send", params: { occasion: "memory" } });
  });

  it("preview cards navigate to constellation + map", () => {
    const { getByTestId } = renderMyCard();
    fireEvent.press(getByTestId("preview-constellation"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith("/constellation");
    fireEvent.press(getByTestId("preview-map"));
    expect(expoRouter.__mockPush).toHaveBeenCalledWith("/map");
  });
});
