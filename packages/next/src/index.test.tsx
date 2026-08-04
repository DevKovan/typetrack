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

import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { StrictMode } from "react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { AnalyticsProvider as ReactAnalyticsProvider, useAnalytics as reactUseAnalytics } from "@typetrack/react";
import { dispatchPageView } from "typetrack";
import type { Analytics, EventMap } from "typetrack";

// `next/navigation`'s `usePathname`/`useSearchParams` (consumed by
// `./AnalyticsPageView`, transitively pulled in by `./index` below) are
// mocked here via `mock.module`, following this repo's existing
// `mock.module` convention from `packages/provider-posthog/src/index.test.ts`.
// The mutable `mockPathname`/`mockSearch` closure variables let individual
// tests change what the mocked hooks return between renders, to exercise
// the pageview-on-route-change behavior without a real Next.js router.
//
// This -- not a static top-of-file import -- is *why* `./index` (and hence
// `AnalyticsProvider`/`useAnalytics` too, reused below for the pre-existing
// re-export tests) is imported dynamically after this `mock.module` call:
// ES module static imports are hoisted and fully evaluated before any other
// statement in this file runs, so a static `import ... from "./index"` here
// would resolve (and cache) the *real* `next/navigation` module before this
// `mock.module` call ever had a chance to run.
let mockPathname = "/";
let mockSearch = "";

const usePathname = mock(() => mockPathname);
const useSearchParams = mock(() => new URLSearchParams(mockSearch));

mock.module("next/navigation", () => ({ usePathname, useSearchParams }));

const { AnalyticsProvider, useAnalytics, AnalyticsPageView } = await import("./index");

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

describe("AnalyticsPageView (integration, real @testing-library/react rendering, mocked next/navigation)", () => {
  beforeEach(() => {
    mockPathname = "/";
    mockSearch = "";
    usePathname.mockClear();
    useSearchParams.mockClear();
  });

  it("mounts successfully with no consumer-provided Suspense boundary, and calls .page() once on mount with { name: pathname } when search params are empty", () => {
    const fakeAnalytics = createFakeAnalytics();
    mockPathname = "/dashboard";
    mockSearch = "";

    // No `<Suspense>` wraps `<AnalyticsPageView />` here -- proving the
    // component's own internal Suspense boundary (see `AnalyticsPageView.tsx`)
    // is sufficient for it to mount at all, per this issue's Acceptance
    // criteria and Test requirements.
    const { container } = render(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <AnalyticsPageView />
      </AnalyticsProvider>,
    );

    expect(container).toBeTruthy();
    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.page).toHaveBeenCalledWith("/dashboard", undefined);
  });

  it("calls .page() once on mount with { name: pathname, props: { search } } when search params are non-empty", () => {
    const fakeAnalytics = createFakeAnalytics();
    mockPathname = "/dashboard";
    mockSearch = "tab=billing";

    render(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <AnalyticsPageView />
      </AnalyticsProvider>,
    );

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.page).toHaveBeenCalledWith("/dashboard", { search: "tab=billing" });
  });

  it("calls .page() again with the new args after the mocked pathname/searchParams change and a rerender", () => {
    const fakeAnalytics = createFakeAnalytics();
    mockPathname = "/dashboard";
    mockSearch = "";

    const { rerender } = render(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <AnalyticsPageView />
      </AnalyticsProvider>,
    );

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);

    // Simulate client-side route navigation: the mocked hooks now return a
    // new pathname/search, then the tree is force-rerendered (the same way
    // Next.js's App Router re-renders this component's ancestor layout on
    // navigation).
    mockPathname = "/settings";
    mockSearch = "tab=billing";

    rerender(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <AnalyticsPageView />
      </AnalyticsProvider>,
    );

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(2);
    expect(fakeAnalytics.page).toHaveBeenNthCalledWith(2, "/settings", { search: "tab=billing" });
  });

  it("does not call .page() again on a rerender with the same mocked pathname/searchParams (dedup via the effect dependency array)", () => {
    const fakeAnalytics = createFakeAnalytics();
    mockPathname = "/dashboard";
    mockSearch = "tab=billing";

    const { rerender } = render(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <AnalyticsPageView />
      </AnalyticsProvider>,
    );

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);

    // An unrelated parent re-render: the mocked pathname/searchParams values
    // are left unchanged, only the tree is rerendered.
    rerender(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <AnalyticsPageView />
      </AnalyticsProvider>,
    );

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
  });
});

describe("AnalyticsPageView under React.StrictMode (integration, real @testing-library/react rendering, Phase 10 issue 006)", () => {
  beforeEach(() => {
    mockPathname = "/";
    mockSearch = "";
    usePathname.mockClear();
    useSearchParams.mockClear();
  });

  // Proves `AnalyticsPageView.tsx`'s `useEffect` now delegates to
  // `dispatchPageView` (not `analytics.page` directly): React 19's
  // `<StrictMode>` double-invokes effects in development (verified above --
  // the same `render()` under `<StrictMode>` calls a plain `useEffect`
  // callback twice for one mount, in this exact test environment), which
  // would otherwise mean two identical `.page()` calls for one real
  // navigation. Because both invocations compute the exact same
  // `PageViewArgs` (same `pathname`/`searchParams`, unchanged between the two
  // invocations), `dispatchPageView`'s own dedup (`src/plugins/autoPage.ts`,
  // issue 002) collapses them into exactly one delivered `.page()` call.
  it("delivers exactly one .page() call on mount, not two, when double-invoked by React.StrictMode", () => {
    const fakeAnalytics = createFakeAnalytics();
    mockPathname = "/dashboard";
    mockSearch = "tab=billing";

    const { container } = render(
      <StrictMode>
        <AnalyticsProvider analytics={fakeAnalytics}>
          <AnalyticsPageView />
        </AnalyticsProvider>
      </StrictMode>,
    );

    expect(container).toBeTruthy();
    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.page).toHaveBeenCalledWith("/dashboard", { search: "tab=billing" });
  });

  // Complements the rendering-based proof above with a direct, unit-level
  // demonstration of the exact mechanism `AnalyticsPageView.tsx`'s
  // `useEffect` now relies on: calling the same shared `dispatchPageView`
  // helper (imported here from `typetrack`, the same import
  // `AnalyticsPageView.tsx` itself uses) twice in a row against the same
  // analytics instance with identical computed `PageViewArgs` -- exactly
  // what two Strict-Mode-double-invoked runs of the tracker's effect body
  // would produce -- still results in only one delivered `.page()` call.
  it("dispatchPageView collapses two consecutive calls with identical args against the same analytics instance into one .page() call", () => {
    const fakeAnalytics = createFakeAnalytics();

    dispatchPageView(fakeAnalytics, { name: "/dashboard", props: { search: "tab=billing" } });
    dispatchPageView(fakeAnalytics, { name: "/dashboard", props: { search: "tab=billing" } });

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.page).toHaveBeenCalledWith("/dashboard", { search: "tab=billing" });
  });
});
