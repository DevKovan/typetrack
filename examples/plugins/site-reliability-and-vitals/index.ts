import { autoErrors, autoPerformance, autoWebVitals, createAnalytics, type AnalyticsProvider } from "typetrack";

// A realistic site-reliability-and-performance scenario composing the 3
// Phase 10 telemetry plugins (raw browser telemetry, as opposed to the
// page/session/interaction plugins covered in
// `../landing-page-engagement`): `autoErrors()`, `autoWebVitals()`,
// `autoPerformance()`. Every log line below (`sink`) is produced by an
// actual `typetrack` run -- nothing here is a hand-authored transcript --
// so `index.integration.test.ts` can assert against it directly and
// `expected-output.txt` is a literal capture of `bun run index.ts`'s
// stdout.
//
// None of `window`/`navigator`/`document`/`PerformanceObserver`/
// `performance` exist in a plain Bun script, so this file simulates a "real
// page" by stubbing those globals directly on `globalThis` before calling
// into `typetrack` -- the exact technique established by
// `src/context.test.ts` (Phase 9) and reused by
// `src/plugins/telemetry.integration.test.ts` (Phase 10 issue 004).

export interface CallLogEntry {
  name: string;
  properties: Record<string, unknown>;
}

// Renders one provider-received call into a human-readable line, pushes it
// into `sink` (for assertions), and mirrors it to `console.log` -- mirrors
// `../landing-page-engagement/index.ts`'s `makeLog`.
function makeLog(sink: string[]): (message: string) => void {
  return (message) => {
    sink.push(message);
    console.log(message);
  };
}

// A hand-written stub provider standing in for a real error-tracking +
// performance-monitoring backend. Records every `.track()` call it
// receives, both structurally (`callLog`, for assertions) and as a
// human-readable narrative line (`sink`/console).
export function createReliabilityWarehouseProvider(callLog: CallLogEntry[], sink: string[]): AnalyticsProvider {
  const log = makeLog(sink);

  return {
    name: "reliability-warehouse",
    capabilities: {
      identify: false,
      group: false,
      alias: false,
      page: false,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },
    track(event) {
      callLog.push({ name: event.name, properties: event.properties });
      log(`[provider] reliability-warehouse received track("${event.name}") ${JSON.stringify(event.properties)}`);
    },
  };
}

interface FakePerformanceEntry {
  name?: string;
  startTime?: number;
  value?: number;
  hadRecentInput?: boolean;
}

interface FakeNavigationEntry {
  startTime?: number;
  domainLookupStart?: number;
  domainLookupEnd?: number;
  connectStart?: number;
  connectEnd?: number;
  requestStart?: number;
  responseStart?: number;
  responseEnd?: number;
  domContentLoadedEventEnd?: number;
  loadEventEnd?: number;
}

// A minimal stub `PerformanceObserver`: a constructor capturing its
// callback and the `type` it was asked to `observe()`, with a class-level
// registry so this file's own `feedPerformanceEntries()` can deliver fake
// entries to whichever instance(s) observe a given type -- mirrors
// `src/plugins/telemetry.integration.test.ts`'s `StubPerformanceObserver`
// (without that file's additional "throw on observe() for this type"
// switch, which this composed example doesn't need -- both are exercised
// per-plugin already by `src/plugins/autoWebVitals.test.ts`/
// `telemetry.integration.test.ts`).
class StubPerformanceObserver {
  static instances: StubPerformanceObserver[] = [];

  type: string | undefined;
  disconnected = false;
  private readonly callback: (list: { getEntries: () => FakePerformanceEntry[] }) => void;

  constructor(callback: (list: { getEntries: () => FakePerformanceEntry[] }) => void) {
    this.callback = callback;
    StubPerformanceObserver.instances.push(this);
  }

  observe(options: { type: string; buffered?: boolean }): void {
    this.type = options.type;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  feed(entries: FakePerformanceEntry[]): void {
    this.callback({ getEntries: () => entries });
  }
}

type Listener = (...args: unknown[]) => void;

export interface StubbedReliabilityBrowser {
  fireError: (event: { message?: string; filename?: string; lineno?: number; colno?: number; error?: { stack?: string } }) => void;
  fireUnhandledRejection: (event: { reason?: unknown }) => void;
  feedPerformanceEntries: (type: string, entries: FakePerformanceEntry[]) => void;
  setVisibilityState: (state: string) => void;
  fireVisibilityChange: () => void;
  setNavigationEntries: (entries: FakeNavigationEntry[]) => void;
  fireLoad: () => void;
}

// Unlike `window`/`document` (genuinely absent from Bun's global scope by
// default), `navigator`/`performance`/`PerformanceObserver`/
// `addEventListener`/`removeEventListener` are real Bun builtins already
// present on `globalThis` -- naively `delete`-ing them in
// `clearStubBrowser()` would permanently remove the real ones for the rest
// of this `bun test` process (all files share one process), breaking
// unrelated later test files (e.g. `happy-dom`'s `BrowserWindow`
// construction reads a bare `performance` reference). This module instead
// snapshots each key's original property descriptor (if any) before first
// stubbing it, and restores that exact descriptor (or deletes the key, if
// it had none) in `clearStubBrowser()` -- safe for both real builtins and
// genuinely-absent keys. Mirrors
// `src/plugins/telemetry.integration.test.ts`'s `stubGlobal`/
// `clearBrowserGlobals` convention exactly.
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function stubGlobal(key: string, value: unknown): void {
  if (!originalDescriptors.has(key)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

// Stubs `window`/`navigator`/`document`/top-level `addEventListener`/
// `removeEventListener`/`PerformanceObserver`/`performance` as top-level
// `globalThis` properties -- matching
// `src/plugins/telemetry.integration.test.ts`'s convention, and every
// Phase 10 telemetry plugin's own reads off `globalThis` directly (not
// nested under a `window` object).
function installStubBrowser(): StubbedReliabilityBrowser {
  const documentListeners = new Map<string, Set<Listener>>();
  const windowListeners = new Map<string, Set<Listener>>();
  let navigationEntries: FakeNavigationEntry[] = [];

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
    feedPerformanceEntries(type, entries) {
      for (const observer of StubPerformanceObserver.instances) {
        if (observer.type === type && !observer.disconnected) observer.feed(entries);
      }
    },
    setVisibilityState(state) {
      documentStub.visibilityState = state;
    },
    fireVisibilityChange() {
      for (const listener of documentListeners.get("visibilitychange") ?? []) listener();
    },
    setNavigationEntries(entries) {
      navigationEntries = entries;
    },
    fireLoad() {
      for (const listener of windowListeners.get("load") ?? []) listener();
    },
  };
}

// Restores each stubbed key's pre-stub descriptor (the real Bun builtins
// for `navigator`/`performance`/`PerformanceObserver`/`addEventListener`/
// `removeEventListener`), or deletes it if it had none (`window`/
// `document`, genuinely absent from Bun's global scope) -- see
// `stubGlobal`'s comment above for why this matters.
function clearStubBrowser(): void {
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }
  originalDescriptors.clear();
}

export interface SiteReliabilityAndVitalsResult {
  // Every log line produced across the whole flow, in the exact order
  // `bun run index.ts` prints them -- this is what `expected-output.txt`
  // captures verbatim.
  sink: string[];
  // What the provider actually received, in call order.
  callLog: CallLogEntry[];
}

// The example's real entry point: a single page load's reliability and
// performance telemetry, walked scenario by scenario. Exported (rather
// than only run inline) so `index.integration.test.ts` runs this exact
// function.
export async function runSiteReliabilityAndVitalsFlow(): Promise<SiteReliabilityAndVitalsResult> {
  const sink: string[] = [];
  const callLog: CallLogEntry[] = [];
  const log = makeLog(sink);

  console.log("=== Step 1: createAnalytics({ plugins: [autoErrors(), autoWebVitals(), autoPerformance()] }) ===");
  const browser = installStubBrowser();
  const provider = createReliabilityWarehouseProvider(callLog, sink);

  const analytics = createAnalytics({
    provider,
    plugins: [autoErrors(), autoWebVitals(), autoPerformance()],
  });
  log(`[flow] setup produced ${callLog.length} provider call(s) (all 3 plugins are listener-only at setup)`);

  console.log('\n=== Step 2: a thrown error in application code reaches window\'s "error" event ===');
  browser.fireError({
    message: "TypeError: Cannot read properties of undefined (reading 'total')",
    filename: "checkout-summary.js",
    lineno: 42,
    colno: 17,
    error: { stack: "TypeError: Cannot read properties of undefined (reading 'total')\n  at renderSummary (checkout-summary.js:42:17)" },
  });

  console.log('\n=== Step 3: an unhandled promise rejection with a non-Error reason (a plain string) ===');
  browser.fireUnhandledRejection({ reason: "Network request timed out" });

  console.log("\n=== Step 4: Web Vitals -- FCP (good), LCP (poor), CLS (needs-improvement), finalized on visibilitychange -> hidden ===");
  // FCP: reported immediately on the first "first-contentful-paint" entry --
  // no finalization event needed.
  browser.feedPerformanceEntries("paint", [{ name: "first-contentful-paint", startTime: 1200 }]);

  // LCP: only the latest value is kept; an earlier, smaller candidate is
  // superseded by a later, larger one (a realistic sequence -- the largest
  // contentful element on this page loads in late, e.g. a hero image).
  browser.feedPerformanceEntries("largest-contentful-paint", [{ startTime: 1800 }]);
  browser.feedPerformanceEntries("largest-contentful-paint", [{ startTime: 4200 }]);

  // CLS: an accumulated running total, ignoring entries with recent user
  // input (e.g. a layout shift caused by the visitor's own click, not a
  // surprise reflow).
  browser.feedPerformanceEntries("layout-shift", [{ value: 0.07, hadRecentInput: false }]);
  browser.feedPerformanceEntries("layout-shift", [{ value: 0.08, hadRecentInput: false }]);
  browser.feedPerformanceEntries("layout-shift", [{ value: 0.5, hadRecentInput: true }]);

  // LCP/CLS finalize on the first visibilitychange -> "hidden" (the
  // standard recommended finalization pattern) -- FCP already fired above.
  browser.setVisibilityState("hidden");
  browser.fireVisibilityChange();

  console.log('\n=== Step 5: navigation timing -- a fake "navigation" entry, finalized on the "load" event ===');
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
  browser.fireLoad();

  console.log("\n=== Step 6: analytics.destroy() -- autoErrors()'s listeners are removed; a further simulated error produces no event ===");
  const callCountBeforeDestroy = callLog.length;
  await analytics.destroy();

  browser.fireError({ message: "this must never be tracked -- destroy() already ran" });
  browser.fireUnhandledRejection({ reason: "this must never be tracked either" });

  log(
    `[flow] ${callLog.length - callCountBeforeDestroy} provider call(s) after destroy() (expected: 0, was ${callCountBeforeDestroy} before)`,
  );

  clearStubBrowser();

  return { sink, callLog };
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  await runSiteReliabilityAndVitalsFlow();
}
