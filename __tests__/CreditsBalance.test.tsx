import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { CreditsBalance } from "@/src/components/CreditsBalance";

describe("CreditsBalance", () => {
  it("renders singular 'credit' for count 1", () => {
    const { getByText } = render(<CreditsBalance count={1} />);
    expect(getByText("1 credit")).toBeTruthy();
  });

  it("renders plural 'credits' for count != 1", () => {
    const { getByText } = render(<CreditsBalance count={5} />);
    expect(getByText("5 credits")).toBeTruthy();
  });

  it("does not render Buy button when onPressBuy is omitted", () => {
    const { queryByTestId } = render(<CreditsBalance count={5} />);
    expect(queryByTestId("credits-buy-btn")).toBeNull();
  });

  it("renders Buy button and fires onPressBuy when provided", () => {
    const onPressBuy = jest.fn();
    const { getByTestId } = render(<CreditsBalance count={2} onPressBuy={onPressBuy} />);
    fireEvent.press(getByTestId("credits-buy-btn"));
    expect(onPressBuy).toHaveBeenCalled();
  });
});
