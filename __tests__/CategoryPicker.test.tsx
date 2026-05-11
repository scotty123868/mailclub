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

  it("shows '1 credit' singular for handwritten and 'N credits' plural for others", () => {
    const { getByText, getAllByText } = render(<CategoryPicker selected="handwritten" onSelect={() => {}} />);
    expect(getByText("1 credit")).toBeTruthy();
    expect(getByText("5 credits")).toBeTruthy();
    // Photo + Place both cost 2 credits
    expect(getAllByText("2 credits").length).toBe(2);
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
  it("returns the canonical cost per category", () => {
    expect(creditCostFor("handwritten")).toBe(1);
    expect(creditCostFor("photo")).toBe(2);
    expect(creditCostFor("place")).toBe(2);
    expect(creditCostFor("custom")).toBe(5);
  });
});
