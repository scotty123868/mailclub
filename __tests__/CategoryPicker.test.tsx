import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { CategoryPicker, creditCostFor } from "@/src/components/CategoryPicker";

describe("CategoryPicker", () => {
  it("renders all 4 categories with correct credit labels", () => {
    const { getByText, getByTestId } = render(<CategoryPicker selected="handwritten" onSelect={() => {}} />);
    expect(getByText("Note")).toBeTruthy();
    expect(getByText("Photo")).toBeTruthy();
    expect(getByText("Place")).toBeTruthy();
    expect(getByText("Custom")).toBeTruthy();
    expect(getByTestId("category-handwritten")).toBeTruthy();
    expect(getByTestId("category-photo")).toBeTruthy();
    expect(getByTestId("category-place")).toBeTruthy();
    expect(getByTestId("category-custom")).toBeTruthy();
  });

  it("shows '1 credit' for every category (MVP unified pricing)", () => {
    const { getAllByText } = render(<CategoryPicker selected="handwritten" onSelect={() => {}} />);
    // All 4 categories now cost 1 credit each
    expect(getAllByText("1 credit").length).toBe(4);
  });

  it("fires onSelect with the chosen category id", () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(<CategoryPicker selected="handwritten" onSelect={onSelect} />);
    fireEvent.press(getByTestId("category-place"));
    expect(onSelect).toHaveBeenCalledWith("place");
    fireEvent.press(getByTestId("category-custom"));
    expect(onSelect).toHaveBeenCalledWith("custom");
  });

  it("marks the selected category with the active accessibility state", () => {
    const { getByTestId } = render(<CategoryPicker selected="photo" onSelect={() => {}} />);
    const photo = getByTestId("category-photo");
    expect(photo.props.accessibilityState?.selected).toBe(true);
  });
});

describe("creditCostFor()", () => {
  it("returns 1 for every category (MVP unified pricing)", () => {
    expect(creditCostFor("handwritten")).toBe(1);
    expect(creditCostFor("photo")).toBe(1);
    expect(creditCostFor("place")).toBe(1);
    expect(creditCostFor("custom")).toBe(1);
  });
});
