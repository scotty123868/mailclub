import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Linking } from "react-native";
import { AboutAppSheet } from "@/src/components/AboutAppSheet";

describe("AboutAppSheet", () => {
 it("renders the brand + section titles when visible", () => {
 const { getByText } = render(<AboutAppSheet visible={true} onClose={() => {}} />);
 expect(getByText("About Mailroom")).toBeTruthy();
 expect(getByText("What this is")).toBeTruthy();
 expect(getByText("Privacy")).toBeTruthy();
 expect(getByText("Terms")).toBeTruthy();
 expect(getByText("Help & feedback")).toBeTruthy();
 });

 it("renders nothing when not visible", () => {
 const { queryByText } = render(<AboutAppSheet visible={false} onClose={() => {}} />);
 expect(queryByText("About Mailroom")).toBeNull();
 });

 it("opens mailto when the support-email button is tapped", () => {
 const openSpy = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
 const { getByTestId } = render(<AboutAppSheet visible={true} onClose={() => {}} />);
 fireEvent.press(getByTestId("about-app-mail"));
 expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("mailto:"));
 openSpy.mockRestore();
 });

 it("close fires onClose", () => {
 const onClose = jest.fn();
 const { getByTestId } = render(<AboutAppSheet visible={true} onClose={onClose} />);
 fireEvent.press(getByTestId("about-app-close"));
 expect(onClose).toHaveBeenCalled();
 });
});
