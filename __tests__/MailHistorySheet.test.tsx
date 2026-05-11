import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { MailHistorySheet } from "@/src/components/MailHistorySheet";
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

describe("MailHistorySheet", () => {
  it("renders both tab labels with counts from initial state", () => {
    const { getByText } = render(
      <AllProviders>
        <MailHistorySheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    // 3 mock starter postcards, 0 void replies
    expect(getByText("Sent (3)")).toBeTruthy();
    expect(getByText("Replies (0)")).toBeTruthy();
  });

  it("renders sent rows for each mock postcard", () => {
    const { getByText } = render(
      <AllProviders>
        <MailHistorySheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    // Recipients from mock data
    expect(getByText("Tatiana")).toBeTruthy();
    expect(getByText("Alex")).toBeTruthy();
    expect(getByText("Nora")).toBeTruthy();
  });

  it("switches to the replies tab and shows empty state", () => {
    const { getByTestId } = render(
      <AllProviders>
        <MailHistorySheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("mail-history-tab-replies"));
    expect(getByTestId("mail-history-replies-empty")).toBeTruthy();
  });

  it("sending into the void appends to the sent log (no fake reply is generated)", async () => {
    const ref: { current: ReturnType<typeof useMailClub> | null } = { current: null };
    render(
      <AllProviders>
        <Probe refOut={ref} />
        <MailHistorySheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    const before = ref.current!.postcards.length;
    await act(async () => {
      await ref.current!.sendIntoVoid("Hi stranger");
    });
    await waitFor(() => {
      // Postcard was sent
      expect(ref.current!.postcards.length).toBe(before + 1);
      // We do NOT auto-fabricate a reply — Apple 4.0 / 5.6.1 misleading content.
      expect(ref.current!.voidReplies.length).toBe(0);
    });
  });

  it("close fires onClose", () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <AllProviders>
        <MailHistorySheet visible={true} onClose={onClose} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("mail-history-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
