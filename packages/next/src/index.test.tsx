// This file owns this package's entire happy-dom register/unregister
// lifecycle for the whole `bun test` process -- both the "unit" (reference-
// equality pass-through check) and "integration" (real
// `@testing-library/react` rendering) test requirements from the issue live
// here together, deliberately, rather than split across separate files. See
// `packages/react/src/AnalyticsProvider.test.tsx`'s module-level comment for
// the two verified-by-hand constraints (Bun's ESM loader ordering, and one
// shared module registry across the whole repo-wide `bun test` run) that
// force this structure; duplicated here rather than shared cross-package.
import "./testSetup";

import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { AnalyticsProvider as ReactAnalyticsProvider, useAnalytics as reactUseAnalytics } from "@typetrack/react";
import type { Analytics, EventMap } from "typetrack";
import { AnalyticsProvider, useAnalytics } from "./index";

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
const { fireEvent, render } = require("@testing-library/react") as typeof import("@testing-library/react");

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

// A realistic consumer component: reads `useAnalytics()` (imported from
// `@typetrack/next`) and wires each method up to a button's `onClick`, the
// way an actual Next.js App Router client component would.
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

describe("@typetrack/next re-exports (unit, thin pass-through proof)", () => {
  it("re-exports the exact same AnalyticsProvider implementation as @typetrack/react (reference equality)", () => {
    expect(AnalyticsProvider).toBe(ReactAnalyticsProvider);
  });

  it("re-exports the exact same useAnalytics implementation as @typetrack/react (reference equality)", () => {
    expect(useAnalytics).toBe(reactUseAnalytics);
  });
});

describe("AnalyticsProvider + useAnalytics from @typetrack/next (integration, real @testing-library/react rendering)", () => {
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

  it("throws when the consumer component is rendered without an ancestor AnalyticsProvider", () => {
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => render(<ConsumerComponent />)).toThrow(/AnalyticsProvider/);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
