// Integration tests for Phase 10 issue 002: a real `createAnalytics({
// plugins: [autoPage()] })`, a hand-written recording stub provider (not a
// mock -- records its own received `.page()` calls into a plain array,
// mirroring `index.middleware.integration.test.ts`'s convention), and a
// stubbed browser global (reusing `src/context.test.ts`'s
// `Object.defineProperty(globalThis, ...)` technique) exercising the full
// round trip: initial fire at construction, `pushState`/`popstate`-driven
// navigation (including a dedup case), non-browser no-op, and
// `destroy()`-driven teardown restoring the original `history` methods.
import { afterEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "../index";
import { autoPage } from "./autoPage";
import type { AnalyticsProvider } from "../providers";
import type { CanonicalEvent } from "../schema";
import { allCapabilities } from "../test-support";

function makeRecordingProvider(): { provider: AnalyticsProvider; pageEvents: CanonicalEvent[] } {
  const pageEvents: CanonicalEvent[] = [];
  const provider: AnalyticsProvider = {
    name: "recording",
    capabilities: allCapabilities,
    track() {},
    page(event) {
      pageEvents.push(event);
    },
    async flush() {},
    async destroy() {},
  };
  return { provider, pageEvents };
}

interface StubbedBrowser {
  location: { pathname: string; search: string };
  history: { pushState: (...args: unknown[]) => unknown; replaceState: (...args: unknown[]) => unknown };
  navigateTo: (pathname: string, search?: string) => void;
  firePopstate: () => void;
}

// Stubs `window`/`navigator`/`location`/`history`/`addEventListener`/
// `removeEventListener` as top-level `globalThis` properties (matching
// `src/context.test.ts`'s convention, and this plugin's own reads off
// `globalThis` directly rather than nested under a `window` object). The
// stub `history.pushState`/`replaceState` are plain recording functions --
// they don't themselves mutate `location` (real browsers do, but nothing in
// this plugin depends on that; `navigateTo` below plays that role
// explicitly, giving each test precise control over what `location` looks
// like at the moment a navigation is "detected").
function stubBrowserGlobals(pathname = "/", search = ""): StubbedBrowser {
  const location = { pathname, search };
  const listeners = new Map<string, Set<() => void>>();

  const history = {
    pushState(..._args: unknown[]): unknown {
      return undefined;
    },
    replaceState(..._args: unknown[]): unknown {
      return undefined;
    },
  };

  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "location", { value: location, configurable: true, writable: true });
  Object.defineProperty(globalThis, "history", { value: history, configurable: true, writable: true });
  Object.defineProperty(globalThis, "addEventListener", {
    value: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "removeEventListener", {
    value: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
    configurable: true,
    writable: true,
  });

  return {
    location,
    history,
    navigateTo(nextPathname: string, nextSearch = "") {
      location.pathname = nextPathname;
      location.search = nextSearch;
    },
    firePopstate() {
      for (const listener of listeners.get("popstate") ?? []) listener();
    },
  };
}

function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator", "location", "history", "addEventListener", "removeEventListener"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearBrowserGlobals();
});

describe("autoPage() integration", () => {
  it("fires one initial .page() call at setup, one more per pushState/popstate navigation, and dedups a pushState immediately followed by a matching popstate", () => {
    const browser = stubBrowserGlobals("/", "");
    const { provider, pageEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoPage()] });

    // Initial fire, representing the page load already in progress.
    expect(pageEvents.length).toBe(1);
    expect(pageEvents[0]!.name).toBe("/");
    expect(pageEvents[0]!.properties).toEqual({});

    // A genuine client-side navigation via pushState.
    browser.navigateTo("/about", "");
    browser.history.pushState({}, "", "/about");
    expect(pageEvents.length).toBe(2);
    expect(pageEvents[1]!.name).toBe("/about");

    // A pushState immediately followed by a matching popstate firing the
    // same computed args -- deduped to zero additional calls.
    browser.navigateTo("/contact", "?a=1");
    browser.history.pushState({}, "", "/contact?a=1");
    expect(pageEvents.length).toBe(3);
    expect(pageEvents[2]!.name).toBe("/contact");
    expect(pageEvents[2]!.properties).toEqual({ search: "?a=1" });

    browser.firePopstate(); // location unchanged since the pushState above.
    expect(pageEvents.length).toBe(3);

    // A genuine back/forward navigation via popstate (location changes
    // first, exactly as a real browser would before firing the event).
    browser.navigateTo("/", "");
    browser.firePopstate();
    expect(pageEvents.length).toBe(4);
    expect(pageEvents[3]!.name).toBe("/");

    void analytics.destroy();
  });

  it("restores the original history.pushState/replaceState after destroy(), and a further navigation produces no further .page() calls", async () => {
    const browser = stubBrowserGlobals("/", "");
    const originalPushState = browser.history.pushState;
    const originalReplaceState = browser.history.replaceState;
    const { provider, pageEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoPage()] });

    // Patched during setup -- no longer the same function reference.
    expect(browser.history.pushState).not.toBe(originalPushState);
    expect(browser.history.replaceState).not.toBe(originalReplaceState);
    expect(pageEvents.length).toBe(1);

    await analytics.destroy();

    expect(browser.history.pushState).toBe(originalPushState);
    expect(browser.history.replaceState).toBe(originalReplaceState);

    browser.navigateTo("/after-destroy", "");
    browser.history.pushState({}, "", "/after-destroy");
    browser.firePopstate();

    expect(pageEvents.length).toBe(1);
  });

  it("never throws and delivers zero .page() calls when no window/navigator/history are present", async () => {
    const { provider, pageEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoPage()] });
    }).not.toThrow();

    expect(pageEvents.length).toBe(0);

    await expect(analytics.destroy()).resolves.toBeUndefined();
  });

  it("a custom getPageArgs overrides the default pathname/search-based computation for the initial fire", () => {
    stubBrowserGlobals("/ignored", "?ignored=1");
    const { provider, pageEvents } = makeRecordingProvider();

    const analytics = createAnalytics({
      provider,
      plugins: [autoPage({ getPageArgs: () => ({ name: "Custom", props: { foo: "bar" } }) })],
    });

    expect(pageEvents.length).toBe(1);
    expect(pageEvents[0]!.name).toBe("Custom");
    expect(pageEvents[0]!.properties).toEqual({ foo: "bar" });

    void analytics.destroy();
  });
});
