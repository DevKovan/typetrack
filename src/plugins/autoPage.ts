// Built-in `autoPage` plugin (Phase 10 issue 002): a generic,
// framework-agnostic browser plugin that detects client-side URL changes via
// the History API (`pushState`/`replaceState` patching + a `popstate`
// listener) and reports each one as a `.page()` call. Deliberately does not
// know about any specific framework's router -- it's usable standalone in
// any plain browser app, mirroring `src/middleware/*.ts`'s one-file-per-
// built-in precedent, just under `src/plugins/` for this phase's own
// vocabulary instead.
//
// `@typetrack/next`'s `AnalyticsPageView` (issue 006) does not call
// `autoPage()` itself -- Next's own router-driven detection
// (`usePathname`/`useSearchParams`) is strictly more accurate for Next apps
// than generic History-API watching. Instead, both this plugin's internal
// listener and `AnalyticsPageView`'s `useEffect` delegate the actual
// "compute args, dedupe, call `.page()`" work to the shared
// `dispatchPageView()` helper exported below -- that's what makes Next's
// component a genuine thin wrapper reusing real plugin code, not a
// parallel/duplicate implementation.
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (see `src/context.ts`'s header comment) -- `history`/`location`/
// `addEventListener` aren't ambient types here either. The minimal ad-hoc
// shapes below are read directly off `globalThis` (top-level, not nested
// under a `window` object) -- matching how `src/context.ts` stubs
// `location` (and how real browsers expose `history`/`addEventListener`/
// `location` as top-level globals, `window` itself just being an alias for
// `globalThis`) -- and are exactly the shape a test needs to stub via
// `Object.defineProperty(globalThis, ...)`, per `src/context.test.ts`'s
// established technique.
import type { Analytics } from "../index";
import type { Plugin } from "../plugins";
import { isBrowserEnvironment } from "../context";

// The args a single page-view dispatch needs. Mirrors
// `@typetrack/next`'s pre-existing (now superseded) local `PageViewArgs`
// shape exactly, so issue 006 can import this type instead of redeclaring
// it.
export interface PageViewArgs {
  name: string;
  props?: Record<string, unknown>;
}

// Dedup state, per `Analytics` instance -- see `dispatchPageView` below.
// Keyed on the `analytics` argument's runtime object identity (works for the
// real `Analytics` instance since `Pick<...>` only narrows the *type*, not
// the object itself) via a `WeakMap`, so unrelated `Analytics` instances
// never share dedup state, and entries are naturally garbage-collected once
// an instance is no longer referenced -- nothing ever needs to be explicitly
// cleared.
const lastDispatchedKey = new WeakMap<object, string>();

// Dedupes consecutive identical dispatches against the SAME analytics
// instance ("identical" meaning same `name` and same JSON-serialized
// `props`) and calls `analytics.page(name, props)`. This exists specifically
// so a double-fire from React Strict Mode's double-invoked effects (Next's
// `AnalyticsPageView`, issue 006) or a redundant `popstate`+`pushState` pair
// (this plugin's own listener, below) doesn't produce two delivered page
// views for what is, from the app's perspective, one navigation.
//
// Never throws even if `JSON.stringify` somehow fails on unusual `props`
// (e.g. a circular reference or a `BigInt`) -- on failure, dedup is skipped
// entirely for that one call and the dispatch proceeds unconditionally,
// rather than throwing out of what's meant to be a fire-and-forget plugin
// path.
export function dispatchPageView(analytics: Pick<Analytics<any>, "page">, args: PageViewArgs): void {
  let dedupKey: string | undefined;
  try {
    dedupKey = `${args.name} ${JSON.stringify(args.props ?? {})}`;
  } catch {
    dedupKey = undefined;
  }

  if (dedupKey !== undefined) {
    if (lastDispatchedKey.get(analytics) === dedupKey) return;
    lastDispatchedKey.set(analytics, dedupKey);
  }

  analytics.page(args.name, args.props);
}

export interface AutoPageOptions {
  // Overrides how `PageViewArgs` are computed for each detected navigation.
  // Defaults to reading `location.pathname` (name) and `location.search`,
  // reported under `props.search` when non-empty (mirrors
  // `buildPageViewArgs.ts`'s existing pre-Phase-10 shape exactly, so a
  // generic browser app's default output matches what `@typetrack/next`
  // already produced).
  getPageArgs?: () => PageViewArgs;
}

interface MinimalLocation {
  pathname?: string;
  search?: string;
}

interface MinimalHistory {
  pushState: (...args: unknown[]) => unknown;
  replaceState: (...args: unknown[]) => unknown;
}

type NavigationListener = () => void;

interface MinimalBrowserGlobal {
  history?: MinimalHistory;
  location?: MinimalLocation;
  addEventListener?: (type: string, listener: NavigationListener) => void;
  removeEventListener?: (type: string, listener: NavigationListener) => void;
}

function browserGlobal(): MinimalBrowserGlobal {
  return globalThis as unknown as MinimalBrowserGlobal;
}

// Default `getPageArgs`: `{ name: location.pathname, props: search ? {
// search } : undefined }` where `search = location.search` -- matches
// `buildPageViewArgs.ts`'s existing shape (issue 006 will point Next's
// version at reusing `PageViewArgs`/`dispatchPageView` from here instead of
// maintaining its own copy of this same logic).
function defaultGetPageArgs(): PageViewArgs {
  const location = browserGlobal().location;
  const search = location?.search ?? "";
  return {
    name: location?.pathname ?? "",
    props: search ? { search } : undefined,
  };
}

// Browser-only. Patches `history.pushState`/`history.replaceState` to also
// notify this plugin's internal listener, and listens for `popstate` (back/
// forward navigation) -- fires once immediately at setup (representing the
// page load that was already in progress when the plugin was registered),
// and again on every detected subsequent client-side navigation, via
// `dispatchPageView()`. No-ops (returns `undefined`, no listeners attached,
// no immediate fire) outside a browser environment -- never throws. Returns
// a teardown restoring the original `pushState`/`replaceState` and removing
// the `popstate` listener.
export function autoPage(options?: AutoPageOptions): Plugin {
  const getPageArgs = options?.getPageArgs ?? defaultGetPageArgs;

  return function autoPageSetup(analytics) {
    if (!isBrowserEnvironment()) return undefined;

    const g = browserGlobal();
    const history = g.history;
    // Defensive: `isBrowserEnvironment()` only checks `window`/`navigator`
    // -- a `history`/`addEventListener`-less environment (deliberately, in
    // a test stub, or a genuinely unusual host) still no-ops rather than
    // throwing.
    if (!history || typeof g.addEventListener !== "function") return undefined;

    function handleNavigation(): void {
      dispatchPageView(analytics, getPageArgs());
    }

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function patchedPushState(...args: unknown[]): unknown {
      const result = originalPushState.apply(history, args);
      handleNavigation();
      return result;
    };
    history.replaceState = function patchedReplaceState(...args: unknown[]): unknown {
      const result = originalReplaceState.apply(history, args);
      handleNavigation();
      return result;
    };

    g.addEventListener("popstate", handleNavigation);

    // Initial fire: represents the page load already in progress when this
    // plugin was registered, in addition to wiring the listeners above for
    // future navigations.
    handleNavigation();

    return function autoPageTeardown(): void {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      g.removeEventListener?.("popstate", handleNavigation);
    };
  };
}
