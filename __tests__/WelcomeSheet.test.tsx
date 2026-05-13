import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { WelcomeSheet } from "@/src/components/WelcomeSheet";
import { AllProviders } from "./test-utils";

beforeEach(async () => {
  await AsyncStorage.clear();
});

/**
 * v0.6.1 WelcomeSheet is a streamlined multi-page sign-up flow:
 *   1. hero        — Apple Sign In + email fallback link + brand art
 *   1b. auth-email — email + password fields (sign-up or sign-in)
 *   2. name        — single-field name input
 *   3. city        — City + State two-field input (replaced single-bar parser)
 *   4. done        — celebration, dismisses on tap
 *
 * v0.6.1 removed the "Mailroom mails real postcards" pause page (was too
 * text-heavy and redundant with the hero tagline).
 *
 * Tests focus on step rendering + navigation. The deep auth + signup logic
 * lives in MailClubContext and has its own test suite (MailClubContext.test).
 */
describe("WelcomeSheet (multi-page signup)", () => {
  it("renders the hero step when visible", () => {
    const { getByTestId, queryByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    expect(getByTestId("welcome-step-hero")).toBeTruthy();
    expect(queryByTestId("welcome-step-name")).toBeNull();
    expect(queryByTestId("welcome-step-city")).toBeNull();
    expect(queryByTestId("welcome-step-done")).toBeNull();
  });

  it("no longer renders the deleted 'explain' pause page", () => {
    const { queryByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    expect(queryByTestId("welcome-step-explain")).toBeNull();
  });

  it("renders nothing when not visible", () => {
    const { queryByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={false} onComplete={() => {}} />
      </AllProviders>
    );
    expect(queryByTestId("welcome-step-hero")).toBeNull();
  });

  it("shows the brand tagline 'Mail a photo for less than a stamp.'", () => {
    const { getByText } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    expect(getByText("Mail a photo for less than a stamp.")).toBeTruthy();
  });

  it("hero exposes the email-fallback link", () => {
    const { getByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    expect(getByTestId("welcome-switch-email")).toBeTruthy();
  });

  it("tapping the email link advances to the auth-email step", () => {
    const { getByTestId, queryByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("welcome-switch-email"));
    expect(getByTestId("welcome-step-auth-email")).toBeTruthy();
    expect(queryByTestId("welcome-step-hero")).toBeNull();
  });

  it("auth-email step has email + password inputs", () => {
    const { getByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("welcome-switch-email"));
    expect(getByTestId("welcome-email")).toBeTruthy();
    expect(getByTestId("welcome-password")).toBeTruthy();
  });

  it("back button on auth-email returns to hero", () => {
    const { getByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("welcome-switch-email"));
    expect(getByTestId("welcome-step-auth-email")).toBeTruthy();
    fireEvent.press(getByTestId("welcome-back"));
    expect(getByTestId("welcome-step-hero")).toBeTruthy();
  });

  it("auth-email lets the user swap between signup and signin", () => {
    const { getByTestId, getByText } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    fireEvent.press(getByTestId("welcome-switch-email"));
    // Default is signup → has "Make an account."
    expect(getByText("Make an account.")).toBeTruthy();
    // Swap to signin
    fireEvent.press(getByTestId("welcome-swap-mode"));
    expect(getByText("Welcome back.")).toBeTruthy();
    // Forgot-password only appears in signin
    expect(getByTestId("welcome-forgot")).toBeTruthy();
  });
});
