import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { NotificationsSheet } from "@/src/components/NotificationsSheet";
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

describe("NotificationsSheet", () => {
  it("renders all 3 toggle rows when visible", () => {
    const { getByTestId } = render(
      <AllProviders>
        <NotificationsSheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    expect(getByTestId("notif-toggle-delivered")).toBeTruthy();
    expect(getByTestId("notif-toggle-reply")).toBeTruthy();
    expect(getByTestId("notif-toggle-birthdays")).toBeTruthy();
  });

  it("renders nothing when not visible", () => {
    const { queryByText } = render(
      <AllProviders>
        <NotificationsSheet visible={false} onClose={() => {}} />
      </AllProviders>
    );
    expect(queryByText("Notifications")).toBeNull();
  });

  it("toggling a row updates the context preference", async () => {
    const ref: { current: ReturnType<typeof useMailClub> | null } = { current: null };
    const { getByTestId } = render(
      <AllProviders>
        <Probe refOut={ref} />
        <NotificationsSheet visible={true} onClose={() => {}} />
      </AllProviders>
    );
    expect(ref.current!.notifications.cardDelivered).toBe(true);
    await act(async () => {
      fireEvent(getByTestId("notif-toggle-delivered"), "valueChange", false);
    });
    await waitFor(() => {
      expect(ref.current!.notifications.cardDelivered).toBe(false);
    });
  });

  it("close fires onClose", () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <AllProviders>
        <NotificationsSheet visible={true} onClose={onClose} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("notifications-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
