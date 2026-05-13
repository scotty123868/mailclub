import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { WelcomeSheet } from "@/src/components/WelcomeSheet";
import { AllProviders } from "./test-utils";

beforeEach(async () => {
  await AsyncStorage.clear();
});

/**
 * v0.7 WelcomeSheet is the forced signup → first-send flow.
 *
 * Step machine:
 *   1. hero        — Apple Sign In + email fallback link + brand art
 *   1b. auth-email — email + password (sign-up or sign-in)
 *   2. photo       — pick a photo from camera roll
 *   3. note        — write the message
 *   4. recipient   — pick: friend / send-link / yourself / pen pal
 *   5. their-info  — recipient name + address (or contact for "link")
 *   6. your-info   — sender name + address
 *   7. mailed      — celebration, dismisses on tap
 *
 * Tests focus on step rendering + navigation. The deep auth + signup
 * logic lives in MailClubContext and has its own test suite.
 */
describe("WelcomeSheet (v0.7 forced signup→send)", () => {
  it("renders the hero step when visible", () => {
    const { getByTestId, queryByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    expect(getByTestId("welcome-step-hero")).toBeTruthy();
    expect(queryByTestId("welcome-step-photo")).toBeNull();
    expect(queryByTestId("welcome-step-mailed")).toBeNull();
  });

  it("renders nothing when not visible", () => {
    const { queryByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={false} onComplete={() => {}} />
      </AllProviders>
    );
    expect(queryByTestId("welcome-step-hero")).toBeNull();
  });

  it("shows the v0.7 tagline 'Mail a memory for less than a stamp.'", () => {
    const { getByText } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    expect(getByText("Mail a memory for less than a stamp.")).toBeTruthy();
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

  it("no longer renders the deleted v0.6.x 'name', 'city', 'explain', 'address' steps", () => {
    const { queryByTestId } = render(
      <AllProviders>
        <WelcomeSheet visible={true} onComplete={() => {}} />
      </AllProviders>
    );
    expect(queryByTestId("welcome-step-name")).toBeNull();
    expect(queryByTestId("welcome-step-city")).toBeNull();
    expect(queryByTestId("welcome-step-explain")).toBeNull();
    expect(queryByTestId("welcome-step-address")).toBeNull();
  });

  it("v0.7 step testIDs exist as constants in source", () => {
    // Sanity check — the new step IDs are part of the contract WelcomeGate
    // and tests rely on. If they ever get renamed, this fails and we know
    // to update WelcomeGate + tests in lockstep.
    const SOURCE = require("fs").readFileSync(
      require("path").resolve(__dirname, "../src/components/WelcomeSheet.tsx"),
      "utf8",
    );
    for (const id of [
      "welcome-step-hero",
      "welcome-step-auth-email",
      "welcome-step-photo",
      "welcome-step-note",
      "welcome-step-recipient",
      "welcome-step-their-info",
      "welcome-step-your-info",
      "welcome-step-mailed",
    ]) {
      expect(SOURCE).toContain(id);
    }
  });
});
