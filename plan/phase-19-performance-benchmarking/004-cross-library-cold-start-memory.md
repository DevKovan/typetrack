# Issue 004: cross-library cold-start + memory comparison (Playwright)

## Context

Read `plan/phase-19-performance-benchmarking/BRIEF.md` in full first,
especially Design decision 4 and the "Research grounding" section's
paragraph on why a naive comparison would be unfair. Read `e2e/
playwright.config.ts`, `e2e/fixtures/*.html`, and `e2e/tests/*.spec.ts` end
to end — this issue's fixtures/specs follow the same shape and conventions
(same Playwright version, same "only Chromium" call per BRIEF's "Out of
scope" section, same local-server-via-`webServer.command` pattern).

Depends on issue 001 (workspace + stub server + vendor devDependencies).

## Scope

1. Four fixture HTML pages under `benchmarks/fixtures/`:
   - `typetrack.html` — loads `/dist/typetrack.global.js` (typetrack's own
     built IIFE global, served the same way `e2e/server.ts` already serves
     it — reuse or import that serving logic from `benchmarks/
     stub-server.ts` rather than reimplementing it; if issue 001's stub
     server doesn't yet serve typetrack's own `dist/index.global.js`,
     extend it here), calls `typetrack.createAnalytics({ provider:
     typetrack.noopProvider })` pointed at the stub's ingestion path (for
     symmetry with the other three, even though `noopProvider` never
     actually sends network requests — document this in a comment so it
     isn't confusing), and sets `window.__ready = true` plus
     `window.__readyAt = performance.now()` once construction completes.
   - `posthog.html` — loads `/vendor/posthog-js.js` (issue 001's stub
     route), calls `posthog.init(<dummy-key>, { api_host:
     "<stub-origin>", autocapture: false, capture_pageview: false,
     disable_session_recording: true, advanced_disable_decide: true,
     loaded: () => { window.__ready = true; window.__readyAt =
     performance.now(); } })` — confirm each of these option names against
     `posthog-js`'s own currently-installed type definitions
     (`node_modules/posthog-js`) rather than assuming they're all still
     current; the intent is "disable every optional heavy feature, point
     at the local stub, use the SDK's own real ready/loaded callback to
     mark completion" — adjust option names if the installed version's API
     differs from what's assumed here.
   - `segment.html` — loads `/vendor/segment-analytics-next.js`,
     initializes `AnalyticsBrowser.load({ writeKey: "<dummy>", cdnURL:
     "<stub-origin>" }, { integrations: { "Segment.io": { apiHost:
     "<stub-origin>/v1" } } })` (again: confirm the real, current
     init-options shape against the installed package's own types/docs —
     Segment's own settings-fetch-on-init behavior is exactly the thing
     Design decision 4 calls out as needing a same-origin/stub redirect;
     find the real config knob that redirects it, don't assume the exact
     option name above is correct without checking), uses the returned
     analytics instance's own ready signal (e.g. `.ready()` promise or
     equivalent — confirm current API) to set `window.__ready`.
   - `rudderstack.html` — loads `/vendor/rudderstack-analytics-js.js`,
     calls `rudderanalytics.load("<dummy-key>", "<stub-origin>", {
     configUrl: "<stub-origin>" })` (again, confirm real current option
     names against the installed package) with its own `ready()` callback
     setting `window.__ready`/`window.__readyAt`.

   For each of the three vendor fixtures, add an HTML comment block at the
   top listing exactly which optional features were explicitly disabled and
   why (mirrors BRIEF Design decision 4's fairness-documentation
   requirement) — this is the single most important piece of this issue for
   result trustworthiness, do not skip it or leave it vague.

2. `benchmarks/playwright.config.ts` — mirrors `e2e/playwright.config.ts`
   (Chromium only, `webServer.command` starting `stub-server.ts` via
   issue 001's exported start function or a thin CLI wrapper script).

3. `benchmarks/tests/cold-start-memory.spec.ts` — for each of the four
   fixtures: navigate to it, wait for `window.__ready === true` (with a
   real timeout, not indefinite), record `window.__readyAt` as the
   cold-start number, and capture JS heap size via Chromium's own DevTools
   Protocol (Playwright exposes this via `page.evaluate(() =>
   (performance as any).memory?.usedJSHeapSize)` when launched with
   `--enable-precise-memory-info`, or via `page.context().newCDPSession()`
   + the `Performance.getMetrics`/`Runtime.getHeapUsage` CDP method if the
   `performance.memory` route isn't reliable enough — pick whichever
   actually returns a stable, real number when you run it by hand, and
   document which one was used and why in the spec file's own comments).
   Take the median of at least 5 repeated navigations per fixture (fresh
   page context each time, no reuse) to reduce single-run noise, matching
   how a real comparative claim should be produced rather than a single
   noisy sample.

4. Write results to `benchmarks/results/cold-start-memory.md` — a table:
   library, median cold-start ms, median heap bytes, with a "Methodology &
   fairness caveats" section above the table (link back to each fixture
   file by path, restate the "measured against a local stub, optional
   heavy features disabled" framing from Design decision 4, and explicitly
   state that these numbers do **not** represent each vendor's
   default/out-of-the-box configuration). Run the real spec and paste real
   output — same "no fabricated numbers" rule as every prior issue.

## Explicitly not in this issue

- Throughput (issue 005 — built on top of this issue's fixtures, so land
  this issue first).
- Firefox/WebKit — Chromium only, see BRIEF "Out of scope."
- Wiring into `qa.yml` — see BRIEF Design decision 6.

## Acceptance criteria

- `cd benchmarks && bun run bench:browser` (or the equivalent `playwright
  test` invocation this issue's `package.json` script points at) runs all
  four fixtures successfully in Chromium with no network calls leaving
  `localhost` (verify by hand — e.g. temporarily disconnect network and
  confirm the run still succeeds, or inspect Playwright's own network log
  for the run).
- Each vendor fixture's HTML comment block accurately lists every disabled
  feature, checked against that package's real, currently-installed API
  (not copied from BRIEF's own illustrative sketch without verification).
- `benchmarks/results/cold-start-memory.md` exists with real numbers from
  an actual run, including the methodology/fairness section.
- `bun run lint`/`typecheck`/`knip` stay green with the new files included.
