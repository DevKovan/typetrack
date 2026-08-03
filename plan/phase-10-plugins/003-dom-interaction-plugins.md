# 003 — DOM interaction plugins: `autoClicks`, `autoScroll`, `autoVisibility`

## Context

Depends on issue 001 (`Plugin` type/registration). Independent of issue
002's `autoPage`. Groups the three plugins that observe direct user
interaction with the page (click, scroll, tab visibility) — as distinct
from issue 004's telemetry/measurement plugins — following
`src/middleware/`'s precedent of grouping related built-ins into a single
issue where they share no interesting interaction with each other. Each
plugin gets its own file under `src/plugins/`.

All three plugins in this issue share the same shape:

- Browser-only (`isBrowserEnvironment()` guard from `src/context.ts`) —
  no-op (return `undefined`, attach no listeners) outside a browser, never
  throw.
- A factory function returning a **named** `Plugin` function (per issue
  001's requirement, so `plugin.name` is legible in setup-failure
  warnings), e.g. `return function autoClicksSetup(analytics) { ... };`.
- Realistic Title-Case event names, matching `plan/VISION.md`'s Examples
  policy convention already used elsewhere in the codebase (`"Checkout
  Started"`-style) — never lower/snake_case internal-sounding names.
- A returned teardown that removes every listener the plugin attached.

## `autoClicks()`

`src/plugins/autoClicks.ts`:

```ts
export interface AutoClicksOptions {
  // Only elements matching this CSS selector are tracked (via
  // Element.closest(selector) against the click's target). Omitted:
  // every click on an Element is tracked.
  selector?: string;
  // Additional properties merged onto the auto-computed ones for a given
  // clicked element; caller-returned keys win on collision with the
  // auto-computed ones below.
  getProperties?: (element: Element) => Record<string, unknown>;
}

export function autoClicks(options?: AutoClicksOptions): Plugin;
```

- Listens for `click` on `document` (bubble phase).
- Ignores events whose `target` is not an `Element` (defensive — some
  synthetic/edge-case events can have a non-Element target).
- If `options.selector` is set, resolves the closest matching ancestor via
  `target.closest(selector)`; if none found, the click is ignored
  entirely (not tracked).
- Fires `analytics.track("Element Clicked", properties)` where the
  auto-computed base properties are:
  ```ts
  {
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classes: element.className || undefined,
    text: (element.textContent ?? "").trim().slice(0, 200) || undefined,
    href: (element as HTMLAnchorElement).href || undefined,
  }
  ```
  merged with `options.getProperties?.(element)` spread last (caller wins
  on key collision) — same merge convention as Phase 9's
  `resolveEventContext`.
- Teardown removes the `click` listener.

## `autoScroll()`

`src/plugins/autoScroll.ts`:

```ts
export interface AutoScrollOptions {
  // Percent-of-page-scrolled thresholds to report. Defaults to
  // [25, 50, 75, 100]. Each threshold fires at most once per plugin
  // instance lifetime (not once per page/navigation -- see Limitations
  // in this issue's example, issue 007).
  thresholds?: number[];
}

export function autoScroll(options?: AutoScrollOptions): Plugin;
```

- Listens for `scroll` on `window` with `{ passive: true }`.
- On each scroll event, computes `percent = ((scrollY + innerHeight) /
  document.documentElement.scrollHeight) * 100`, clamped to `[0, 100]`.
- For each configured threshold not yet fired (tracked in a `Set<number>`
  closure variable, sorted ascending), if `percent >= threshold`, fires
  `analytics.track("Scroll Depth Reached", { percent: threshold })` and
  marks it fired — never fires the same threshold twice for the life of
  this plugin instance.
- Teardown removes the `scroll` listener and clears the fired-thresholds
  set (immaterial after teardown, included for hygiene/GC only).

## `autoVisibility()`

`src/plugins/autoVisibility.ts`:

```ts
export function autoVisibility(): Plugin;
```

- Listens for `visibilitychange` on `document`.
- Fires `analytics.track("Page Visibility Changed", { state:
  document.visibilityState })` on every change (`"visible"` /`"hidden"`,
  whatever the browser reports — no allowlist/validation of the value).
- Teardown removes the listener.

## Design decisions made in this issue (narrow implementation gaps, not open architecture questions)

- **`autoClicks` tracks all clicks by default (no selector)**: matches the
  default behavior of comparable published autocapture plugins (e.g.
  PostHog's) — scoping down via `selector` is opt-in, not opt-out, so the
  plugin is useful out of the box. Document the noise trade-off in
  issue 007's example "Limitations" section.
- **`autoScroll` thresholds fire once per plugin lifetime, not once per
  SPA route**: this plugin has no notion of "page" (that's `autoPage`'s
  concern) — resetting on route change would require cross-plugin
  coordination that's explicitly out of scope for this phase. Document as
  a known limitation.
- **No plugin in this issue reads/depends on another plugin's state** —
  each is fully self-contained, registered/torn-down independently.

## Acceptance criteria

- `src/plugins/autoClicks.ts`, `src/plugins/autoScroll.ts`,
  `src/plugins/autoVisibility.ts` exist, exporting the surfaces above.
- `src/index.ts` re-exports all three factory functions and their
  `Options` types.
- Each plugin, registered via `plugins: [...]` against a stubbed browser
  environment, fires the documented `track()` call(s) for a simulated
  interaction (click/scroll/visibilitychange dispatched on the stubbed
  globals), verified against a recording stub provider.
- Each plugin's teardown removes its listener(s) — verified by simulating
  the interaction again after `destroy()` and asserting no further
  `track()` calls.
- Each plugin no-ops safely (no listeners attached, no throw) with no
  `window`/`navigator`/`document` present.
- `autoClicks({ selector: "button" })` ignores a click whose target is not
  inside a `<button>`, and tracks one whose target is a `<button>`'s
  descendant (via `closest`).
- `autoClicks({ getProperties })` — caller-supplied keys override the
  auto-computed ones on collision; non-colliding auto-computed keys remain
  present.
- `autoScroll` fires each configured threshold at most once across
  multiple scroll events that repeatedly cross the same threshold.
- `autoVisibility` fires once per simulated `visibilitychange` event with
  the current `document.visibilityState` value.

## Test requirements

Both unit and integration tests are required per plugin.

**Unit tests** (`src/plugins/autoClicks.test.ts`,
`src/plugins/autoScroll.test.ts`, `src/plugins/autoVisibility.test.ts`):
pure property-computation logic (e.g. `autoClicks`'s element-to-properties
mapping, `autoScroll`'s percent/threshold-crossing logic) tested directly
against hand-constructed DOM-like stub objects, without necessarily going
through `createAnalytics()`.

**Integration tests** (folded into each plugin's own test file, or a
shared `src/plugins/domInteraction.integration.test.ts` — implementor's
call): construct `createAnalytics({ plugins: [...] })` against a stubbed
browser global (reuse `src/context.test.ts`'s stubbing technique, extended
with minimal `document.addEventListener`/`removeEventListener`/dispatch
stubs sufficient to simulate click/scroll/visibilitychange), assert
delivered events via a recording stub provider, and assert teardown
behavior.

## Out of scope

- `autoPage`, `autoUTM` — issues 002, 005.
- `autoErrors`, `autoWebVitals`, `autoPerformance` — issue 004.
- `examples/plugins/` — issue 007.
