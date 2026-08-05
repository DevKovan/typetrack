// This file owns this example's entire happy-dom + Bun-Solid-JSX-plugin
// register/unregister lifecycle for the whole `bun test` process, mirroring
// `packages/solid/src/AnalyticsProvider.test.ts`'s own established
// precedent and reasoning exactly (see `./testSetup.ts`'s own header
// comment). Deliberately kept in its own file, separate from
// `index.integration.test.ts`'s SSR tests -- see that file's own header
// comment for why registering happy-dom's DOM globals here would break
// `solid-js/web`'s `renderToString()` if the two lived in the same file.
import "./testSetup";

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createAnalytics } from "typetrack";
import { AnalyticsProvider } from "@typetrack/solid";
import { createStubProvider } from "./stubProvider";

const { cleanup, fireEvent, render } = await import("@solidjs/testing-library");
const { SignUpForm } = await import("./SignUpForm");

afterAll(() => {
  GlobalRegistrator.unregister();
});

// `@solidjs/testing-library`'s own auto-cleanup silently never fires under
// `bun test` (Bun's test runner does not inject `afterEach` as an ambient
// global the way Jest does) -- see `packages/solid/src/
// AnalyticsProvider.test.ts`'s own identical comment.
afterEach(() => {
  cleanup();
});

function buildHarness(analytics: unknown) {
  return () =>
    AnalyticsProvider({
      analytics: analytics as never,
      get children() {
        return SignUpForm();
      },
    });
}

describe("frameworks/solid example -- CSR (real @solidjs/testing-library rendering)", () => {
  it("submitting the form with a valid email calls identify() then track('User Signed Up') against the stub provider", async () => {
    const stub = createStubProvider();
    const analytics = createAnalytics({ provider: stub.provider });

    const { getByPlaceholderText, getByText } = render(buildHarness(analytics));

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

    const { getByPlaceholderText, getByText, queryByText } = render(buildHarness(analytics));

    await fireEvent.input(getByPlaceholderText("you@example.com"), { target: { value: "not-an-email" } });
    await fireEvent.submit(getByText("Sign up").closest("form")!);

    expect(stub.callLog).toEqual([]);
    expect(queryByText("Thanks for signing up!")).toBeNull();
  });

  it("throws a descriptive error when rendered with no ancestor AnalyticsProvider", () => {
    expect(() => render(() => SignUpForm())).toThrow(/useAnalytics/);
    expect(() => render(() => SignUpForm())).toThrow(/AnalyticsProvider/);
  });
});
