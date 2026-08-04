# examples/plugins

Runnable, self-contained demonstrations of `typetrack`'s Phase 10 plugin
surface: `createAnalytics({ plugins: [...] })`, the `Plugin` registration/
teardown contract, and all 8 built-ins (`autoPage`, `autoClicks`,
`autoScroll`, `autoVisibility`, `autoUTM`, `autoErrors`, `autoWebVitals`,
`autoPerformance`).

Per `plan/VISION.md`'s Examples policy, every feature ships its `examples/`
entries in the same phase that built it, so these never drift out of sync
with what's actually shipped -- each example's integration test imports and
runs the example's own real entry point/app logic (never a re-implemented
copy of it) against the real `typetrack` API, so a future change to a
plugin that breaks an example's assumptions fails that example's tests, not
just its prose.

None of `examples/` is part of any published npm package: it's excluded from
every package's `files`/`exports` and from `bun run build:all`/`tsup`'s
build steps -- this is documentation/demo code for people reading the repo
or running it locally, not shipped library code.

## Examples

- **[`landing-page-engagement/`](./landing-page-engagement)** -- a realistic
  marketing-landing-page session composing the 5 plugins concerned with
  page/session/interaction tracking (`autoPage`, `autoUTM`, `autoClicks`,
  `autoScroll`, `autoVisibility`): arriving via a campaign link, clicking
  the call-to-action, scrolling through the page, switching tabs, a
  client-side navigation to a second route with no UTM params, and
  `destroy()`-driven teardown verified end-to-end.
- **[`site-reliability-and-vitals/`](./site-reliability-and-vitals)** -- a
  realistic single-page-load scenario composing the 3 raw-browser-telemetry
  plugins (`autoErrors`, `autoWebVitals`, `autoPerformance`): an uncaught
  error and a non-`Error`-reason unhandled rejection, Core Web Vitals
  (FCP/LCP/CLS) measured and finalized with at least one deliberately
  landing in each of `good`/`needs-improvement`/`poor`, Navigation Timing
  captured on `"load"`, and `destroy()`-driven teardown of `autoErrors()`'s
  listeners (with the documented in-flight-vitals/one-shot-performance
  teardown limitation from Phase 10 issue 004 called out explicitly).

Two composed, realistic example directories rather than eight one-plugin
toy directories -- following the same precedent
[`examples/middleware`](../middleware) established for its own "many small
built-ins" shape. `plan/VISION.md`'s "every plugin example: install,
config, usage, customization, limitations" requirement is satisfied by a
"Plugins used" section in each README, with one subsection per plugin that
example composes.

Every example includes a `README.md` with source excerpts, the literal
expected output, an explanation of why the output looks the way it does,
and production notes (including which plugins are construction-time-only
config, `destroy()`'s teardown-order guarantee, and every shipped plugin's
safe no-op behavior outside a browser environment) -- and both an
integration test (running the example's real entry point end to end
against a hand-written recording/stub provider, never live vendor
infrastructure or a real `packages/provider-*` adapter) and, where the
example itself defines any non-trivial pure logic worth isolating (e.g.
`landing-page-engagement`'s CSS-selector-matching helper), a unit test for
it.
