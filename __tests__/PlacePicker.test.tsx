import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { PlacePicker, PlacePickerSummary } from "@/src/components/PlacePicker";

describe("PlacePickerSummary", () => {
  it("shows 'wherever' fallback when value is empty", () => {
    const { getByText } = render(<PlacePickerSummary value="" onPress={() => {}} />);
    expect(getByText(/wherever/i)).toBeTruthy();
  });

  it("shows chosen value in emphasis", () => {
    const { getByText } = render(<PlacePickerSummary value="Florida" onPress={() => {}} />);
    expect(getByText(/Florida/)).toBeTruthy();
  });

  it("fires onPress when tapped", () => {
    const onPress = jest.fn();
    const { getByText } = render(<PlacePickerSummary value="" onPress={onPress} />);
    fireEvent.press(getByText("Change"));
    expect(onPress).toHaveBeenCalled();
  });
});

describe("PlacePicker", () => {
  it("renders nothing when not visible", () => {
    const { queryByText } = render(
      <PlacePicker visible={false} initialValue="" onClose={() => {}} onChoose={() => {}} />
    );
    expect(queryByText("From where?")).toBeNull();
  });

  it("renders the picker modal when visible", () => {
    const { getByText, getByTestId } = render(
      <PlacePicker visible={true} initialValue="" onClose={() => {}} onChoose={() => {}} />
    );
    expect(getByText("From where?")).toBeTruthy();
    expect(getByTestId("place-picker-input")).toBeTruthy();
  });

  it("filters states by the query", () => {
    const { getByTestId, queryByTestId } = render(
      <PlacePicker visible={true} initialValue="" onClose={() => {}} onChoose={() => {}} />
    );
    fireEvent.changeText(getByTestId("place-picker-input"), "Flor");
    expect(queryByTestId("place-row-florida")).toBeTruthy();
    expect(queryByTestId("place-row-texas")).toBeNull();
  });

  it("shows the 'Use custom' affordance when query doesn't match a state", () => {
    const onChoose = jest.fn();
    const onClose = jest.fn();
    const { getByTestId } = render(
      <PlacePicker visible={true} initialValue="" onClose={onClose} onChoose={onChoose} />
    );
    fireEvent.changeText(getByTestId("place-picker-input"), "Patagonia");
    fireEvent.press(getByTestId("place-picker-custom"));
    expect(onChoose).toHaveBeenCalledWith("Patagonia");
    expect(onClose).toHaveBeenCalled();
  });

  it("picks a state row and closes", () => {
    const onChoose = jest.fn();
    const onClose = jest.fn();
    const { getByTestId } = render(
      <PlacePicker visible={true} initialValue="" onClose={onClose} onChoose={onChoose} />
    );
    fireEvent.press(getByTestId("place-row-oregon"));
    expect(onChoose).toHaveBeenCalledWith("Oregon");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the X button is tapped", () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <PlacePicker visible={true} initialValue="" onClose={onClose} onChoose={() => {}} />
    );
    fireEvent.press(getByTestId("place-picker-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
