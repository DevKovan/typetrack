// Unit test (per this issue's Test requirements: "simulate a route change
// ... invoking the registered afterEach-equivalent callback directly").
// Uses a hand-written fake `RouterLike` (see `./registerPageViewTracking.ts`
// for why that type is structural, not a real `vue-router` `Router`
// instance) -- no real Vue Router, no DOM, no Nuxt runtime. Mirrors
// `@typetrack/next`'s issue 003 dedup-assertion precedent (see
// `src/plugins/autoPage.test.ts`'s own dedup tests for the pattern this
// mirrors), applied to this package's own route-tracking plugin.
import { describe, expect, it, mock } from "bun:test";
import type { Analytics, EventMap } from "typetrack";
import type { RouteLike } from "../buildPageViewArgs";
import { registerPageViewTracking, type RouterLike } from "./registerPageViewTracking";

function createFakeAnalytics(): Analytics<EventMap> {
  const track = mock((_event: string, _payload?: Record<string, unknown>) => {});
  const identify = mock((_userId: string, _traits?: Record<string, unknown>) => {});
  const page = mock((_name?: string, _props?: Record<string, unknown>) => {});
  const flush = mock(async () => {});

  return { track, identify, page, flush } as unknown as Analytics<EventMap>;
}

function createFakeRouter(initial: RouteLike): { router: RouterLike; navigate: (to: RouteLike) => void } {
  let afterEachCallback: ((to: RouteLike) => void) | undefined;

  const router: RouterLike = {
    currentRoute: { value: initial },
    afterEach(callback) {
      afterEachCallback = callback;
    },
  };

  return {
    router,
    navigate: (to) => {
      afterEachCallback?.(to);
    },
  };
}

describe("registerPageViewTracking (unit, hand-written fake Router)", () => {
  it("fires one initial dispatch for the router's current route on registration", () => {
    const analytics = createFakeAnalytics();
    const { router } = createFakeRouter({ path: "/home", fullPath: "/home" });

    registerPageViewTracking(analytics, router);

    expect(analytics.page).toHaveBeenCalledTimes(1);
    expect(analytics.page).toHaveBeenCalledWith("/home", undefined);
  });

  it("registers exactly one afterEach listener", () => {
    const analytics = createFakeAnalytics();
    const { path, fullPath } = { path: "/home", fullPath: "/home" };
    let afterEachCallCount = 0;
    const router: RouterLike = {
      currentRoute: { value: { path, fullPath } },
      afterEach: () => {
        afterEachCallCount += 1;
      },
    };

    registerPageViewTracking(analytics, router);

    expect(afterEachCallCount).toBe(1);
  });

  it("fires a second .page() call on a genuinely different afterEach-reported route", () => {
    const analytics = createFakeAnalytics();
    const { router, navigate } = createFakeRouter({ path: "/home", fullPath: "/home" });

    registerPageViewTracking(analytics, router);
    navigate({ path: "/about", fullPath: "/about" });

    expect(analytics.page).toHaveBeenCalledTimes(2);
    expect(analytics.page).toHaveBeenNthCalledWith(1, "/home", undefined);
    expect(analytics.page).toHaveBeenNthCalledWith(2, "/about", undefined);
  });

  it("dedupes a repeated/identical afterEach-reported route into a single delivered .page() call", () => {
    const analytics = createFakeAnalytics();
    const { router, navigate } = createFakeRouter({ path: "/home", fullPath: "/home" });

    registerPageViewTracking(analytics, router); // initial fire: /home
    navigate({ path: "/home", fullPath: "/home" }); // identical -- deduped

    expect(analytics.page).toHaveBeenCalledTimes(1);
  });

  it("includes the query string under props.search for a route with a non-empty query", () => {
    const analytics = createFakeAnalytics();
    const { router } = createFakeRouter({ path: "/search", fullPath: "/search?q=typetrack" });

    registerPageViewTracking(analytics, router);

    expect(analytics.page).toHaveBeenCalledWith("/search", { search: "q=typetrack" });
  });

  it("does not dedup identical routes dispatched against two different analytics instances", () => {
    const analyticsA = createFakeAnalytics();
    const analyticsB = createFakeAnalytics();
    const routerA = createFakeRouter({ path: "/home", fullPath: "/home" }).router;
    const routerB = createFakeRouter({ path: "/home", fullPath: "/home" }).router;

    registerPageViewTracking(analyticsA, routerA);
    registerPageViewTracking(analyticsB, routerB);

    expect(analyticsA.page).toHaveBeenCalledTimes(1);
    expect(analyticsB.page).toHaveBeenCalledTimes(1);
  });
});
