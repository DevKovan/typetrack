// This file owns this package's entire happy-dom register/unregister
// lifecycle for the whole `bun test` process -- both the "unit" (isolated
// hook behavior) and "integration" (real `@testing-library/react`
// rendering) test requirements from the issue live here together,
// deliberately, rather than split across separate files. Two verified-by-
// hand constraints force this:
//
// 1. `import "./testSetup"` must run (and finish) strictly before
//    `@testing-library/react`/`@testing-library/dom`/`@testing-library/
//    jest-dom` are loaded at all, in this file or any other -- Bun's ESM
//    loader does not preserve "earlier static `import` finishes running its
//    body first" the way Node's spec-compliant loader does, so those
//    testing-library packages are pulled in via `require(...)` here
//    (guaranteed sequential), not a static `import`, immediately after
//    `import "./testSetup"`.
// 2. `bun test` shares one module registry across every test file in a
//    single repo-wide run (confirmed by hand): a second file's
//    `import "./testSetup"` would be a cached no-op (its top-level
//    `GlobalRegistrator.register()` would not re-run), so if that first
//    file's own `afterAll` had already unregistered happy-dom, a second
//    DOM-rendering test file in this package would run with no DOM at all.
//    Keeping every DOM-touching test in one file, with exactly one
//    `afterAll(() => GlobalRegistrator.unregister())` at the very end,
//    sidesteps that register/unregister-ordering hazard entirely while
//    still guaranteeing (per the issue) that DOM globals are torn down
//    before any other package's test files run later in the same process.
import "./testSetup";

import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Analytics, EventMap } from "typetrack";
import { AnalyticsProvider } from "./AnalyticsProvider";
import { useAnalytics } from "./useAnalytics";

// See the module-level comment above for why these are `require(...)`'d
// (not statically `import`ed) after `import "./testSetup"`. `jest-dom`'s
// shipped types augment the `jest` namespace's `Matchers` interface, not
// `bun:test`'s own `Matchers` type, so it is not usable here as a typed
// matcher (`.toBeInTheDocument()` etc.) without a separate module
// augmentation -- out of scope for this issue. It is still required here so
// its runtime `expect.extend(...)` call happens, matching Bun's documented
// wiring, even though this file's own assertions stick to bun:test's
// built-in matchers.
require("@testing-library/jest-dom");
const { fireEvent, render, renderHook } = require("@testing-library/react") as typeof import("@testing-library/react");

afterAll(() => {
  GlobalRegistrator.unregister();
});

interface TestEvents extends EventMap {
  button_clicked: { label: string };
}

function createFakeAnalytics(): Analytics<TestEvents> {
  // Typed loosely (rather than against `Analytics<TestEvents>["track"]`
  // directly) and cast as a whole below -- `track`'s generic-over-`K`
  // signature does not narrow cleanly through `mock<...>()`'s own generic
  // inference, the same fundamental limitation as any generic method mock.
  const track = mock((_event: keyof TestEvents, _payload?: TestEvents[keyof TestEvents]) => {});
  const identify = mock((_userId: string, _traits?: Record<string, unknown>) => {});
  const page = mock((_name?: string, _props?: Record<string, unknown>) => {});
  const flush = mock(async () => {});

  return { track, identify, page, flush } as unknown as Analytics<TestEvents>;
}

// A realistic consumer component: reads `useAnalytics()` and wires each
// method up to a button's `onClick`, the way an app would.
function ConsumerComponent() {
  const analytics = useAnalytics<TestEvents>();

  return (
    <div>
      <button onClick={() => analytics.track("button_clicked", { label: "cta" })}>track</button>
      <button onClick={() => analytics.identify("user_1", { plan: "pro" })}>identify</button>
      <button onClick={() => analytics.page("home", { referrer: "google" })}>page</button>
      <button onClick={() => void analytics.flush()}>flush</button>
    </div>
  );
}

describe("useAnalytics (unit)", () => {
  it("throws a descriptive error identifying the missing AnalyticsProvider when there is no ancestor provider", () => {
    // React logs a render-throw to `console.error` even with no error
    // boundary present; suppress it for this one assertion, then restore.
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      // Exercises the hook in isolation (no surrounding app component) --
      // this is also how the context's default value is confirmed to be the
      // `undefined` sentinel: if it were anything else (e.g. a fake no-op
      // `Analytics`), this would not throw.
      expect(() => renderHook(() => useAnalytics())).toThrow(/useAnalytics/);
      expect(() => renderHook(() => useAnalytics())).toThrow(/AnalyticsProvider/);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe("AnalyticsProvider + useAnalytics (integration, real @testing-library/react rendering)", () => {
  it("delivers track/identify/page/flush calls through context to a real rendered consumer component", () => {
    const fakeAnalytics = createFakeAnalytics();

    const { getByText } = render(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <ConsumerComponent />
      </AnalyticsProvider>,
    );

    fireEvent.click(getByText("track"));
    fireEvent.click(getByText("identify"));
    fireEvent.click(getByText("page"));
    fireEvent.click(getByText("flush"));

    expect(fakeAnalytics.track).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.track).toHaveBeenCalledWith("button_clicked", { label: "cta" });
    expect(fakeAnalytics.identify).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.identify).toHaveBeenCalledWith("user_1", { plan: "pro" });
    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.page).toHaveBeenCalledWith("home", { referrer: "google" });
    expect(fakeAnalytics.flush).toHaveBeenCalledTimes(1);
    expect(getByText("track")).toBeTruthy();
  });

  it("throws when the same consumer component is rendered without an ancestor AnalyticsProvider", () => {
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => render(<ConsumerComponent />)).toThrow(/AnalyticsProvider/);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
