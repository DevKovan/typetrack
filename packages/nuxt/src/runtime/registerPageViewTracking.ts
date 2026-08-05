import type { Analytics, EventMap } from "typetrack";
import { dispatchPageView } from "typetrack";
import { buildPageViewArgs, type RouteLike } from "../buildPageViewArgs";

// The minimal Vue-Router-`Router`-shaped surface this function needs --
// structural, not `import type { Router } from "vue-router"`, for the same
// reason `RouteLike` (`../buildPageViewArgs.ts`) is structural: keeps this
// package's own `src/**` free of a direct `vue-router` type dependency, and
// (just as importantly here) makes this function trivially fed a
// hand-written fake `Router` in tests, with no real Vue Router instance
// required. A real Vue Router `Router` instance satisfies this type
// structurally with no adapter needed.
export interface RouterLike {
  currentRoute: { value: RouteLike };
  afterEach(callback: (to: RouteLike) => void): void;
}

// Fires one initial `dispatchPageView()` call for the router's current
// route, then registers `router.afterEach()` for every subsequent
// navigation -- mirrors `@typetrack/next`'s `AnalyticsPageView`'s "on
// mount and on every subsequent change" contract (achieved there via
// `useEffect`'s dependency array; achieved here via one direct call before
// the listener is attached). Delegates every dispatch to core's own
// `dispatchPageView()` (Phase 10's dedup-aware helper, from `typetrack`) --
// the same one `autoPage()`/`AnalyticsPageView` already share, not a
// parallel reimplementation. See `./pageview.client.ts` for the thin
// `defineNuxtPlugin` wrapper that calls this against a real
// `useRouter()`/statically-imported analytics instance -- factored apart
// exactly so this function itself is testable with hand-written fakes.
export function registerPageViewTracking<Events extends EventMap = EventMap>(
  analytics: Analytics<Events>,
  router: RouterLike,
): void {
  dispatchPageView(analytics, buildPageViewArgs(router.currentRoute.value));

  router.afterEach((to) => {
    dispatchPageView(analytics, buildPageViewArgs(to));
  });
}
