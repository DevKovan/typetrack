// Built-in `autoErrors` plugin (Phase 10 issue 004): a generic,
// framework-agnostic browser plugin that listens for `error` and
// `unhandledrejection` on `window` and reports each as an "Error Occurred"/
// "Unhandled Rejection" `.track()` call respectively. See
// `autoScroll.ts`/`autoClicks.ts`/`autoVisibility.ts`'s header comments for
// the shared conventions this issue's plugins (autoErrors/autoWebVitals/
// autoPerformance) follow too: browser-only guard, named setup function,
// teardown removing every listener attached, never throws.
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (see `src/context.ts`'s header comment) -- `window`/`ErrorEvent`/
// `PromiseRejectionEvent`/`addEventListener` aren't ambient types here
// either. The minimal ad-hoc shapes below are read directly off `globalThis`
// (top-level, not nested under a `window` object), matching `autoPage.ts`'s
// precedent.
import type { Plugin } from "../plugins";
import { isBrowserEnvironment } from "../context";

// Minimal ad-hoc shape covering exactly what this plugin reads off a real
// `ErrorEvent` -- deliberately not the real DOM `ErrorEvent` type
// (unavailable without `"dom"` in `tsconfig.json`'s `lib`, see this file's
// header comment).
interface MinimalErrorEvent {
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  error?: { stack?: string };
}

// Ditto for `PromiseRejectionEvent`.
interface MinimalPromiseRejectionEvent {
  reason?: unknown;
}

type ErrorListener = (event: MinimalErrorEvent) => void;
type RejectionListener = (event: MinimalPromiseRejectionEvent) => void;

interface MinimalWindowGlobal {
  addEventListener?: (type: string, listener: ErrorListener | RejectionListener) => void;
  removeEventListener?: (type: string, listener: ErrorListener | RejectionListener) => void;
}

function windowGlobal(): MinimalWindowGlobal {
  return globalThis as unknown as MinimalWindowGlobal;
}

// Best-effort string coercion of an `unhandledrejection` event's `reason` --
// pure, exported for direct unit testing without going through a real/
// stubbed `unhandledrejection` event. An `Error` reason yields its
// `.message`; anything else is coerced via `String()` inside a try/catch,
// falling back to a fixed placeholder string on failure (e.g. a value whose
// own `toString`/`Symbol.toPrimitive` itself throws) -- a malformed
// rejection reason must never crash this handler.
export function computeRejectionReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  try {
    return String(reason);
  } catch {
    return "<unstringifiable rejection reason>";
  }
}

// Browser-only. Listens for `error` and `unhandledrejection` on `window`.
// No-ops (returns `undefined`, no listeners attached) outside a browser
// environment -- never throws. Returns a teardown removing both listeners.
export function autoErrors(): Plugin {
  return function autoErrorsSetup(analytics) {
    if (!isBrowserEnvironment()) return undefined;

    const g = windowGlobal();
    // Defensive: `isBrowserEnvironment()` only checks `window`/`navigator`
    // -- an `addEventListener`-less environment (deliberately, in a test
    // stub, or a genuinely unusual host) still no-ops rather than throwing.
    if (typeof g.addEventListener !== "function") return undefined;

    function handleError(event: MinimalErrorEvent): void {
      const stack = event.error?.stack;
      analytics.track("Error Occurred", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        ...(stack !== undefined && { stack }),
      });
    }

    function handleRejection(event: MinimalPromiseRejectionEvent): void {
      analytics.track("Unhandled Rejection", { reason: computeRejectionReason(event.reason) });
    }

    g.addEventListener("error", handleError as ErrorListener);
    g.addEventListener("unhandledrejection", handleRejection as RejectionListener);

    return function autoErrorsTeardown(): void {
      g.removeEventListener?.("error", handleError as ErrorListener);
      g.removeEventListener?.("unhandledrejection", handleRejection as RejectionListener);
    };
  };
}
