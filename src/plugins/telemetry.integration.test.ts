// Integration tests for Phase 10 issue 004's `autoErrors`/`autoWebVitals`/
// `autoPerformance`: a real `createAnalytics({ plugins: [...] })`, a
// hand-written recording stub provider (not a mock -- records its own
// received `.track()` calls into a plain array, mirroring
// `domInteraction.integration.test.ts`'s convention), and a stubbed browser
// global (reusing `src/context.test.ts`'s
// `Object.defineProperty(globalThis, ...)` technique, extended with a
// minimal stub `PerformanceObserver` -- constructor capturing its callback +
// `type`, a manual way to feed it fake `PerformanceEntry`-like objects, and
// an opt-in "throw on observe() for this type" switch -- plus a minimal
// `performance.getEntriesByType` stub) exercising the full round trip for
// all three plugins: setup, simulated events/entries, and `destroy()`-driven
// teardown.
import { afterEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "../index";
import { autoErrors } from "./autoErrors";
import { autoWebVitals } from "./autoWebVitals";
import { autoPerformance } from "./autoPerformance";
import type { AnalyticsProvider } from "../providers";
import type { CanonicalEvent } from "../schema";
import { allCapabilities } from "../test-support";

function makeRecordingProvider(): { provider: AnalyticsProvider; trackEvents: CanonicalEvent[] } {
  const trackEvents: CanonicalEvent[] = [];
  const provider: AnalyticsProvider = {
    name: "recording",
    capabilities: allCapabilities,
    track(event) {
      trackEvents.push(event);
    },
    async flush() {},
    async destroy() {},
  };
  return { provider, trackEvents };
}

type Listener = (...args: any[]) => void;

interface FakePerformanceEntry {
  name?: string;
  startTime?: number;
  value?: number;
  hadRecentInput?: boolean;
}

// Stub `PerformanceObserver`: a constructor capturing its callback + the
// `type` it was asked to `observe()`, with a class-level registry so tests
// can feed fake entries to whichever instance(s) observe a given type, and
// an opt-in switch to make `observe()` throw synchronously for one
// particular type (simulating a browser that doesn't support that
// `entryTypes` value) without affecting the others.
class StubPerformanceObserver {
  static instances: StubPerformanceObserver[] = [];
  static throwOnType: string | undefined;

  type: string | undefined;
  disconnected = false;
  private readonly callback: (list: { getEntries: () => FakePerformanceEntry[] }) => void;

  constructor(callback: (list: { getEntries: () => FakePerformanceEntry[] }) => void) {
    this.callback = callback;
    StubPerformanceObserver.instances.push(this);
  }

  observe(options: { type: string; buffered?: boolean }): void {
    this.type = options.type;
    if (StubPerformanceObserver.throwOnType === options.type) {
      throw new Error(`unsupported entry type: ${options.type}`);
    }
  }

  disconnect(): void {
    this.disconnected = true;
  }

  feed(entries: FakePerformanceEntry[]): void {
    this.callback({ getEntries: () => entries });
  }
}

interface StubbedBrowser {
  fireError: (event: { message?: string; filename?: string; lineno?: number; colno?: number; error?: { stack?: string } }) => void;
  fireUnhandledRejection: (event: { reason?: unknown }) => void;
  firePagehide: () => void;
  fireVisibilityChange: () => void;
  setVisibilityState: (state: string) => void;
  fireLoad: () => void;
  setReadyState: (state: string) => void;
  feedPerformanceEntries: (type: string, entries: FakePerformanceEntry[]) => void;
  setThrowOnObserveType: (type: string | undefined) => void;
  setNavigationEntries: (entries: unknown[]) => void;
}

// Unlike `window`/`document` (absent from Bun's global scope by default),
// `navigator`/`performance`/`PerformanceObserver`/`addEventListener`/
// `removeEventListener` are real Bun/Node builtins already present on
// `globalThis` -- naively `delete`-ing them (as e.g.
// `domInteraction.integration.test.ts` does for its own, narrower, set of
// stubbed keys) would permanently remove the real ones for the rest of this
// `bun test` process (all files share one process), breaking unrelated
// later test files (e.g. `happy-dom`'s `BrowserWindow` construction reads a
// bare `performance` reference). This module instead snapshots each key's
// original property descriptor (if any) before first stubbing it, and
// restores that exact descriptor (or deletes the key, if it had none) in
// `clearBrowserGlobals()` -- safe for both real builtins and genuinely-absent
// keys.
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function stubGlobal(key: string, value: unknown): void {
  if (!originalDescriptors.has(key)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

// Stubs `window`/`navigator`/`document`/top-level `addEventListener`/
// `removeEventListener`/`PerformanceObserver`/`performance` as top-level
// `globalThis` properties (matching `domInteraction.integration.test.ts`'s
// convention, and these plugins' own reads off `globalThis` directly) --
// see `stubGlobal`'s comment above for why this module restores rather than
// deletes on cleanup.
function stubBrowserGlobals(): StubbedBrowser {
  const documentListeners = new Map<string, Set<Listener>>();
  const windowListeners = new Map<string, Set<Listener>>();
  let navigationEntries: unknown[] = [];

  const documentStub = {
    visibilityState: "visible",
    readyState: "loading",
    addEventListener(type: string, listener: Listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      documentListeners.get(type)?.delete(listener);
    },
  };

  const performanceStub = {
    getEntriesByType(type: string): unknown[] {
      return type === "navigation" ? navigationEntries : [];
    },
  };

  StubPerformanceObserver.instances = [];
  StubPerformanceObserver.throwOnType = undefined;

  stubGlobal("window", {});
  stubGlobal("navigator", {});
  stubGlobal("document", documentStub);
  stubGlobal("performance", performanceStub);
  stubGlobal("PerformanceObserver", StubPerformanceObserver);
  stubGlobal("addEventListener", (type: string, listener: Listener) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type)!.add(listener);
  });
  stubGlobal("removeEventListener", (type: string, listener: Listener) => {
    windowListeners.get(type)?.delete(listener);
  });

  return {
    fireError(event) {
      for (const listener of windowListeners.get("error") ?? []) listener(event);
    },
    fireUnhandledRejection(event) {
      for (const listener of windowListeners.get("unhandledrejection") ?? []) listener(event);
    },
    firePagehide() {
      for (const listener of windowListeners.get("pagehide") ?? []) listener();
    },
    fireVisibilityChange() {
      for (const listener of documentListeners.get("visibilitychange") ?? []) listener();
    },
    setVisibilityState(state: string) {
      documentStub.visibilityState = state;
    },
    fireLoad() {
      for (const listener of windowListeners.get("load") ?? []) listener();
    },
    setReadyState(state: string) {
      documentStub.readyState = state;
    },
    feedPerformanceEntries(type: string, entries: FakePerformanceEntry[]) {
      for (const observer of StubPerformanceObserver.instances) {
        if (observer.type === type && !observer.disconnected) observer.feed(entries);
      }
    },
    setThrowOnObserveType(type: string | undefined) {
      StubPerformanceObserver.throwOnType = type;
    },
    setNavigationEntries(entries: unknown[]) {
      navigationEntries = entries;
    },
  };
}

// Restores each stubbed key's pre-stub descriptor (real Bun/Node builtins
// for `navigator`/`performance`/`PerformanceObserver`/`addEventListener`/
// `removeEventListener`), or deletes it if it had none (`window`/`document`,
// genuinely absent from Bun's global scope) -- see `stubGlobal`'s comment
// above for why this matters.
function clearBrowserGlobals(): void {
  // Only restore/delete keys this cycle actually stubbed (i.e. present in
  // `originalDescriptors`, populated exclusively by `stubGlobal()`) --
  // iterating the full `STUBBED_GLOBAL_KEYS` list unconditionally would
  // wrongly `delete` real Bun/Node builtins (e.g. `performance`,
  // `PerformanceObserver`) for tests that never called
  // `stubBrowserGlobals()`/`stubGlobal()` in the first place (an empty map
  // here does not mean "these were all genuinely absent").
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }
  originalDescriptors.clear();
}

afterEach(() => {
  clearBrowserGlobals();
});

describe("autoErrors() integration", () => {
  it("tracks 'Error Occurred' on a simulated window error event", () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoErrors()] });

    browser.fireError({
      message: "Uncaught ReferenceError: x is not defined",
      filename: "app.js",
      lineno: 10,
      colno: 3,
      error: { stack: "ReferenceError: x is not defined\n  at app.js:10:3" },
    });

    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.name).toBe("Error Occurred");
    expect(trackEvents[0]!.properties).toEqual({
      message: "Uncaught ReferenceError: x is not defined",
      filename: "app.js",
      lineno: 10,
      colno: 3,
      stack: "ReferenceError: x is not defined\n  at app.js:10:3",
    });

    void analytics.destroy();
  });

  it("tracks 'Unhandled Rejection' with the reason string-coercion fallback for a non-Error rejection reason", () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoErrors()] });

    browser.fireUnhandledRejection({ reason: { code: "E_FAIL" } });

    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.name).toBe("Unhandled Rejection");
    expect(trackEvents[0]!.properties).toEqual({ reason: "[object Object]" });

    void analytics.destroy();
  });

  it("teardown removes both listeners -- no further track() calls after destroy()", async () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoErrors()] });
    browser.fireError({ message: "err" });
    browser.fireUnhandledRejection({ reason: "rejected" });
    expect(trackEvents.length).toBe(2);

    await analytics.destroy();

    browser.fireError({ message: "err again" });
    browser.fireUnhandledRejection({ reason: "rejected again" });
    expect(trackEvents.length).toBe(2);
  });

  it("never throws and attaches no listener when no window/navigator are present", async () => {
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoErrors()] });
    }).not.toThrow();

    expect(trackEvents.length).toBe(0);
    await expect(analytics.destroy()).resolves.toBeUndefined();
  });
});

describe("autoWebVitals() integration", () => {
  it("tracks FCP once, at each rating boundary, on the first first-contentful-paint entry", () => {
    for (const [value, rating] of [
      [1000, "good"],
      [2000, "needs-improvement"],
      [5000, "poor"],
    ] as const) {
      const browser = stubBrowserGlobals();
      const { provider, trackEvents } = makeRecordingProvider();

      const analytics = createAnalytics({ provider, plugins: [autoWebVitals()] });

      browser.feedPerformanceEntries("paint", [{ name: "some-other-paint-entry" }]);
      browser.feedPerformanceEntries("paint", [{ name: "first-contentful-paint", startTime: value }]);
      // A second first-contentful-paint entry must not refire.
      browser.feedPerformanceEntries("paint", [{ name: "first-contentful-paint", startTime: value + 1000 }]);

      const fcpEvents = trackEvents.filter((e) => e.properties?.name === "FCP");
      expect(fcpEvents.length).toBe(1);
      expect(fcpEvents[0]!.name).toBe("Web Vital Measured");
      expect(fcpEvents[0]!.properties).toEqual({ name: "FCP", value, rating });

      void analytics.destroy();
      clearBrowserGlobals();
    }
  });

  it("tracks LCP with the latest value seen, at each rating boundary, finalized on visibilitychange->hidden", () => {
    for (const [value, rating] of [
      [1500, "good"],
      [3500, "needs-improvement"],
      [6000, "poor"],
    ] as const) {
      const browser = stubBrowserGlobals();
      const { provider, trackEvents } = makeRecordingProvider();

      const analytics = createAnalytics({ provider, plugins: [autoWebVitals()] });

      browser.feedPerformanceEntries("largest-contentful-paint", [{ startTime: 500 }]);
      browser.feedPerformanceEntries("largest-contentful-paint", [{ startTime: value }]);

      browser.setVisibilityState("hidden");
      browser.fireVisibilityChange();

      const lcpEvents = trackEvents.filter((e) => e.properties?.name === "LCP");
      expect(lcpEvents.length).toBe(1);
      expect(lcpEvents[0]!.properties).toEqual({ name: "LCP", value, rating });

      // A subsequent visibilitychange->hidden must not refire.
      browser.setVisibilityState("visible");
      browser.fireVisibilityChange();
      browser.setVisibilityState("hidden");
      browser.fireVisibilityChange();
      expect(trackEvents.filter((e) => e.properties?.name === "LCP").length).toBe(1);

      void analytics.destroy();
      clearBrowserGlobals();
    }
  });

  it("tracks CLS as an accumulated total (ignoring entries with recent input), at each rating boundary, finalized on pagehide", () => {
    for (const [values, rating] of [
      [[0.02, 0.03], "good"], // total 0.05
      [[0.1, 0.1], "needs-improvement"], // total 0.2
      [[0.2, 0.2], "poor"], // total 0.4
    ] as const) {
      const browser = stubBrowserGlobals();
      const { provider, trackEvents } = makeRecordingProvider();

      const analytics = createAnalytics({ provider, plugins: [autoWebVitals()] });

      for (const value of values) {
        browser.feedPerformanceEntries("layout-shift", [{ value, hadRecentInput: false }]);
      }
      // Ignored: recent user input.
      browser.feedPerformanceEntries("layout-shift", [{ value: 10, hadRecentInput: true }]);

      browser.firePagehide();

      const clsEvents = trackEvents.filter((e) => e.properties?.name === "CLS");
      expect(clsEvents.length).toBe(1);
      const total = values.reduce((sum, v) => sum + v, 0);
      expect(clsEvents[0]!.properties!.value as number).toBeCloseTo(total, 10);
      expect(clsEvents[0]!.properties!.rating).toBe(rating);

      void analytics.destroy();
      clearBrowserGlobals();
    }
  });

  it("no-ops (no throw, zero track calls) when PerformanceObserver is undefined", async () => {
    const browser = stubBrowserGlobals();
    // Overwrites (not `delete`s -- see `stubGlobal`'s comment above) the
    // real builtin with `undefined`, restored by `clearBrowserGlobals()` in
    // `afterEach`.
    stubGlobal("PerformanceObserver", undefined);
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoWebVitals()] });
    }).not.toThrow();

    browser.fireVisibilityChange();
    expect(trackEvents.length).toBe(0);
    await expect(analytics.destroy()).resolves.toBeUndefined();
  });

  it("no-ops for one entryTypes value that throws on observe(), while the other two are still observed", () => {
    const browser = stubBrowserGlobals();
    browser.setThrowOnObserveType("layout-shift");
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoWebVitals()] });
    }).not.toThrow();

    browser.feedPerformanceEntries("paint", [{ name: "first-contentful-paint", startTime: 1000 }]);
    browser.feedPerformanceEntries("largest-contentful-paint", [{ startTime: 2000 }]);
    // layout-shift was never successfully observed -- feeding it has no
    // registered stub observer to deliver to, matching a real browser that
    // rejected the observe() call.
    browser.feedPerformanceEntries("layout-shift", [{ value: 0.5, hadRecentInput: false }]);

    browser.setVisibilityState("hidden");
    browser.fireVisibilityChange();

    expect(trackEvents.map((e) => e.properties?.name).sort()).toEqual(["FCP", "LCP"]);

    void analytics.destroy();
  });

  it("teardown disconnects observers and removes the visibilitychange/pagehide listeners -- no further track() calls after destroy()", async () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoWebVitals()] });

    browser.feedPerformanceEntries("largest-contentful-paint", [{ startTime: 1000 }]);

    await analytics.destroy();

    browser.setVisibilityState("hidden");
    browser.fireVisibilityChange();
    browser.firePagehide();

    expect(trackEvents.filter((e) => e.properties?.name === "LCP").length).toBe(0);
  });

  it("never throws and reports nothing when no window/navigator are present", async () => {
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoWebVitals()] });
    }).not.toThrow();

    expect(trackEvents.length).toBe(0);
    await expect(analytics.destroy()).resolves.toBeUndefined();
  });
});

describe("autoPerformance() integration", () => {
  it("tracks 'Page Performance Measured' with correctly-computed duration fields once the load event fires", () => {
    const browser = stubBrowserGlobals();
    browser.setReadyState("loading");
    browser.setNavigationEntries([
      {
        startTime: 0,
        domainLookupStart: 10,
        domainLookupEnd: 20,
        connectStart: 20,
        connectEnd: 35,
        requestStart: 35,
        responseStart: 60,
        responseEnd: 90,
        domContentLoadedEventEnd: 150,
        loadEventEnd: 220,
      },
    ]);
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoPerformance()] });
    expect(trackEvents.length).toBe(0);

    browser.fireLoad();

    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.name).toBe("Page Performance Measured");
    expect(trackEvents[0]!.properties).toEqual({
      ttfb: 25,
      domContentLoaded: 150,
      loadComplete: 220,
      dnsMs: 10,
      tcpMs: 15,
      requestMs: 25,
      responseMs: 30,
    });

    void analytics.destroy();
  });

  it("reads the navigation entry immediately when document.readyState is already 'complete'", () => {
    const browser = stubBrowserGlobals();
    browser.setReadyState("complete");
    browser.setNavigationEntries([
      {
        startTime: 0,
        domainLookupStart: 0,
        domainLookupEnd: 0,
        connectStart: 0,
        connectEnd: 0,
        requestStart: 0,
        responseStart: 5,
        responseEnd: 10,
        domContentLoadedEventEnd: 50,
        loadEventEnd: 80,
      },
    ]);
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoPerformance()] });

    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.name).toBe("Page Performance Measured");

    void analytics.destroy();
  });

  it("fires exactly one track() call even if load somehow fires more than once", () => {
    const browser = stubBrowserGlobals();
    browser.setReadyState("loading");
    browser.setNavigationEntries([{ startTime: 0, responseStart: 1, requestStart: 0 }]);
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoPerformance()] });
    browser.fireLoad();
    browser.fireLoad();

    expect(trackEvents.length).toBe(1);

    void analytics.destroy();
  });

  it("no-ops (no throw, zero track calls) when performance/getEntriesByType is unavailable", async () => {
    const browser = stubBrowserGlobals();
    // Overwrites (not `delete`s -- see `stubGlobal`'s comment above) the
    // real builtin with `undefined`, restored by `clearBrowserGlobals()` in
    // `afterEach`.
    stubGlobal("performance", undefined);
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoPerformance()] });
    }).not.toThrow();

    browser.fireLoad();
    expect(trackEvents.length).toBe(0);
    await expect(analytics.destroy()).resolves.toBeUndefined();
  });

  it("no-ops (no throw, zero track calls) when the navigation entries list is empty", () => {
    const browser = stubBrowserGlobals();
    browser.setReadyState("complete");
    browser.setNavigationEntries([]);
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoPerformance()] });

    expect(trackEvents.length).toBe(0);

    void analytics.destroy();
  });

  it("teardown removes the pre-fire load listener -- no track() call after destroy() followed by a simulated late load", async () => {
    const browser = stubBrowserGlobals();
    browser.setReadyState("loading");
    browser.setNavigationEntries([{ startTime: 0, responseStart: 1, requestStart: 0 }]);
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoPerformance()] });

    await analytics.destroy();

    browser.fireLoad();
    expect(trackEvents.length).toBe(0);
  });

  it("never throws and reports nothing when no window/navigator are present", async () => {
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoPerformance()] });
    }).not.toThrow();

    expect(trackEvents.length).toBe(0);
    await expect(analytics.destroy()).resolves.toBeUndefined();
  });
});
