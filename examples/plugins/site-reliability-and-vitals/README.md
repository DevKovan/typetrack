# site-reliability-and-vitals

Demonstrates `typetrack`'s three raw-browser-telemetry plugins --
`autoErrors()`, `autoWebVitals()`, `autoPerformance()` -- composed together
on a single, realistic page load: an uncaught error and an unhandled
promise rejection both surface, Core Web Vitals (FCP/LCP/CLS) are measured
and finalized, Navigation Timing is captured once the page finishes
loading, then `analytics.destroy()` tears `autoErrors()`'s listeners down.
See [`../landing-page-engagement`](../landing-page-engagement) for the
other five Phase 10 plugins (page/session/interaction tracking).

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/plugins/site-reliability-and-vitals
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/plugins/site-reliability-and-vitals/index.ts
```

## Source

`index.ts`'s `runSiteReliabilityAndVitalsFlow()` constructs one
`createAnalytics()` instance with all three plugins:

```ts
const analytics = createAnalytics({
  provider,
  plugins: [autoErrors(), autoWebVitals(), autoPerformance()],
});
```

Since none of `window`/`navigator`/`document`/`PerformanceObserver`/
`performance` exist in a plain Bun script, `installStubBrowser()` stubs all
of them directly on `globalThis` before `createAnalytics()` runs --
including a minimal stub `PerformanceObserver` class (a constructor
capturing its callback and observed `type`, plus a `feed()` method this
example's flow uses to deliver fake `PerformanceEntry`-shaped objects) and
a stub `performance.getEntriesByType`. This reuses the exact
`Object.defineProperty(globalThis, ...)` technique established by
`src/context.test.ts` and extended by
`src/plugins/telemetry.integration.test.ts` (Phase 10 issue 004). A
hand-written `createReliabilityWarehouseProvider()` (never a real
`packages/provider-*` adapter) records every `.track()` call it receives.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal,
exactly-reproducible output of `bun run index.ts` (nothing in this example
depends on any random value -- including the `0.15000000000000002` CLS
total, which is genuine floating-point summation, not a typo), or the
"Explanation" section below for the annotated version.

## Explanation

### Step 1 -- setup

All three plugins are purely listener-registering at `createAnalytics()`
construction time -- unlike `autoPage()`/`autoUTM()` (see
`../landing-page-engagement`), none of `autoErrors()`/`autoWebVitals()`/
`autoPerformance()` fires anything immediately at setup. Zero provider
calls happen before any simulated event/entry is fed in.

### Step 2-3 -- `autoErrors()`

A simulated `window` `"error"` event (as a real uncaught exception deep in
application code would produce) is tracked as `"Error Occurred"` with
`message`/`filename`/`lineno`/`colno`/`stack`. A simulated
`unhandledrejection` whose `reason` is a plain string (not an `Error`
instance) is tracked as `"Unhandled Rejection"` with that exact string --
`autoErrors()` only special-cases real `Error` instances (extracting
`.message`); any other rejection reason is coerced via `String(reason)`.

### Step 4 -- `autoWebVitals()`

Three `"Web Vital Measured"` events, deliberately chosen to land in a
different rating bucket each: FCP at `1200`ms is `"good"`, LCP at the
latest of two fed candidates (`4200`ms) is `"poor"`, and CLS's accumulated
total (`0.07 + 0.08`, ignoring a third entry fed with
`hadRecentInput: true`) is `"needs-improvement"`. LCP and CLS both finalize
on the same single `visibilitychange -> "hidden"` event; FCP had already
fired immediately on its own first entry.

### Step 5 -- `autoPerformance()`

A fake Navigation Timing entry is registered, then the `"load"` event
fires. `autoPerformance()` reads
`performance.getEntriesByType("navigation")[0]` at that point and reports
the computed duration fields as a single `"Page Performance Measured"`
event.

### Step 6 -- `analytics.destroy()`

`autoErrors()`'s two listeners (`error`/`unhandledrejection`) are removed
-- a further simulated error and rejection afterward produce exactly zero
additional provider calls. `autoWebVitals()` and `autoPerformance()` have
nothing further to tear down by this point: both had already fired
everything they were ever going to fire, earlier in the flow -- see the
Production notes below.

## Plugins used

### `autoErrors()`

- **Install/config**: `import { autoErrors } from "typetrack"`. No options.
- **Usage**: register it in `plugins: [...]`. Listens for `error` and
  `unhandledrejection` on `window`, reporting each as `"Error Occurred"`/
  `"Unhandled Rejection"` respectively.
- **Customization**: none -- this plugin has no options. Filter/redact
  sensitive error messages downstream (a middleware, or provider-side) if
  needed; `autoErrors()` reports whatever the browser gives it, verbatim.
- **Limitations**: only errors that actually reach `window`'s `error`/
  `unhandledrejection` events are captured -- errors caught and swallowed
  by application code (e.g. a `try`/`catch` that doesn't rethrow) are
  invisible to this plugin by design, since the browser itself never sees
  them either.

### `autoWebVitals()`

- **Install/config**: `import { autoWebVitals } from "typetrack"`. No
  options.
- **Usage**: register it in `plugins: [...]`. Additionally
  feature-detects `PerformanceObserver`; no-ops if unavailable. Observes
  `"paint"` (FCP), `"largest-contentful-paint"` (LCP), and `"layout-shift"`
  (CLS) independently -- one unsupported `entryTypes` value never prevents
  the other two from being observed. Reports each as `"Web Vital Measured"`
  with `name`/`value`/`rating`.
- **Customization**: none -- this plugin has no options (no custom
  thresholds, no ability to add INP or any other vital).
- **Limitations**: **FCP/LCP/CLS-only scope -- no INP, no vendor
  `web-vitals` npm dependency.** Per `CLAUDE.md`'s "zero vendor deps in
  core" rule, this is a hand-rolled implementation of a best-effort subset
  of the modern Core Web Vitals set; apps that need INP (or want the
  vendor `web-vitals` package's more battle-tested edge-case handling)
  should instrument that separately and forward it through `.track()`
  themselves. Also: **if `destroy()` runs before LCP/CLS have naturally
  finalized (i.e. before the first `visibilitychange -> "hidden"` or
  `pagehide`), their in-progress values are simply never reported** -- this
  is a documented, intentional limitation (no forced flush on teardown),
  not a bug; see `src/plugins/autoWebVitals.ts`'s header comment and Phase
  10 issue 004 (`plan/phase-10-plugins/004-telemetry-plugins.md`) for the
  full rationale. This example's own Step 4 deliberately finalizes LCP/CLS
  *before* Step 6's `destroy()` specifically to avoid hitting that
  limitation -- a real app that calls `destroy()` earlier (e.g. on
  unmount, before the visitor ever backgrounds the tab) would simply never
  see an LCP/CLS event for that page view at all.

### `autoPerformance()`

- **Install/config**: `import { autoPerformance } from "typetrack"`. No
  options.
- **Usage**: register it in `plugins: [...]`. Additionally
  feature-detects `performance.getEntriesByType`; no-ops if unavailable.
  If `document.readyState` is already `"complete"`, reads the navigation
  timing entry immediately; otherwise waits for the `"load"` event (this
  example's scenario). Reports exactly one `"Page Performance Measured"`
  event with `ttfb`/`domContentLoaded`/`loadComplete`/`dnsMs`/`tcpMs`/
  `requestMs`/`responseMs`.
- **Customization**: none -- this plugin has no options.
- **Limitations**: **intentionally one-shot.** Navigation Timing describes
  a single document load, so this plugin never re-measures on SPA route
  changes (`autoPage()`'s client-side-navigation detection is a distinct,
  unrelated concern) -- exactly one `"Page Performance Measured"` event
  fires per real page load, ever, for a given plugin instance.

## Production notes

- **Plugins are construction-time-only config.** `plugins: [...]` is read
  once, at `createAnalytics()` construction time -- there is no dynamic
  plugin-registration API. Changing which plugins are active requires
  constructing a new `Analytics` instance.
- **`destroy()` tears down every plugin's listeners automatically, in
  registration order, before provider flush/destroy.** Verified end-to-end
  in Step 6 above for `autoErrors()`: after `destroy()`, a further
  simulated error and rejection together produce zero additional provider
  calls. `autoWebVitals()`'s and `autoPerformance()`'s teardowns run too
  (disconnecting observers / removing the pre-fire `"load"` listener), but
  by Step 6 both plugins have already fired everything they were ever
  going to fire in this flow, so there's nothing observable left for their
  teardowns to prevent -- see both plugins' own "Limitations" subsections
  above.
- **Every shipped plugin no-ops safely outside a browser environment --
  never throws.** Each one checks for `window`/`navigator` (plus, for
  `autoWebVitals()`/`autoPerformance()`, `PerformanceObserver`/
  `performance.getEntriesByType` specifically) before doing anything;
  absent any of those, `createAnalytics({ plugins: [...] })` still
  constructs successfully with zero listeners/observers attached and zero
  events ever fired.
- **`autoUTM()` vs. `context: true`.** Not one of this example's three
  plugins, but worth restating here too: `autoUTM()` (see
  [`../landing-page-engagement`](../landing-page-engagement)) is one-shot
  first-touch campaign persistence plus a single dedicated landing event;
  `createAnalytics({ context: true })`'s `context.campaign` is live,
  per-event annotation read fresh from the current URL on every call. Using
  one does not require the other.
- **`autoWebVitals()`'s FCP/LCP/CLS-only scope.** See `autoWebVitals()`'s
  own "Limitations" subsection above -- no INP, no vendor `web-vitals`
  dependency, by design.
- **`autoScroll()`'s once-per-plugin-lifetime threshold-firing
  limitation.** Not one of this example's three plugins, but worth
  restating here too: `autoScroll()` (see
  [`../landing-page-engagement`](../landing-page-engagement)) fires each
  configured percent-of-page-scrolled threshold at most once per plugin
  instance lifetime, not once per route -- a threshold already reached
  earlier never re-fires on a later client-side navigation within the same
  plugin instance.
