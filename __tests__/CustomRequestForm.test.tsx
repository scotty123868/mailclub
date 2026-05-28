import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { CustomRequestForm } from "@/src/components/CustomRequestForm";

describe("CustomRequestForm", () => {
 it("renders all four tone chips", () => {
 const { getByTestId } = render(
 <CustomRequestForm description="" onChangeDescription={() => {}} tone={undefined} onChangeTone={() => {}} photos={[]} onChangePhotos={() => {}} />
 );
 expect(getByTestId("custom-tone-playful")).toBeTruthy();
 expect(getByTestId("custom-tone-romantic")).toBeTruthy();
 expect(getByTestId("custom-tone-formal")).toBeTruthy();
 expect(getByTestId("custom-tone-weird")).toBeTruthy();
 });

 it("fires onChangeTone when a chip is tapped", () => {
 const onChangeTone = jest.fn();
 const { getByTestId } = render(
 <CustomRequestForm description="" onChangeDescription={() => {}} tone={undefined} onChangeTone={onChangeTone} photos={[]} onChangePhotos={() => {}} />
 );
 fireEvent.press(getByTestId("custom-tone-weird"));
 expect(onChangeTone).toHaveBeenCalledWith("weird");
 });

 it("fires onChangeDescription when the textarea changes", () => {
 const onChangeDescription = jest.fn();
 const { getByTestId } = render(
 <CustomRequestForm description="" onChangeDescription={onChangeDescription} tone={undefined} onChangeTone={() => {}} photos={[]} onChangePhotos={() => {}} />
 );
 fireEvent.changeText(getByTestId("custom-description-input"), "A watercolor of our trip.");
 expect(onChangeDescription).toHaveBeenCalledWith("A watercolor of our trip.");
 });

 it("shows 3 empty photo slots when no photos are provided", () => {
 const { getByTestId } = render(
 <CustomRequestForm description="" onChangeDescription={() => {}} tone={undefined} onChangeTone={() => {}} photos={[]} onChangePhotos={() => {}} />
 );
 expect(getByTestId("custom-photo-add-0")).toBeTruthy();
 expect(getByTestId("custom-photo-add-1")).toBeTruthy();
 expect(getByTestId("custom-photo-add-2")).toBeTruthy();
 });

 it("removes a photo when its X is tapped", () => {
 const onChangePhotos = jest.fn();
 const { getByTestId } = render(
 <CustomRequestForm description="" onChangeDescription={() => {}} tone={undefined} onChangeTone={() => {}} photos={["a.jpg", "b.jpg"]} onChangePhotos={onChangePhotos} />
 );
 fireEvent.press(getByTestId("custom-photo-remove-0"));
 expect(onChangePhotos).toHaveBeenCalledWith(["b.jpg"]);
 });

 it("shows the drafts queue notice (no fake designer promise)", () => {
 const { getByText } = render(
 <CustomRequestForm description="" onChangeDescription={() => {}} tone={undefined} onChangeTone={() => {}} photos={[]} onChangePhotos={() => {}} />
 );
 expect(getByText(/saved to your drafts/i)).toBeTruthy();
 });
});
