// This file owns this package's entire happy-dom register/unregister
// lifecycle for the whole `bun test` process -- both the "unit"
// (reference-equality pass-through check) and "integration" (real
// `@testing-library/react` + `react-router` Data/Framework-mode rendering)
// test requirements from the issue live here together, deliberately, rather
// than split across separate files. See
// `packages/react/src/AnalyticsProvider.test.tsx`'s module-level comment for
// the two verified-by-hand constraints (Bun's ESM loader ordering, and one
// shared module registry across the whole repo-wide `bun test` run) that
// force this structure; duplicated here rather than shared cross-package.
import "./testSetup";

import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { AnalyticsProvider as ReactAnalyticsProvider, useAnalytics as reactUseAnalytics } from "@typetrack/react";
import type { Analytics, EventMap } from "typetrack";
// `react-router`'s real Data/Framework-mode testing surface -- not the older
// Declarative-mode-only `<MemoryRouter>` component -- per this issue's Test
// requirements ("exercising `useLocation()` under React Router v8's
// Data/Framework-mode implementation, not the older Declarative-mode-only
// APIs"). `createMemoryRouter` + `<RouterProvider>` is the exact pairing
// `react-router-dom`'s own docs recommend for this, and needs no mocking:
// unlike `next/navigation`, `react-router` ships a real, first-party
// in-memory router for tests.
import { createMemoryRouter, RouterProvider } from "react-router";
import type { RouteObject } from "react-router";

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
const { act, fireEvent, render } = require("@testing-library/react") as typeof import("@testing-library/react");

afterAll(() => {
  // Guarded: see `packages/svelte/src/AnalyticsProvider.test.ts`'s
  // identical afterAll comment -- under `bun test --rerun-each`, this
  // file's hooks re-run per rerun but `./testSetup`'s module-top-level
  // `register()` does not, so an unguarded second `unregister()` throws.
  // Normal CI (`bun run test`) never re-runs this file.
  if (GlobalRegistrator.isRegistered) {
    GlobalRegistrator.unregister();
  }
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
// `@typetrack/remix`) and wires each method up to a button's `onClick`, the
// way an actual React Router v8 framework-mode app would.
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

// A single splat route ("*") matches every path this suite navigates to, so
// one route tree covers every test below -- `AnalyticsPageView`'s own
// `useLocation()` call, not the matched route, is what this suite exercises.
function createTestRouter(children: ReactNode, initialPath: string) {
  const routes: RouteObject[] = [
    {
      path: "*",
      Component: () => <>{children}</>,
    },
  ];

  return createMemoryRouter(routes, { initialEntries: [initialPath] });
}

describe("@typetrack/remix re-exports (unit, thin pass-through proof)", () => {
  it("re-exports the exact same AnalyticsProvider implementation as @typetrack/react (reference equality)", () => {
    expect(AnalyticsProvider).toBe(ReactAnalyticsProvider);
  });

  it("re-exports the exact same useAnalytics implementation as @typetrack/react (reference equality)", () => {
    expect(useAnalytics).toBe(reactUseAnalytics);
  });
});

describe("AnalyticsProvider + useAnalytics from @typetrack/remix (integration, real @testing-library/react rendering)", () => {
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

describe("AnalyticsPageView (integration, real @testing-library/react + react-router Data/Framework-mode rendering)", () => {
  it("calls .page() once on mount with { name: pathname } (no props) when the route has no search string", async () => {
    const fakeAnalytics = createFakeAnalytics();
    const router = createTestRouter(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <AnalyticsPageView />
      </AnalyticsProvider>,
      "/dashboard",
    );

    let container: HTMLElement | undefined;
    await act(async () => {
      ({ container } = render(<RouterProvider router={router} />));
    });

    expect(container).toBeTruthy();
    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.page).toHaveBeenCalledWith("/dashboard", undefined);
  });

  it("calls .page() once on mount with { name: pathname, props: { search } } when the initial route has a search string", async () => {
    const fakeAnalytics = createFakeAnalytics();
    const router = createTestRouter(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <AnalyticsPageView />
      </AnalyticsProvider>,
      "/dashboard?tab=billing",
    );

    await act(async () => {
      render(<RouterProvider router={router} />);
    });

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
    expect(fakeAnalytics.page).toHaveBeenCalledWith("/dashboard", { search: "tab=billing" });
  });

  it("calls .page() again with the new route's args after a real client-side navigation via the router's own navigation API", async () => {
    const fakeAnalytics = createFakeAnalytics();
    const router = createTestRouter(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <AnalyticsPageView />
      </AnalyticsProvider>,
      "/dashboard",
    );

    await act(async () => {
      render(<RouterProvider router={router} />);
    });

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);

    // A real navigation, driven by the data router's own imperative
    // `navigate()` API (the same API `useNavigate()` delegates to) -- not a
    // mocked hook return value.
    await act(async () => {
      await router.navigate("/settings?tab=billing");
    });

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(2);
    expect(fakeAnalytics.page).toHaveBeenNthCalledWith(2, "/settings", { search: "tab=billing" });
  });

  it("does not call .page() again when navigating to the same route/search (dedup via the effect dependency array)", async () => {
    const fakeAnalytics = createFakeAnalytics();
    const router = createTestRouter(
      <AnalyticsProvider analytics={fakeAnalytics}>
        <AnalyticsPageView />
      </AnalyticsProvider>,
      "/dashboard?tab=billing",
    );

    await act(async () => {
      render(<RouterProvider router={router} />);
    });

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);

    // Navigating "again" to the exact same pathname/search -- this pushes a
    // new history entry (a new `Location` object, with a new `key`,
    // simulating an unrelated re-render/navigation event) but leaves
    // `pathname`/`search` unchanged, so `AnalyticsPageView`'s effect
    // dependency array (`[pathname, search, analytics]`, not `location`
    // itself) must not fire a second `.page()` call.
    await act(async () => {
      await router.navigate("/dashboard?tab=billing");
    });

    expect(fakeAnalytics.page).toHaveBeenCalledTimes(1);
  });
});
