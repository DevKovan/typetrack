// Built-in `autoScroll` plugin (Phase 10 issue 003): a generic,
// framework-agnostic browser plugin that listens for `scroll` on `window`
// and reports each configured percent-of-page-scrolled threshold crossed as
// a "Scroll Depth Reached" `.track()` call, at most once per plugin instance
// lifetime per threshold. See `autoClicks.ts`'s header comment for the
// shared conventions all three DOM-interaction plugins in this issue follow.
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (see `src/context.ts`'s header comment) -- `window`/`document`/
// `addEventListener` aren't ambient types here either. The minimal ad-hoc
// shapes below are read directly off `globalThis` (top-level, not nested
// under a `window` object), matching `autoPage.ts`'s precedent.
import type { Plugin } from "../plugins";
import { isBrowserEnvironment } from "../context";

export interface AutoScrollOptions {
  // Percent-of-page-scrolled thresholds to report. Defaults to
  // [25, 50, 75, 100]. Each threshold fires at most once per plugin
  // instance lifetime (not once per page/navigation).
  thresholds?: number[];
}

const DEFAULT_THRESHOLDS = [25, 50, 75, 100];

type ScrollListener = () => void;

interface MinimalDocumentElement {
  scrollHeight?: number;
}

interface MinimalScrollGlobal {
  scrollY?: number;
  innerHeight?: number;
  document?: { documentElement?: MinimalDocumentElement };
  addEventListener?: (type: string, listener: ScrollListener, options?: { passive?: boolean }) => void;
  removeEventListener?: (type: string, listener: ScrollListener) => void;
}

function scrollGlobal(): MinimalScrollGlobal {
  return globalThis as unknown as MinimalScrollGlobal;
}

// Computes the clamped-to-[0, 100] percent-of-page-scrolled value -- pure,
// exported for direct unit testing without going through a real/stubbed
// `scroll` event.
export function computeScrollPercent(state: {
  scrollY: number;
  innerHeight: number;
  scrollHeight: number;
}): number {
  if (state.scrollHeight <= 0) return 0;
  const percent = ((state.scrollY + state.innerHeight) / state.scrollHeight) * 100;
  return Math.max(0, Math.min(100, percent));
}

// Browser-only. Listens for `scroll` on `window` with `{ passive: true }`.
// No-ops (returns `undefined`, no listener attached) outside a browser
// environment -- never throws. Returns a teardown removing the listener and
// clearing the fired-thresholds set.
export function autoScroll(options?: AutoScrollOptions): Plugin {
  const thresholds = [...(options?.thresholds ?? DEFAULT_THRESHOLDS)].sort((a, b) => a - b);

  return function autoScrollSetup(analytics) {
    if (!isBrowserEnvironment()) return undefined;

    const g = scrollGlobal();
    // Defensive: `isBrowserEnvironment()` only checks `window`/`navigator`
    // -- a `document`/`addEventListener`-less environment (deliberately, in
    // a test stub, or a genuinely unusual host) still no-ops rather than
    // throwing.
    if (typeof g.addEventListener !== "function" || !g.document?.documentElement) return undefined;

    const fired = new Set<number>();

    function handleScroll(): void {
      const percent = computeScrollPercent({
        scrollY: g.scrollY ?? 0,
        innerHeight: g.innerHeight ?? 0,
        scrollHeight: g.document?.documentElement?.scrollHeight ?? 0,
      });

      for (const threshold of thresholds) {
        if (fired.has(threshold)) continue;
        if (percent >= threshold) {
          fired.add(threshold);
          analytics.track("Scroll Depth Reached", { percent: threshold });
        }
      }
    }

    g.addEventListener("scroll", handleScroll, { passive: true });

    return function autoScrollTeardown(): void {
      g.removeEventListener?.("scroll", handleScroll);
      fired.clear();
    };
  };
}
