import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { SettingsSheet } from "@/src/components/SettingsSheet";
import { AllProviders } from "./test-utils";

describe("SettingsSheet", () => {
  it("renders nothing meaningful when not visible", () => {
    const { queryByText } = render(
      <AllProviders>
        <SettingsSheet visible={false} onClose={() => {}} onOpenCredits={() => {}} onOpenEditAboutMe={() => {}} />
      </AllProviders>
    );
    expect(queryByText("Settings")).toBeNull();
  });

  it("renders the section rows when visible", () => {
    const { getByText, getByTestId } = render(
      <AllProviders>
        <SettingsSheet visible={true} onClose={() => {}} onOpenCredits={() => {}} onOpenEditAboutMe={() => {}} />
      </AllProviders>
    );
    expect(getByText("Settings")).toBeTruthy();
    expect(getByTestId("settings-row-credits")).toBeTruthy();
    expect(getByTestId("settings-row-edit-card")).toBeTruthy();
    expect(getByTestId("settings-row-addresses")).toBeTruthy();
    expect(getByTestId("settings-row-privacy")).toBeTruthy();
    expect(getByTestId("settings-row-signout")).toBeTruthy();
  });

  it("fires onClose + onOpenCredits when Credits row is tapped", () => {
    const onClose = jest.fn();
    const onOpenCredits = jest.fn();
    const { getByTestId } = render(
      <AllProviders>
        <SettingsSheet visible={true} onClose={onClose} onOpenCredits={onOpenCredits} onOpenEditAboutMe={() => {}} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("settings-row-credits"));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenCredits).toHaveBeenCalled();
  });

  it("fires onClose + onOpenEditAboutMe when Edit Mail Card row is tapped", () => {
    const onClose = jest.fn();
    const onOpenEditAboutMe = jest.fn();
    const { getByTestId } = render(
      <AllProviders>
        <SettingsSheet visible={true} onClose={onClose} onOpenCredits={() => {}} onOpenEditAboutMe={onOpenEditAboutMe} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("settings-row-edit-card"));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenEditAboutMe).toHaveBeenCalled();
  });

  it("stub rows trigger Alert.alert", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByTestId } = render(
      <AllProviders>
        <SettingsSheet visible={true} onClose={() => {}} onOpenCredits={() => {}} onOpenEditAboutMe={() => {}} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("settings-row-addresses"));
    expect(alertSpy).toHaveBeenCalledWith("Address book", expect.any(String));
    alertSpy.mockRestore();
  });
});
