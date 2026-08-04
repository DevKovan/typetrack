// Built-in `autoWebVitals` plugin (Phase 10 issue 004): a generic,
// framework-agnostic browser plugin that hand-rolls a best-effort subset of
// the "Core Web Vitals" (FCP, LCP, CLS -- deliberately not the full modern
// vitals set, e.g. INP; see this issue's plan file for the scope rationale)
// via `PerformanceObserver`, reporting each as a "Web Vital Measured"
// `.track()` call.
//
// Per `CLAUDE.md`'s "zero vendor deps in core" rule, this is a hand-rolled
// implementation -- no `web-vitals` npm package or any other dependency.
// See `autoErrors.ts`'s header comment for the shared conventions this
// issue's plugins follow (browser-only guard, named setup function, teardown
// removing every listener/observer attached, never throws).
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (see `src/context.ts`'s header comment) -- `PerformanceObserver`/
// `PerformanceEntry`/`document`/`addEventListener` aren't ambient types here
// either. The minimal ad-hoc shapes below are read directly off `globalThis`
// (top-level, not nested under a `window` object), matching `autoPage.ts`'s
// precedent, and are exactly the shape a test needs to stub.
import type { Plugin } from "../plugins";
import { isBrowserEnvironment } from "../context";

export type WebVitalName = "FCP" | "LCP" | "CLS";
export type WebVitalRating = "good" | "needs-improvement" | "poor";

// Fixed published thresholds (ms for FCP/LCP, unitless for CLS).
const WEB_VITAL_THRESHOLDS: Record<WebVitalName, { good: number; needsImprovement: number }> = {
  LCP: { good: 2500, needsImprovement: 4000 },
  CLS: { good: 0.1, needsImprovement: 0.25 },
  FCP: { good: 1800, needsImprovement: 3000 },
};

// Computes the good/needs-improvement/poor rating for a web vital's measured
// value against the fixed published thresholds above -- pure, exported for
// direct unit testing without going through a stubbed `PerformanceObserver`.
export function rateWebVital(name: WebVitalName, value: number): WebVitalRating {
  const { good, needsImprovement } = WEB_VITAL_THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= needsImprovement) return "needs-improvement";
  return "poor";
}

// Minimal ad-hoc shape covering exactly what this plugin reads off a real
// `PerformanceEntry` (a `PerformancePaintTiming`, `LargestContentfulPaint`,
// or `LayoutShift`, depending on which observer produced it) -- deliberately
// not the real DOM types (unavailable without `"dom"` in `tsconfig.json`'s
// `lib`, see this file's header comment).
interface MinimalPerformanceEntry {
  name?: string;
  startTime?: number;
  value?: number;
  hadRecentInput?: boolean;
}

interface MinimalPerformanceObserverEntryList {
  getEntries: () => MinimalPerformanceEntry[];
}

type PerformanceObserverCallback = (list: MinimalPerformanceObserverEntryList) => void;

interface MinimalPerformanceObserverInstance {
  observe: (options: { type: string; buffered?: boolean }) => void;
  disconnect: () => void;
}

type PerformanceObserverConstructor = new (
  callback: PerformanceObserverCallback,
) => MinimalPerformanceObserverInstance;

type VisibilityListener = () => void;

interface MinimalWebVitalsGlobal {
  PerformanceObserver?: PerformanceObserverConstructor;
  document?: {
    visibilityState?: string;
    addEventListener?: (type: string, listener: VisibilityListener) => void;
    removeEventListener?: (type: string, listener: VisibilityListener) => void;
  };
  addEventListener?: (type: string, listener: VisibilityListener) => void;
  removeEventListener?: (type: string, listener: VisibilityListener) => void;
}

function webVitalsGlobal(): MinimalWebVitalsGlobal {
  return globalThis as unknown as MinimalWebVitalsGlobal;
}

// Browser-only, additionally feature-detecting `PerformanceObserver` (via
// `typeof PerformanceObserver !== "undefined"` on the browser global) --
// no-op (returns `undefined`, no observers/listeners attached), never throw,
// if unavailable. Observes "paint" (FCP), "largest-contentful-paint" (LCP),
// and "layout-shift" (CLS), each independently guarded by its own try/catch
// around `observer.observe(...)` -- a browser may support
// `PerformanceObserver` but not every `entryTypes` value (an unsupported
// value throws synchronously per spec), and one unsupported type must not
// prevent the other two from being observed.
//
// FCP fires (at most) once per page: on the first `"first-contentful-paint"`
// entry, its own observer disconnects and the value is reported immediately.
// LCP/CLS entries can fire/accumulate repeatedly; only the latest LCP value
// / running CLS total is tracked, reported once finalized -- on the first
// `visibilitychange` to `"hidden"` or on `pagehide`, whichever fires first
// (the standard recommended LCP-finalization pattern, still hand-rolled, no
// library). If teardown runs before LCP/CLS have naturally finalized, their
// in-progress values are simply never reported -- a known limitation, not a
// forced flush on teardown.
//
// Returns a teardown disconnecting every `PerformanceObserver` created and
// removing the `visibilitychange`/`pagehide` finalization listeners.
export function autoWebVitals(): Plugin {
  return function autoWebVitalsSetup(analytics) {
    if (!isBrowserEnvironment()) return undefined;

    const g = webVitalsGlobal();
    const PerformanceObserverCtor = g.PerformanceObserver;
    if (typeof PerformanceObserverCtor === "undefined") return undefined;

    const observers: MinimalPerformanceObserverInstance[] = [];

    let lcpValue: number | undefined;
    let lcpReported = false;

    let clsValue = 0;
    let clsObserving = false;
    let clsReported = false;

    function reportLCP(): void {
      if (lcpReported || lcpValue === undefined) return;
      lcpReported = true;
      analytics.track("Web Vital Measured", { name: "LCP", value: lcpValue, rating: rateWebVital("LCP", lcpValue) });
    }

    function reportCLS(): void {
      if (clsReported || !clsObserving) return;
      clsReported = true;
      analytics.track("Web Vital Measured", { name: "CLS", value: clsValue, rating: rateWebVital("CLS", clsValue) });
    }

    function handleFinalize(): void {
      reportLCP();
      reportCLS();
    }

    function handleVisibilityChange(): void {
      if (g.document?.visibilityState === "hidden") handleFinalize();
    }

    // "paint" -- FCP, reported once.
    try {
      let fcpReported = false;
      const paintObserver = new PerformanceObserverCtor((list) => {
        if (fcpReported) return;
        for (const entry of list.getEntries()) {
          if (entry.name === "first-contentful-paint") {
            fcpReported = true;
            paintObserver.disconnect();
            const value = entry.startTime ?? 0;
            analytics.track("Web Vital Measured", { name: "FCP", value, rating: rateWebVital("FCP", value) });
            break;
          }
        }
      });
      paintObserver.observe({ type: "paint", buffered: true });
      observers.push(paintObserver);
    } catch {
      // This browser doesn't support the "paint" entry type -- no FCP
      // reported, but LCP/CLS observation below is unaffected.
    }

    // "largest-contentful-paint" -- LCP, latest value tracked, reported once
    // finalized.
    try {
      const lcpObserver = new PerformanceObserverCtor((list) => {
        for (const entry of list.getEntries()) {
          lcpValue = entry.startTime ?? 0;
        }
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
      observers.push(lcpObserver);
    } catch {
      // This browser doesn't support the "largest-contentful-paint" entry
      // type -- no LCP reported, but FCP/CLS observation is unaffected.
    }

    // "layout-shift" -- CLS, running total accumulated (ignoring entries
    // with recent user input), reported once finalized.
    try {
      const clsObserverInstance = new PerformanceObserverCtor((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) clsValue += entry.value ?? 0;
        }
      });
      clsObserverInstance.observe({ type: "layout-shift", buffered: true });
      observers.push(clsObserverInstance);
      clsObserving = true;
    } catch {
      // This browser doesn't support the "layout-shift" entry type -- no CLS
      // reported, but FCP/LCP observation is unaffected.
    }

    g.document?.addEventListener?.("visibilitychange", handleVisibilityChange);
    g.addEventListener?.("pagehide", handleFinalize);

    return function autoWebVitalsTeardown(): void {
      for (const observer of observers) observer.disconnect();
      g.document?.removeEventListener?.("visibilitychange", handleVisibilityChange);
      g.removeEventListener?.("pagehide", handleFinalize);
    };
  };
}
