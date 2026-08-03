// Built-in `autoVisibility` plugin (Phase 10 issue 003): a generic,
// framework-agnostic browser plugin that listens for `visibilitychange` on
// `document` and reports each change as a "Page Visibility Changed"
// `.track()` call. See `autoClicks.ts`'s header comment for the shared
// conventions all three DOM-interaction plugins in this issue follow.
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (see `src/context.ts`'s header comment) -- `document`/`addEventListener`
// aren't ambient types here either. The minimal ad-hoc shapes below are
// read directly off `globalThis` (top-level, not nested under a `window`
// object), matching `autoPage.ts`'s precedent.
import type { Plugin } from "../plugins";
import { isBrowserEnvironment } from "../context";

type VisibilityListener = () => void;

interface MinimalDocumentGlobal {
  document?: {
    visibilityState?: string;
    addEventListener?: (type: string, listener: VisibilityListener) => void;
    removeEventListener?: (type: string, listener: VisibilityListener) => void;
  };
}

function documentGlobal(): MinimalDocumentGlobal {
  return globalThis as unknown as MinimalDocumentGlobal;
}

// Browser-only. Listens for `visibilitychange` on `document`. No-ops
// (returns `undefined`, no listener attached) outside a browser
// environment -- never throws. Returns a teardown removing the listener.
export function autoVisibility(): Plugin {
  return function autoVisibilitySetup(analytics) {
    if (!isBrowserEnvironment()) return undefined;

    const doc = documentGlobal().document;
    // Defensive: `isBrowserEnvironment()` only checks `window`/`navigator`
    // -- a `document`-less environment (deliberately, in a test stub, or a
    // genuinely unusual host) still no-ops rather than throwing.
    if (!doc || typeof doc.addEventListener !== "function") return undefined;

    function handleVisibilityChange(): void {
      analytics.track("Page Visibility Changed", { state: doc?.visibilityState });
    }

    doc.addEventListener("visibilitychange", handleVisibilityChange);

    return function autoVisibilityTeardown(): void {
      doc?.removeEventListener?.("visibilitychange", handleVisibilityChange);
    };
  };
}
