# 007 — `examples/plugins/`

## Context

Depends on issues 001-005 (full plugin surface implemented and passing
QA: `autoPage`, `autoClicks`, `autoScroll`, `autoVisibility`, `autoErrors`,
`autoWebVitals`, `autoPerformance`, `autoUTM`). Per `plan/VISION.md`'s
Examples policy — every feature ships its `examples/` entries in the same
phase that built it — this closes out Phase 10.

Read `examples/middleware/README.md` and at least one of its subdirectories
(`pipeline-basics/` or `sampling-vs-routing/`) in full before starting —
that phase faced the same "many small built-ins" shape Phase 10 does, and
resolved it with **two realistic, composed-usage example directories**
rather than eight one-plugin toy directories. Follow that precedent here,
not a literal one-directory-per-plugin split: `plan/VISION.md`'s "every
plugin example: install, config, usage, customization, limitations" is
satisfied by covering each of the 8 plugins' install/config/usage/
customization/limitations *within* one of the two composed READMEs below,
not by manufacturing eight redundant standalone flows.

Since real `window`/`navigator`/`document`/`location`/`history`/
`sessionStorage`/`PerformanceObserver`/`performance` globals don't exist in
a plain Bun script, both examples must simulate a "real page" by stubbing
those globals before calling into `typetrack` — reuse the exact stubbing
technique already established by `src/context.test.ts` (Phase 9) and
extended by issues 002-005's own plugin tests, rather than inventing a
third approach.

## Scope of this issue

Two new subdirectories under `examples/plugins/`, plus an
`examples/plugins/README.md` index (mirroring `examples/middleware/README.md`'s
top-level structure: intro paragraph, examples-policy paragraph, "not part
of any published package" paragraph, per-example bullet list, closing
testing-conventions paragraph).

### `examples/plugins/landing-page-engagement/`

A realistic marketing-landing-page scenario, composing:
`autoPage()`, `autoUTM()`, `autoClicks()`, `autoScroll()`,
`autoVisibility()` — the plugins concerned with page/session/interaction
tracking rather than raw browser telemetry. Flow:

1. Simulate arriving at the landing page via a campaign link
   (`location.search` carrying `utm_source`/`utm_medium`/`utm_campaign`),
   with `createAnalytics({ plugins: [autoPage(), autoUTM(), autoClicks({
   selector: "[data-cta]" }), autoScroll(), autoVisibility()] })`.
2. Show the initial `autoPage()` page view and the `autoUTM()` `"Campaign
   Landing"` event both firing at setup.
3. Simulate a click on a stubbed call-to-action element (`data-cta`
   attribute) — show the `autoClicks()` `"Element Clicked"` event, scoped
   by the `selector` option (and a second, non-matching click that's
   correctly ignored).
4. Simulate scrolling past 25%/50%/100% thresholds — show `autoScroll()`'s
   `"Scroll Depth Reached"` events, each firing once.
5. Simulate a `visibilitychange` to `"hidden"` (e.g. the visitor switches
   tabs) — show `autoVisibility()`'s `"Page Visibility Changed"` event.
6. Simulate a client-side navigation via `history.pushState` to a second
   route with no UTM params — show `autoPage()` firing a second page view,
   and `autoUTM()` correctly *not* re-firing the landing event (persisted
   first-touch value already recorded).
7. Call `.destroy()` — show that a further simulated scroll/click/pushState
   produces no further events (teardown verified end-to-end through the
   public API, not just unit-level).

### `examples/plugins/site-reliability-and-vitals/`

A realistic scenario composing the three telemetry plugins:
`autoErrors()`, `autoWebVitals()`, `autoPerformance()`. Flow:

1. `createAnalytics({ plugins: [autoErrors(), autoWebVitals(),
   autoPerformance()] })` against a stubbed browser environment extended
   with stub `PerformanceObserver` and `performance.getEntriesByType`.
2. Simulate a thrown error inside application code reaching `window`'s
   `error` event — show `autoErrors()`'s `"Error Occurred"` event.
3. Simulate an unhandled promise rejection with a non-Error reason (e.g. a
   plain string) — show the string-coercion fallback in the delivered
   `"Unhandled Rejection"` event.
4. Feed fake `PerformanceObserver` entries for `"paint"`
   (`first-contentful-paint`), `"largest-contentful-paint"`, and
   `"layout-shift"`, then simulate `visibilitychange` to `"hidden"` to
   trigger LCP/CLS finalization — show all three `"Web Vital Measured"`
   events, with at least one deliberately chosen to land in each of
   `good`/`needs-improvement`/`poor` across the three vitals (does not
   need to be one-per-vital exhaustively — cover the rating boundary logic
   clearly without excessive repetition).
5. Feed a fake `performance.getEntriesByType("navigation")` entry and
   simulate the `"load"` event — show `autoPerformance()`'s `"Page
   Performance Measured"` event with its computed duration fields.
6. Call `.destroy()` — show that `autoErrors`'s listeners are removed
   (further simulated errors produce no events); note in the README that
   `autoWebVitals`'s in-progress LCP/CLS and `autoPerformance`'s one-shot
   measurement have already fired by this point in the flow and have
   nothing further to tear down (this is the documented limitation from
   issue 004 — link it explicitly here rather than re-deriving it).

## Acceptance criteria

- `examples/plugins/README.md` exists, follows `examples/middleware/README.md`'s
  structure exactly, links both subdirectories with a one-paragraph
  description each (mirroring the existing `examples/core/README.md`/
  `examples/middleware/README.md` index style).
- Both subdirectories follow the established example shape: `package.json`
  (`file:../../..` dependency, own `package.json` mirroring
  `examples/middleware/*/package.json`'s shape), `index.ts` (exported flow
  function(s)), an integration test running the real flow end-to-end
  against a hand-written recording/stub `AnalyticsProvider` (never a real
  `packages/provider-*` adapter), a unit test for any non-trivial pure
  logic each example itself defines (e.g. constructing the fake
  `PerformanceEntry` fixtures, if that construction has any non-trivial
  logic worth isolating — do not manufacture one otherwise),
  `expected-output.txt` (literal captured output), and a `README.md` with
  Prerequisites/How to run/Source/Expected output/Explanation/Production
  notes sections.
- Every one of the 8 plugins (`autoPage`, `autoClicks`, `autoScroll`,
  `autoVisibility`, `autoUTM`, `autoErrors`, `autoWebVitals`,
  `autoPerformance`) is exercised by at least one of the two examples'
  flows, with its README covering that plugin's install/config/usage/
  customization/limitations per `plan/VISION.md`'s per-plugin requirement
  (a shared "Plugins used" section per README, one subsection per plugin,
  is an acceptable structure — implementor's call on exact heading
  layout).
- Realistic event/property names only, matching each plugin's issue
  (001-005) exactly — no `test`/`foo`/`bar` placeholders anywhere in
  either example.
- Both examples' Production notes sections cover, at minimum: plugins are
  construction-time-only config (`plugins: [...]`, no dynamic
  registration API); `destroy()` tears down every plugin's listeners
  automatically, in registration order, before provider flush/destroy;
  every shipped plugin no-ops safely (never throws) outside a browser
  environment; the `autoUTM`-vs-`context: true` distinction (link to
  issue 005's README section or restate briefly: `autoUTM` is one-shot
  first-touch persistence + a landing event, `context: true`'s
  `context.campaign` is live per-event annotation — using one does not
  require the other); `autoWebVitals`'s FCP/LCP/CLS-only scope (no INP,
  no vendor `web-vitals` dependency); `autoScroll`'s once-per-plugin-lifetime
  (not once-per-route) threshold-firing limitation.

## Test requirements

- Integration test required for both example directories, as described
  above — run the real flow(s), assert the stub provider's recorded
  events (name + properties) match hand-computed expectations at each
  step of the scenario, including the post-`destroy()` no-further-events
  assertions.
- A unit test is required only where non-trivial pure logic exists inside
  the example's own code (fixture construction, scenario-driving helper
  functions) — do not manufacture one if there's nothing non-trivial to
  unit-test; state explicitly in the commit notes if omitted and why.

## Out of scope

- Any change to `src/` or `packages/next` — this issue is examples-only.
- Live vendor infrastructure — providers in both examples are
  hand-written stubs, never a real `packages/provider-*` adapter.
- A ninth example, or splitting either composed example apart into
  one-plugin-per-directory — explicitly rejected in favor of the two
  composed flows above, per this issue's Context section.
