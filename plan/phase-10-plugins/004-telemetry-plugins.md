# 004 — Telemetry plugins: `autoErrors`, `autoWebVitals`, `autoPerformance`

## Context

Depends on issue 001 (`Plugin` type/registration). Independent of issues
002/003/005. Groups the three plugins that observe browser-reported
measurements/failures rather than direct user interaction. Each plugin
gets its own file under `src/plugins/`.

Per `CLAUDE.md`'s "zero vendor deps in core" rule, `autoWebVitals` is a
**hand-rolled** `PerformanceObserver`-based implementation — no `web-vitals`
npm package or any other dependency. Keep it a best-effort subset (FCP,
LCP, CLS below), not a claim of full parity with the real `web-vitals`
library.

All three plugins share the same shape as issue 003's: browser-only
(`isBrowserEnvironment()` guard), named `Plugin` function returned from a
factory, realistic Title-Case event names, teardown removes every
listener/observer attached, never throws.

## `autoErrors()`

`src/plugins/autoErrors.ts`:

```ts
export function autoErrors(): Plugin;
```

- Listens for `window`'s `error` event: fires `analytics.track("Error
  Occurred", { message, filename, lineno, colno, stack })` where `message`/
  `filename`/`lineno`/`colno` come straight off the `ErrorEvent`, and
  `stack` is `event.error?.stack` (omitted if absent).
- Listens for `window`'s `unhandledrejection` event: fires
  `analytics.track("Unhandled Rejection", { reason })` where `reason` is a
  best-effort string derived from `event.reason` — if it's an `Error`,
  use `reason.message`; otherwise, attempt `String(event.reason)` inside a
  try/catch, falling back to `"<unstringifiable rejection reason>"` on
  failure (never let a malformed rejection reason itself crash the
  handler).
- Teardown removes both listeners.

## `autoWebVitals()`

`src/plugins/autoWebVitals.ts`:

```ts
export function autoWebVitals(): Plugin;
```

- Feature-detects `PerformanceObserver` (via `typeof PerformanceObserver
  !== "undefined"` on the browser global) in addition to the standard
  `isBrowserEnvironment()` guard — no-op if unavailable, never throw.
- Observes three entry types, each independently guarded by its own
  try/catch around `observer.observe(...)` (a browser may support
  `PerformanceObserver` but not every `entryTypes` value — an unsupported
  `entryTypes` value throws synchronously per spec, and one unsupported
  type must not prevent the other two from being observed):
  - `"paint"`: on an entry named `"first-contentful-paint"`, fires
    `analytics.track("Web Vital Measured", { name: "FCP", value:
    entry.startTime, rating })` once (disconnects this specific
    observation after first fire — FCP only happens once per page).
  - `"largest-contentful-paint"`: LCP entries fire repeatedly as the
    browser revises its "largest" candidate; track the latest value seen,
    and report the final one via `analytics.track("Web Vital Measured", {
    name: "LCP", value, rating })` on the first `visibilitychange` to
    `"hidden"` or on `pagehide` (whichever fires first) — matches the
    standard recommended LCP-finalization pattern, still hand-rolled (no
    library).
  - `"layout-shift"`: accumulate `entry.value` for entries where
    `!entry.hadRecentInput` into a running CLS total; report the final
    total the same way as LCP (`visibilitychange`→`"hidden"` or
    `pagehide`), via `analytics.track("Web Vital Measured", { name:
    "CLS", value, rating })`.
- `rating` is computed via fixed published thresholds (good /
  needs-improvement / poor):
  - LCP: `<= 2500` good, `<= 4000` needs-improvement, else poor (ms).
  - CLS: `<= 0.1` good, `<= 0.25` needs-improvement, else poor (unitless).
  - FCP: `<= 1800` good, `<= 3000` needs-improvement, else poor (ms).
- Teardown disconnects every `PerformanceObserver` created, and removes
  the `visibilitychange`/`pagehide` listeners used for LCP/CLS
  finalization. If teardown runs before LCP/CLS have naturally finalized,
  their in-progress values are simply never reported (no forced flush on
  teardown — document as a known limitation).

## `autoPerformance()`

`src/plugins/autoPerformance.ts`:

```ts
export function autoPerformance(): Plugin;
```

- Feature-detects `performance?.getEntriesByType` — no-op if unavailable.
- If `document.readyState === "complete"` already, reads the navigation
  timing entry immediately; otherwise adds a one-time `window`
  `"load"` listener that reads it once the load event fires.
- Reads `performance.getEntriesByType("navigation")[0]` (a
  `PerformanceNavigationTiming`); if absent/empty, does nothing (no
  `track()` call, no throw).
- Fires exactly one `analytics.track("Page Performance Measured", {
  ttfb: entry.responseStart - entry.requestStart,
  domContentLoaded: entry.domContentLoadedEventEnd - entry.startTime,
  loadComplete: entry.loadEventEnd - entry.startTime,
  dnsMs: entry.domainLookupEnd - entry.domainLookupStart,
  tcpMs: entry.connectEnd - entry.connectStart,
  requestMs: entry.responseStart - entry.requestStart,
  responseMs: entry.responseEnd - entry.responseStart,
  })` per page load.
- Teardown removes the `"load"` listener if it hasn't fired yet; a no-op
  if the measurement already happened (nothing left registered to
  remove).

## Design decisions made in this issue (narrow implementation gaps, not open architecture questions)

- **`autoWebVitals` scope is FCP/LCP/CLS only** (not the full modern
  vitals set, e.g. INP) — a deliberately bounded, hand-rolled subset
  achievable without a vendor dependency in one issue; document this scope
  limit explicitly in the plugin's example (issue 007) rather than
  silently under-delivering against the "web vitals" name.
- **Every `PerformanceObserver` type is wrapped in its own try/catch**:
  browser support for `entryTypes` values is inconsistent enough
  (especially `"layout-shift"`) that a single shared try/catch around all
  three `observe()` calls would risk one unsupported type silently
  killing observation of the other two.
- **`autoPerformance`'s one-shot nature**: Navigation Timing describes a
  single document load; this plugin intentionally does not attempt to
  re-measure on SPA route changes (that's a distinct concern from
  `autoPage`, out of scope here).

## Acceptance criteria

- `src/plugins/autoErrors.ts`, `src/plugins/autoWebVitals.ts`,
  `src/plugins/autoPerformance.ts` exist, exporting the surfaces above.
- `src/index.ts` re-exports all three factory functions.
- `autoErrors()` registered against a stubbed browser environment, with a
  simulated `error`/`unhandledrejection` event dispatched, produces the
  documented `track()` call with the expected properties (including the
  `reason` string-coercion fallback for a non-Error rejection reason).
- `autoWebVitals()` registered against a stubbed environment with a stub
  `PerformanceObserver` (constructor capturing its callback + `entryTypes`,
  a manual way to feed it fake `PerformanceEntry`-like objects) produces
  one `"Web Vital Measured"` track call per vital, with `rating` computed
  correctly at each threshold boundary (test at least one `good`, one
  `needs-improvement`, one `poor` value per vital).
- `autoWebVitals()` no-ops (no throw, zero track calls) when
  `PerformanceObserver` is undefined, and independently when one
  `entryTypes` value throws on `observe()` while the others still get
  observed.
- `autoPerformance()` registered against a stubbed environment with a
  stub `performance.getEntriesByType("navigation")` returning one fake
  `PerformanceNavigationTiming`-shaped object produces exactly one
  `"Page Performance Measured"` track call with correctly-computed
  duration fields.
- `autoPerformance()` no-ops (no throw, zero track calls) when
  `performance`/`getEntriesByType` is unavailable, or when the navigation
  entries list is empty.
- All three plugins no-op safely with no `window`/`document`/`performance`
  present at all.
- Every plugin's teardown removes its listeners/observers — verified by
  simulating the relevant event again after `destroy()` and asserting no
  further `track()` calls (where applicable; `autoErrors`/`autoWebVitals`
  can be re-triggered post-teardown, `autoPerformance` is inherently
  one-shot and only needs its pre-fire listener-removal path tested).

## Test requirements

Both unit and integration tests are required per plugin.

**Unit tests**: pure computation logic — `autoErrors`'s rejection-reason
string coercion, `autoWebVitals`'s rating-threshold function, and
`autoPerformance`'s duration-field computation from a fake navigation
timing entry — each testable directly without a full `createAnalytics()`
round-trip.

**Integration tests**: construct `createAnalytics({ plugins: [...] })`
against a stubbed browser global extended with the minimal stub
`PerformanceObserver`/`performance.getEntriesByType` surfaces described
above, dispatch/feed simulated entries, assert delivered events via a
recording stub provider, and assert teardown behavior. One shared test
file per plugin, or a shared `src/plugins/telemetry.integration.test.ts` —
implementor's call.

## Out of scope

- `autoPage`, `autoUTM` — issues 002, 005.
- `autoClicks`, `autoScroll`, `autoVisibility` — issue 003.
- `examples/plugins/` — issue 007.
