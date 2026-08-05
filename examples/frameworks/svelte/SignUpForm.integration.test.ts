// This file owns this example's entire happy-dom + Bun-Svelte-loader
// register/unregister lifecycle for the whole `bun test` process, mirroring
// `packages/svelte/src/AnalyticsProvider.test.ts`'s own established
// precedent and reasoning exactly (see `./testSetup.ts`'s own header
// comment for the full "why `await import(...)` after `import
// './testSetup'`" reasoning).
import "./testSetup";

import { afterAll, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createAnalytics } from "typetrack";
import { createStubProvider } from "./stubProvider";

const { render, fireEvent } = await import("@testing-library/svelte");
const { default: AppHarness } = await import("./AppHarness.svelte");
const { default: SignUpForm } = await import("./SignUpForm.svelte");

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("frameworks/svelte example -- CSR (real @testing-library/svelte rendering)", () => {
  it("submitting the form with a valid email calls identify() then track('User Signed Up') against the stub provider", async () => {
    const stub = createStubProvider();
    const analytics = createAnalytics({ provider: stub.provider });

    const { getByPlaceholderText, getByText } = render(AppHarness, { analytics });

    await fireEvent.input(getByPlaceholderText("you@example.com"), { target: { value: "ada@example.com" } });
    await fireEvent.submit(getByText("Sign up").closest("form")!);

    expect(stub.callLog).toEqual([
      { verb: "identify", userId: "ada@example.com", traits: { plan: "free", source: "signup_form" } },
      { verb: "track", eventName: "User Signed Up" },
    ]);
    expect(getByText("Thanks for signing up!")).toBeTruthy();
  });

  it("submitting the form with an invalid email fires no analytics calls at all", async () => {
    const stub = createStubProvider();
    const analytics = createAnalytics({ provider: stub.provider });

    const { getByPlaceholderText, getByText, queryByText } = render(AppHarness, { analytics });

    await fireEvent.input(getByPlaceholderText("you@example.com"), { target: { value: "not-an-email" } });
    await fireEvent.submit(getByText("Sign up").closest("form")!);

    expect(stub.callLog).toEqual([]);
    expect(queryByText("Thanks for signing up!")).toBeNull();
  });

  it("throws a descriptive error when rendered with no ancestor AnalyticsProvider", () => {
    expect(() => render(SignUpForm)).toThrow(/useAnalytics/);
    expect(() => render(SignUpForm)).toThrow(/AnalyticsProvider/);
  });
});
