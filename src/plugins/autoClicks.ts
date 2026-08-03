// Built-in `autoClicks` plugin (Phase 10 issue 003): a generic,
// framework-agnostic browser plugin that listens for `click` events on
// `document` (bubble phase) and reports each one as an "Element Clicked"
// `.track()` call, with a small set of auto-computed properties describing
// the clicked element. Mirrors `autoScroll.ts`/`autoVisibility.ts`'s shape
// exactly (browser-only guard, named setup function, teardown removing
// listeners) -- see this issue's file header for the shared conventions all
// three DOM-interaction plugins in this issue follow.
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (see `src/context.ts`'s header comment) -- `document`/`Element`/
// `HTMLAnchorElement` aren't ambient types here either. The minimal ad-hoc
// shapes below are read directly off `globalThis` (top-level, not nested
// under a `window` object), matching `autoPage.ts`'s precedent -- and are
// exactly the shape a test needs to stub via
// `Object.defineProperty(globalThis, ...)`, per `src/context.test.ts`'s
// established technique.
import type { Plugin } from "../plugins";
import { isBrowserEnvironment } from "../context";

export interface AutoClicksOptions {
  // Only elements matching this CSS selector are tracked (via
  // Element.closest(selector) against the click's target). Omitted: every
  // click on an Element is tracked.
  selector?: string;
  // Additional properties merged onto the auto-computed ones for a given
  // clicked element; caller-returned keys win on collision with the
  // auto-computed ones below.
  getProperties?: (element: MinimalElement) => Record<string, unknown>;
}

// Minimal ad-hoc shape covering exactly what this plugin reads off a clicked
// element -- deliberately not the real DOM `Element`/`HTMLAnchorElement`
// types (unavailable without `"dom"` in `tsconfig.json`'s `lib`, see this
// file's header comment). `href` is read unconditionally (present on
// `HTMLAnchorElement`, `undefined` on every other element type, exactly
// mirroring `(element as HTMLAnchorElement).href` in a real DOM).
export interface MinimalElement {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string | null;
  href?: string;
  closest?: (selector: string) => MinimalElement | null;
}

interface MinimalClickEvent {
  target: unknown;
}

type ClickListener = (event: MinimalClickEvent) => void;

interface MinimalDocumentGlobal {
  document?: {
    addEventListener?: (type: string, listener: ClickListener) => void;
    removeEventListener?: (type: string, listener: ClickListener) => void;
  };
}

function documentGlobal(): MinimalDocumentGlobal {
  return globalThis as unknown as MinimalDocumentGlobal;
}

// Defensive, best-effort "is this a DOM-Element-shaped value" check --
// `target` on a real click event is always an `Element` (or `null`/some
// other `EventTarget` in edge cases), but nothing here can rely on
// `instanceof Element` without `"dom"` in `lib`. A `tagName` string is the
// cheapest reliable signal that `target` is Element-shaped rather than
// (for example) a plain `Window`/`Document`/synthetic non-Element target.
function isElementLike(value: unknown): value is MinimalElement {
  return typeof value === "object" && value !== null && typeof (value as MinimalElement).tagName === "string";
}

// Computes the auto-computed base properties for a clicked element -- pure,
// exported for direct unit testing without going through a real/stubbed
// `click` event.
export function computeClickProperties(element: MinimalElement): Record<string, unknown> {
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classes: element.className || undefined,
    text: (element.textContent ?? "").trim().slice(0, 200) || undefined,
    href: element.href || undefined,
  };
}

// Browser-only. Listens for `click` on `document` (bubble phase). No-ops
// (returns `undefined`, no listener attached) outside a browser
// environment -- never throws. Returns a teardown removing the listener.
export function autoClicks(options?: AutoClicksOptions): Plugin {
  return function autoClicksSetup(analytics) {
    if (!isBrowserEnvironment()) return undefined;

    const doc = documentGlobal().document;
    // Defensive: `isBrowserEnvironment()` only checks `window`/`navigator`
    // -- a `document`-less environment (deliberately, in a test stub, or a
    // genuinely unusual host) still no-ops rather than throwing.
    if (!doc || typeof doc.addEventListener !== "function") return undefined;

    function handleClick(event: MinimalClickEvent): void {
      const target = event.target;
      if (!isElementLike(target)) return;

      let element: MinimalElement = target;
      if (options?.selector) {
        const matched = target.closest?.(options.selector);
        if (!matched) return;
        element = matched;
      }

      const properties = {
        ...computeClickProperties(element),
        ...options?.getProperties?.(element),
      };

      analytics.track("Element Clicked", properties);
    }

    doc.addEventListener("click", handleClick);

    return function autoClicksTeardown(): void {
      doc.removeEventListener?.("click", handleClick);
    };
  };
}
