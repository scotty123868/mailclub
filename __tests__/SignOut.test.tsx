import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
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

describe("signOut", () => {
  it("clears AsyncStorage state and resets hasSeenFreeCreditsIntro", async () => {
    const ref: { current: ReturnType<typeof useMailClub> | null } = { current: null };
    render(
      <AllProviders>
        <Probe refOut={ref} />
      </AllProviders>
    );
    await waitFor(() => expect(ref.current).not.toBeNull());

    // Mutate some state first
    await act(async () => {
      await ref.current!.markFreeCreditsIntroSeen();
      await ref.current!.updateAboutMe({ name: "Pat" });
    });
    await waitFor(() => {
      expect(ref.current!.hasSeenFreeCreditsIntro).toBe(true);
      expect(ref.current!.currentUser.name).toBe("Pat");
    });

    await act(async () => {
      await ref.current!.signOut();
    });

    await waitFor(() => {
      expect(ref.current!.hasSeenFreeCreditsIntro).toBe(false);
      // signOut clears to a clean slate — no mock fixtures repopulated.
      expect(ref.current!.currentUser.name).toBe("");
      expect(ref.current!.friends).toEqual([]);
      expect(ref.current!.postcards).toEqual([]);
    });
  });
});
