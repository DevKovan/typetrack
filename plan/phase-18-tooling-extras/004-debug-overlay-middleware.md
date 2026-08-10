# 004 -- `debugOverlayMiddleware()`: in-page visual event panel

## Context

Read `plan/phase-18-tooling-extras/BRIEF.md`'s Design decisions 3 and 4
first, and `src/middleware/logging.ts` in full (the closest existing
precedent: an opt-in, never-auto-registered, side-effect-only built-in
middleware). Also read `src/plugins/autoErrors.ts`'s header comment (the
"minimal ad-hoc DOM types, no `dom` in `tsconfig.json` `lib`" convention --
this issue needs the same treatment for `document`/`HTMLElement`-shaped
values) and `src/plugins/domInteraction.integration.test.ts`'s
`Object.defineProperty(globalThis, "document", ...)` stubbing technique
(the test pattern to copy for this issue's mount/render tests). Independent
of issues 001-003 -- may be implemented in any order relative to them.

`Analytics.use(middleware)` (`src/index.ts`) registers a `Middleware`
(`src/middleware.ts`) whose `after(event)` hook fires, in registration
order, for every event that completes the middleware `before` chain and
reaches dispatch -- for `track()`/`page()`/`screen()` alike, regardless of
which application code called them. This is the only extension point wide
enough to observe "every event this app just sent," which is what a debug
overlay needs. Note `use()` has no corresponding teardown call from
`destroy()` (confirmed by reading `src/index.ts`'s `destroy()` — it never
touches `middlewares`) -- this middleware's mounted DOM panel is expected
to persist for the page's lifetime, same as `console.log` output from
`loggingMiddleware` is never "un-logged"; this is a documented, accepted
limitation (BRIEF.md Design decision 4), not a bug to design around.

## Scope of this issue

`src/middleware/debugOverlay.ts` (new file):

```ts
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

export function debugOverlayMiddleware(options?: DebugOverlayOptions): Middleware;
```

Behavior:

- Browser-only, same guard as every Phase 10 plugin
  (`isBrowserEnvironment()` from `src/context.ts`). Outside a browser
  environment, returns a `Middleware` whose `after()` is effectively a
  no-op (never touches `document`/mounts anything) -- registering it in a
  Node/SSR context must never throw.
- `name: "debug-overlay"`.
- No `before()` -- this middleware never transforms or drops an event
  (pure observer, per Design decision 3). Only `after(event)` is defined.
- On the *first* `after()` call, lazily creates the panel: a single fixed-
  position container (`position: fixed`, high `z-index`, inline styles
  only -- no injected `<style>`/`<link>` element, no class names that
  could collide with the host app's own CSS) appended to `document.body`,
  plus a small always-visible toggle control that switches between
  collapsed/expanded. Idempotent: if `document.body` doesn't exist yet at
  the first call (extremely early script execution), silently skip
  mounting for that call and retry lazily on the next `after()` call
  rather than throwing or queuing a `DOMContentLoaded` listener (keeps
  this middleware dependency-free and matches the "never throws" bar
  without adding lifecycle complexity a debug-only tool doesn't need).
- Every subsequent `after(event)` call prepends a compact row (event name,
  a short time string, e.g. `HH:MM:SS`) to the top of the panel's event
  list, evicting the oldest row once `maxEvents` is exceeded. Clicking a
  row expands/collapses that row's pretty-printed `event.properties` JSON
  inline (no external tooltip/popover library).
- Extract the pure, DOM-independent pieces into separately-exported,
  directly-unit-testable functions -- at minimum:
  ```ts
  export function formatOverlayTimestamp(timestampMs: number): string;
  ```
  (mirrors `autoClicks.ts`'s `computeClickProperties` precedent of
  exporting the pure logic separately from the DOM-mounting closure) plus
  whatever ring-buffer eviction helper naturally falls out of the
  `maxEvents` logic -- exact decomposition is the implementor's call
  beyond this minimum.
- Never throws from `after()` regardless of `document`'s state (mirrors
  `autoErrors.ts`'s defensive `typeof g.addEventListener !== "function"`
  guard pattern) -- a debug-only tool must never be the thing that breaks
  an app's real event dispatch.

`src/index.ts`: add
`export { debugOverlayMiddleware } from "./middleware/debugOverlay";` /
`export type { DebugOverlayOptions } from "./middleware/debugOverlay";`
alongside the six existing middleware exports (same pattern each of
`redactMiddleware`/`piiFilterMiddleware`/etc. already follows).

## Testing

- `src/middleware/debugOverlay.test.ts`: unit tests for
  `formatOverlayTimestamp` and any other exported pure helper (no DOM
  involved) -- deterministic formatting for a handful of fixed
  `timestampMs` inputs.
- `src/middleware/debugOverlay.integration.test.ts`: using this repo's
  hand-stubbed-`document`/`window` technique
  (`src/plugins/domInteraction.integration.test.ts`'s
  `Object.defineProperty(globalThis, "document"/"window", ...)` pattern,
  extended with a minimal `createElement`/`appendChild`/`body` stub
  sufficient for this middleware's actual DOM calls) -- cases: outside a
  browser environment (`isBrowserEnvironment()` false), `after()` never
  touches `document` and never throws; inside a stubbed browser
  environment, the panel mounts on first `after()` call (assert exactly
  one `appendChild` onto the stubbed `document.body`, not one per event);
  `maxEvents` eviction actually caps the retained/rendered row count after
  exceeding it; a `Middleware` built by `debugOverlayMiddleware()` has no
  `before` property (or a `before` that returns its input unchanged if the
  implementor chooses to define a passthrough one) and its `after()`
  resolves without throwing even when `document.body` is `undefined` at
  call time.

## Out of scope

A dedicated `examples/middleware/*` package for this middleware -- see
BRIEF.md Design decision 4 (documented instead in issue 005's
`docs/tooling.md`). Any teardown/unmount mechanism triggered by
`destroy()` -- `use()` has no such hook today (see "Context" above); adding
one would be a `src/middleware.ts`/`src/index.ts` contract change outside
this issue's scope.
