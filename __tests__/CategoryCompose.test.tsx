import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { CategoryCompose, ComposeState } from "@/src/components/CategoryCompose";

function baseState(overrides: Partial<ComposeState> = {}): ComposeState {
 return {
 category: "photo",
 message: "Hi",
 imageUri: null,
 placeName: "",
 customTone: undefined,
 customPhotos: [],
 ...overrides,
 };
}

describe("CategoryCompose", () => {
 it("renders the photo slot for the photo category", () => {
 const { getByTestId, getByText } = render(
 <CategoryCompose state={baseState({ category: "photo" })} onChange={() => {}} />
 );
 expect(getByTestId("photo-slot")).toBeTruthy();
 expect(getByText("Tonight's photo")).toBeTruthy();
 });

 it("renders the photo slot AND a place picker summary for the place category", () => {
 const { getByTestId, getByText } = render(
 <CategoryCompose state={baseState({ category: "place" })} onChange={() => {}} />
 );
 expect(getByTestId("photo-slot")).toBeTruthy();
 expect(getByText(/Greetings from/)).toBeTruthy();
 });

 it("renders the 'just your words' slot for handwritten (no photo picker)", () => {
 const { getByTestId, getByText, queryByTestId } = render(
 <CategoryCompose state={baseState({ category: "handwritten" })} onChange={() => {}} />
 );
 expect(getByTestId("handwritten-slot")).toBeTruthy();
 expect(getByText("Just your words")).toBeTruthy();
 expect(queryByTestId("photo-slot")).toBeNull();
 });

 it("renders the CustomRequestForm for custom category", () => {
 const { getByTestId, queryByTestId } = render(
 <CategoryCompose state={baseState({ category: "custom" })} onChange={() => {}} />
 );
 expect(getByTestId("custom-request-form")).toBeTruthy();
 expect(queryByTestId("photo-slot")).toBeNull();
 expect(queryByTestId("handwritten-slot")).toBeNull();
 });

 it("calls onChange when the note text changes", () => {
 const onChange = jest.fn();
 const { getByTestId } = render(
 <CategoryCompose state={baseState()} onChange={onChange} />
 );
 fireEvent.changeText(getByTestId("compose-note-input"), "Hello world");
 expect(onChange).toHaveBeenCalledWith({ message: "Hello world" });
 });

 it("calls onChange for the customTone when a tone chip is pressed (custom category)", () => {
 const onChange = jest.fn();
 const { getByTestId } = render(
 <CategoryCompose state={baseState({ category: "custom", message: "" })} onChange={onChange} />
 );
 fireEvent.press(getByTestId("custom-tone-playful"));
 expect(onChange).toHaveBeenCalledWith({ customTone: "playful" });
 });
});
