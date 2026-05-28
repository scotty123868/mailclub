import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { EditAboutMeSheet } from "@/src/components/EditAboutMeSheet";
import { useMailClub } from "@/src/state/MailClubContext";
import { AllProviders } from "./test-utils";

function Probe({ refOut }: { refOut: { current: ReturnType<typeof useMailClub> | null } }) {
 const ctx = useMailClub();
 refOut.current = ctx;
 return <Text>p</Text>;
}

describe("EditAboutMeSheet", () => {
 it("renders nothing when not visible", () => {
 const { queryByText } = render(
 <AllProviders>
 <EditAboutMeSheet visible={false} onClose={() => {}} />
 </AllProviders>
 );
 expect(queryByText("About me")).toBeNull();
 });

 it("renders editable fields when visible", () => {
 const { getByText, getByTestId } = render(
 <AllProviders>
 <EditAboutMeSheet visible={true} onClose={() => {}} />
 </AllProviders>
 );
 expect(getByText("About me")).toBeTruthy();
 expect(getByTestId("edit-about-tagline")).toBeTruthy();
 expect(getByTestId("edit-about-interests")).toBeTruthy();
 expect(getByTestId("edit-about-birthday")).toBeTruthy();
 });

 it("calls onClose when the X is tapped", () => {
 const onClose = jest.fn();
 const { getByTestId } = render(
 <AllProviders>
 <EditAboutMeSheet visible={true} onClose={onClose} />
 </AllProviders>
 );
 fireEvent.press(getByTestId("edit-about-close"));
 expect(onClose).toHaveBeenCalled();
 });

 it("saves changes and updates currentUser via context", async () => {
 const ref: { current: ReturnType<typeof useMailClub> | null } = { current: null };
 const onClose = jest.fn();
 const { getByTestId, getByText } = render(
 <AllProviders>
 <Probe refOut={ref} />
 <EditAboutMeSheet visible={true} onClose={onClose} />
 </AllProviders>
 );
 await act(async () => {
 fireEvent.changeText(getByTestId("edit-about-tagline"), "Updated tagline.");
 });
 await act(async () => {
 fireEvent.press(getByText("Save changes"));
 });
 await waitFor(() => {
 expect(ref.current!.currentUser.tagline).toBe("Updated tagline.");
 expect(onClose).toHaveBeenCalled();
 });
 });
});
