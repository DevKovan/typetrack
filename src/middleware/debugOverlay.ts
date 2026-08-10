// Built-in `debugOverlayMiddleware` (Phase 18 issue 004): an opt-in,
// browser-only middleware that renders a small fixed-position visual panel
// of the most recently dispatched events directly in the page -- a
// PostHog-Toolbar-style in-page debug view (per `plan/phase-18-tooling-
// extras/BRIEF.md`'s research grounding), not a second console logger
// (`loggingMiddleware`, Phase 8, already covers that). Mirrors
// `logging.ts`'s shape: opt-in, never auto-registered by `createAnalytics()`
// -- an app must explicitly `.use(debugOverlayMiddleware())`.
//
// Pure observer, per BRIEF.md Design decision 3: only `after(event)` is
// defined below, no `before` -- this middleware can never transform or drop
// an event just by being registered.
//
// `use()` has no corresponding teardown call from `destroy()` (confirmed by
// reading `src/index.ts`'s `destroy()`) -- the mounted panel is expected to
// persist for the page's lifetime, same as `loggingMiddleware`'s console
// output is never "un-logged". This is a documented, accepted limitation
// (BRIEF.md Design decision 4), not a bug to design around.
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (see `src/context.ts`'s header comment) -- `document`/`HTMLElement` aren't
// ambient types here either. The minimal ad-hoc shapes below cover exactly
// what this middleware reads/writes on `document`/its created elements,
// matching `autoErrors.ts`/`autoClicks.ts`'s established convention -- and
// are exactly the shape `debugOverlay.integration.test.ts` needs to stub via
// `Object.defineProperty(globalThis, "document", ...)`.
import type { Middleware } from "../middleware";
import type { CanonicalEvent } from "../schema";
import { isBrowserEnvironment } from "../context";

export interface DebugOverlayOptions {
  // Maximum number of most-recent events retained/rendered. Older entries
  // are evicted once exceeded (oldest-first), mirroring the dev server's
  // own ring-buffer eviction (`src/devServer/server.ts`'s `bufferSize`).
  // Default: 20.
  maxEvents?: number;
  // Where the panel is anchored. Default: "bottom-right".
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  // Starts collapsed (a small toggle only, no event list) vs. expanded.
  // Default: true (collapsed) -- an always-open panel would be an
  // intrusive default for a middleware an app might reasonably leave
  // registered through a whole dev session.
  startCollapsed?: boolean;
}

// Minimal ad-hoc DOM element shape -- deliberately not the real
// `HTMLElement` type (unavailable without `"dom"` in `tsconfig.json`'s
// `lib`, see this file's header comment). Covers exactly what this
// middleware needs: inline-style assignment via `style.cssText` (a single
// string write -- no injected `<style>`/`<link>` element, no class names
// that could collide with the host app's own CSS, and simpler to stub than
// the full `CSSStyleDeclaration` property-by-property API while still valid
// on a real `HTMLElement`), `textContent` for row/label text, `onclick` for
// the toggle/row-expand interactions (simpler to stub than
// `addEventListener` and equally valid on a real `HTMLElement`), and
// `appendChild`/`removeChild` for panel/list mutation.
export interface MinimalElement {
  style?: { cssText?: string };
  textContent?: string;
  onclick?: (() => void) | null;
  appendChild?: (child: MinimalElement) => void;
  removeChild?: (child: MinimalElement) => void;
}

interface MinimalDocument {
  createElement?: (tag: string) => MinimalElement;
  body?: MinimalElement;
}

interface MinimalDocumentGlobal {
  document?: MinimalDocument;
}

function documentGlobal(): MinimalDocumentGlobal {
  return globalThis as unknown as MinimalDocumentGlobal;
}

// `HH:MM:SS`, zero-padded, local time -- pure, exported for direct unit
// testing without going through a real/stubbed DOM. Mirrors `autoClicks.ts`'s
// `computeClickProperties` precedent of exporting the pure logic separately
// from the DOM-mounting closure.
export function formatOverlayTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Pure ring-buffer append: pushes `item` onto the end of `buffer`
// (oldest-first), then trims from the front once `maxEvents` is exceeded --
// mirrors the dev server's own ring-buffer eviction (`src/devServer/
// server.ts`'s `bufferSize`/`buffer.shift()`). Returns the new buffer plus
// the entry evicted as a result of this push (`undefined` if nothing was
// evicted), so a caller holding a parallel structure (e.g. this
// middleware's DOM row elements) knows exactly which entry to also tear
// down. A non-positive `maxEvents` evicts the just-pushed item immediately
// (empty buffer, that item reported as evicted) rather than silently
// accepting an unbounded buffer.
export function appendWithEviction<T>(
  buffer: readonly T[],
  item: T,
  maxEvents: number,
): { buffer: T[]; evicted: T | undefined } {
  if (maxEvents <= 0) {
    return { buffer: [], evicted: item };
  }
  const next = [...buffer, item];
  if (next.length > maxEvents) {
    const evicted = next.shift();
    return { buffer: next, evicted };
  }
  return { buffer: next, evicted: undefined };
}

// Best-effort pretty-printer for a row's expanded `event.properties` JSON --
// never throws (e.g. a circular-reference payload falls back to `String()`).
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const POSITION_STYLES: Record<NonNullable<DebugOverlayOptions["position"]>, string> = {
  "bottom-right": "bottom: 12px; right: 12px;",
  "bottom-left": "bottom: 12px; left: 12px;",
  "top-right": "top: 12px; right: 12px;",
  "top-left": "top: 12px; left: 12px;",
};

interface ResolvedOptions {
  maxEvents: number;
  position: NonNullable<DebugOverlayOptions["position"]>;
  startCollapsed: boolean;
}

interface Panel {
  list: MinimalElement;
  rows: MinimalElement[];
}

function setStyle(element: MinimalElement, cssText: string): void {
  element.style = { cssText };
}

// Builds and mounts the panel container onto `body` -- called at most once
// per middleware instance (the caller, `ensurePanel()` below, only invokes
// this once `document`/`document.body`/`createElement` are all confirmed
// present). A single `container` div is appended to `body` -- the one
// `appendChild` call `debugOverlay.integration.test.ts` asserts happens
// exactly once, regardless of how many events follow.
function buildPanel(
  createElement: (tag: string) => MinimalElement,
  body: MinimalElement,
  options: ResolvedOptions,
): Panel | undefined {
  if (typeof body.appendChild !== "function") return undefined;

  const container = createElement("div");
  setStyle(
    container,
    `position: fixed; ${POSITION_STYLES[options.position]} z-index: 2147483647; ` +
      "font: 11px/1.4 monospace; background: #111318; color: #f5f5f5; " +
      "border-radius: 6px; max-width: 320px; max-height: 60vh; overflow: auto; " +
      "padding: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.4);",
  );

  const toggle = createElement("div");
  setStyle(toggle, "cursor: pointer; padding: 4px 6px; user-select: none;");
  toggle.textContent = "typetrack debug";

  const list = createElement("div");
  let collapsed = options.startCollapsed;
  const applyListStyle = (): void => {
    setStyle(list, `display: ${collapsed ? "none" : "flex"}; flex-direction: column-reverse;`);
  };
  applyListStyle();

  toggle.onclick = () => {
    collapsed = !collapsed;
    applyListStyle();
  };

  container.appendChild?.(toggle);
  container.appendChild?.(list);
  body.appendChild(container);

  return { list, rows: [] };
}

// Builds a single event row: an always-visible one-line label plus a
// nested, initially-hidden `details` element holding the pretty-printed
// `event.properties` JSON, wired with an `onclick` on the row that toggles
// `details`' visibility (no external tooltip/popover library). Two separate
// elements -- rather than swapping `row.textContent` between a compact and
// an embedded-newline string -- deliberately avoids ever putting a literal
// `"\n"` string constant in this module's source: `tsup`/esbuild's minifier
// compacts a short escaped-newline string constant into a template literal
// containing a *raw* newline character (one byte shorter), which would
// otherwise inject an actual line break into the built
// `dist/index.global.js` bundle and break `index.global.integration.test
// .ts`'s "single minified line" assertion on the real build artifact.
function createRow(createElement: (tag: string) => MinimalElement, event: CanonicalEvent): MinimalElement {
  const row = createElement("div");
  setStyle(row, "cursor: pointer; padding: 3px 4px; border-bottom: 1px solid rgba(255,255,255,0.08);");

  const label = createElement("div");
  label.textContent = `${formatOverlayTimestamp(event.timestamp)}  ${event.name}`;

  const details = createElement("div");
  details.textContent = safeStringify(event.properties);

  let expanded = false;
  const applyDetailsStyle = (): void => {
    setStyle(details, `display: ${expanded ? "block" : "none"}; white-space: pre-wrap; opacity: 0.85; margin-top: 2px;`);
  };
  applyDetailsStyle();

  row.onclick = () => {
    expanded = !expanded;
    applyDetailsStyle();
  };

  row.appendChild?.(label);
  row.appendChild?.(details);

  return row;
}

const DEFAULT_OPTIONS: ResolvedOptions = {
  maxEvents: 20,
  position: "bottom-right",
  startCollapsed: true,
};

function resolveOptions(options: DebugOverlayOptions | undefined): ResolvedOptions {
  return {
    maxEvents: options?.maxEvents ?? DEFAULT_OPTIONS.maxEvents,
    position: options?.position ?? DEFAULT_OPTIONS.position,
    startCollapsed: options?.startCollapsed ?? DEFAULT_OPTIONS.startCollapsed,
  };
}

// Browser-only, same guard as every Phase 10 plugin. Outside a browser
// environment, returns a `Middleware` whose `after()` never touches
// `document`/mounts anything -- registering it in a Node/SSR context never
// throws.
//
// Registers only `after(event)` -- no `before` (pure observer, BRIEF.md
// Design decision 3). Lazily mounts the panel on the first `after()` call;
// if `document.body` isn't available yet at that point, silently skips
// mounting for that call and retries on the next one (no
// `DOMContentLoaded` listener, no queuing -- keeps this middleware
// dependency-free). Never throws, regardless of `document`'s state -- a
// debug-only tool must never be the thing that breaks an app's real event
// dispatch.
export function debugOverlayMiddleware(options?: DebugOverlayOptions): Middleware {
  if (!isBrowserEnvironment()) {
    return {
      name: "debug-overlay",
      after(): void {
        // No-op outside a browser environment -- never touches `document`.
      },
    };
  }

  const resolved = resolveOptions(options);
  let panel: Panel | undefined;

  function ensurePanel(): Panel | undefined {
    if (panel) return panel;
    const doc = documentGlobal().document;
    if (!doc || typeof doc.createElement !== "function" || !doc.body) return undefined;
    panel = buildPanel(doc.createElement.bind(doc), doc.body, resolved);
    return panel;
  }

  return {
    name: "debug-overlay",
    after(event: CanonicalEvent): void {
      try {
        const p = ensurePanel();
        if (!p) return;

        const doc = documentGlobal().document;
        if (!doc || typeof doc.createElement !== "function") return;

        const row = createRow(doc.createElement.bind(doc), event);
        const { buffer, evicted } = appendWithEviction(p.rows, row, resolved.maxEvents);
        p.rows = buffer;

        p.list.appendChild?.(row);
        if (evicted) {
          p.list.removeChild?.(evicted);
        }
      } catch {
        // Never throw -- a debug-only tool must never break real event
        // dispatch.
      }
    },
  };
}
