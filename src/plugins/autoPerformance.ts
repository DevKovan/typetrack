// Built-in `autoPerformance` plugin (Phase 10 issue 004): a generic,
// framework-agnostic browser plugin that reads the Navigation Timing entry
// for the current page load and reports it as a single "Page Performance
// Measured" `.track()` call. See `autoErrors.ts`'s header comment for the
// shared conventions this issue's plugins follow (browser-only guard, named
// setup function, teardown removing every listener attached, never throws).
//
// Intentionally one-shot: Navigation Timing describes a single document
// load, so this plugin does not attempt to re-measure on SPA route changes
// (that's a distinct concern from `autoPage.ts`, out of scope here).
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (see `src/context.ts`'s header comment) -- `performance`/
// `PerformanceNavigationTiming`/`document`/`addEventListener` aren't ambient
// types here either. The minimal ad-hoc shapes below are read directly off
// `globalThis` (top-level, not nested under a `window` object), matching
// `autoPage.ts`'s precedent.
import type { Plugin } from "../plugins";
import { isBrowserEnvironment } from "../context";

// Minimal ad-hoc shape covering exactly what this plugin reads off a real
// `PerformanceNavigationTiming` entry -- deliberately not the real DOM type
// (unavailable without `"dom"` in `tsconfig.json`'s `lib`, see this file's
// header comment).
interface MinimalNavigationTimingEntry {
  responseStart?: number;
  requestStart?: number;
  domContentLoadedEventEnd?: number;
  startTime?: number;
  loadEventEnd?: number;
  domainLookupEnd?: number;
  domainLookupStart?: number;
  connectEnd?: number;
  connectStart?: number;
  responseEnd?: number;
}

export interface PagePerformanceProperties {
  ttfb: number;
  domContentLoaded: number;
  loadComplete: number;
  dnsMs: number;
  tcpMs: number;
  requestMs: number;
  responseMs: number;
}

// Computes the duration fields reported by `autoPerformance()` from a (real
// or fake) `PerformanceNavigationTiming`-shaped entry -- pure, exported for
// direct unit testing without a stubbed `performance` global. Missing
// numeric fields on the entry default to `0` (defensive -- a well-formed
// real navigation entry always has all of these).
export function computePagePerformanceProperties(entry: MinimalNavigationTimingEntry): PagePerformanceProperties {
  const responseStart = entry.responseStart ?? 0;
  const requestStart = entry.requestStart ?? 0;
  const domContentLoadedEventEnd = entry.domContentLoadedEventEnd ?? 0;
  const startTime = entry.startTime ?? 0;
  const loadEventEnd = entry.loadEventEnd ?? 0;
  const domainLookupEnd = entry.domainLookupEnd ?? 0;
  const domainLookupStart = entry.domainLookupStart ?? 0;
  const connectEnd = entry.connectEnd ?? 0;
  const connectStart = entry.connectStart ?? 0;
  const responseEnd = entry.responseEnd ?? 0;

  return {
    ttfb: responseStart - requestStart,
    domContentLoaded: domContentLoadedEventEnd - startTime,
    loadComplete: loadEventEnd - startTime,
    dnsMs: domainLookupEnd - domainLookupStart,
    tcpMs: connectEnd - connectStart,
    requestMs: responseStart - requestStart,
    responseMs: responseEnd - responseStart,
  };
}

type LoadListener = () => void;

interface MinimalPerformanceGlobal {
  performance?: {
    getEntriesByType?: (type: string) => MinimalNavigationTimingEntry[];
  };
  document?: { readyState?: string };
  addEventListener?: (type: string, listener: LoadListener) => void;
  removeEventListener?: (type: string, listener: LoadListener) => void;
}

function performanceGlobal(): MinimalPerformanceGlobal {
  return globalThis as unknown as MinimalPerformanceGlobal;
}

// Browser-only, additionally feature-detecting `performance.getEntriesByType`
// -- no-op (returns `undefined`, no listener attached, no throw) if
// unavailable. If `document.readyState === "complete"` already, reads the
// navigation timing entry immediately; otherwise adds a one-time `window`
// `"load"` listener that reads it once the load event fires. Reads
// `performance.getEntriesByType("navigation")[0]`; if absent/empty, does
// nothing (no `track()` call, no throw). Fires exactly one
// `analytics.track("Page Performance Measured", ...)` per page load.
// Returns a teardown removing the `"load"` listener if it hasn't fired yet
// -- a no-op once the measurement has already happened (nothing left
// registered to remove).
export function autoPerformance(): Plugin {
  return function autoPerformanceSetup(analytics) {
    if (!isBrowserEnvironment()) return undefined;

    const g = performanceGlobal();
    const getEntriesByType = g.performance?.getEntriesByType;
    if (typeof getEntriesByType !== "function") return undefined;

    function measure(): void {
      const [entry] = getEntriesByType!("navigation");
      if (!entry) return;
      analytics.track("Page Performance Measured", computePagePerformanceProperties(entry));
    }

    if (g.document?.readyState === "complete") {
      measure();
      return undefined;
    }

    // Defensive: `isBrowserEnvironment()` only checks `window`/`navigator`
    // -- an `addEventListener`-less environment (deliberately, in a test
    // stub, or a genuinely unusual host) still no-ops rather than throwing.
    if (typeof g.addEventListener !== "function") return undefined;

    function handleLoad(): void {
      g.removeEventListener?.("load", handleLoad);
      measure();
    }

    g.addEventListener("load", handleLoad);

    return function autoPerformanceTeardown(): void {
      g.removeEventListener?.("load", handleLoad);
    };
  };
}
