import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { PrivacySheet } from "@/src/components/PrivacySheet";
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

describe("PrivacySheet", () => {
  it("renders all 3 audience options", () => {
    const { getByTestId } = render(
      <AllProviders>
        <PrivacySheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    expect(getByTestId("privacy-option-anyone")).toBeTruthy();
    expect(getByTestId("privacy-option-friends")).toBeTruthy();
    expect(getByTestId("privacy-option-no-one")).toBeTruthy();
  });

  it("selecting an option updates the context", async () => {
    const ref: { current: ReturnType<typeof useMailClub> | null } = { current: null };
    const { getByTestId } = render(
      <AllProviders>
        <Probe refOut={ref} />
        <PrivacySheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    expect(ref.current!.privacy.whoCanSendToMe).toBe("anyone");
    await act(async () => {
      fireEvent.press(getByTestId("privacy-option-friends"));
    });
    await waitFor(() => {
      expect(ref.current!.privacy.whoCanSendToMe).toBe("friends");
    });
  });

  it("close fires onClose", () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <AllProviders>
        <PrivacySheet visible={true} onClose={onClose} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("privacy-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
