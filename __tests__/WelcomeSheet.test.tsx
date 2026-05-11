import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { WelcomeSheet } from "@/src/components/WelcomeSheet";
import { useMailClub } from "@/src/state/MailClubContext";
import { AllProviders } from "./test-utils";

beforeEach(async () => {
  await AsyncStorage.clear();
});

function Probe({ refOut }: { refOut: { current: ReturnType<typeof useMailClub> | null } }) {
  const ctx = useMailClub();
  refOut.current = ctx;
  return <Text>p</Text>;
}

describe("WelcomeSheet", () => {
  it("renders the headline + inputs when visible", () => {
    const { getByText, getByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    expect(getByText(/Welcome to Mail Club/i)).toBeTruthy();
    expect(getByTestId("welcome-name")).toBeTruthy();
    expect(getByTestId("welcome-city")).toBeTruthy();
    expect(getByTestId("welcome-state")).toBeTruthy();
  });

  it("renders nothing when not visible", () => {
    const { queryByText } = render(
      <AllProviders>
        <WelcomeSheet visible={false} onComplete={() => {}} />
      </AllProviders>
    );
    expect(queryByText(/Welcome to Mail Club/i)).toBeNull();
  });

  it("submit persists name+city+state and marks intro seen", async () => {
    const ref: { current: ReturnType<typeof useMailClub> | null } = { current: null };
    const onComplete = jest.fn();
    const { getByTestId, getByText } = render(
      <AllProviders>
        <Probe refOut={ref} />
        <WelcomeSheet visible={true} onComplete={onComplete} />
      </AllProviders>
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("welcome-name"), "Pat");
      fireEvent.changeText(getByTestId("welcome-city"), "Boise");
      fireEvent.changeText(getByTestId("welcome-state"), "ID");
    });
    await act(async () => {
      fireEvent.press(getByText("Start writing"));
    });
    await waitFor(() => {
      expect(ref.current!.currentUser.name).toBe("Pat");
      expect(ref.current!.currentUser.city).toBe("Boise");
      expect(ref.current!.hasSeenFreeCreditsIntro).toBe(true);
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("Skip for now marks intro seen, clears mock fixtures, sets placeholder identity", async () => {
    const ref: { current: ReturnType<typeof useMailClub> | null } = { current: null };
    const onComplete = jest.fn();
    const { getByTestId } = render(
      <AllProviders>
        <Probe refOut={ref} />
        <WelcomeSheet visible={true} onComplete={onComplete} />
      </AllProviders>
    );
    await act(async () => {
      fireEvent.press(getByTestId("welcome-skip"));
    });
    await waitFor(() => {
      expect(ref.current!.hasSeenFreeCreditsIntro).toBe(true);
      expect(onComplete).toHaveBeenCalled();
    });
    // Skip routes through completeSignup with empty name → placeholder identity.
    expect(ref.current!.currentUser.name).toBe("Mail Club member");
    // Mock fixtures wiped so the new user doesn't inherit Tatiana/Maya/etc.
    expect(ref.current!.friends).toEqual([]);
    expect(ref.current!.postcards).toEqual([]);
  });
});
