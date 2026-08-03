# 003 — `examples/` entry for automatic context capture

## Context

Depends on issues 001-002 (full context-capture pipeline implemented and
passing QA). Per `plan/VISION.md`'s Examples policy — every feature ships
its `examples/` entries in the same phase that built it — this closes out
Phase 9. Per `plan/ROADMAP.md`'s Phase 9 line, this folds into
`examples/core/` (extending the existing directory) rather than standing
up a new top-level category, since context capture is a core-option
feature, not a provider/middleware/plugin/framework concern.

Follow `examples/core/README.md` and `examples/middleware/README.md`'s
established conventions exactly (read both in full, plus at least one
example subdirectory from `examples/core/` — `canonical-event-shape` and
`provider-switch` — before starting): a `runXxxFlow(...)`-style exported
function importing the real, unmodified `typetrack` package
(`file:../../..` dependency, own `package.json`), a hand-written
`AnalyticsProvider` stub (not a mock), a unit test (for any pure logic
worth isolating) and an integration test running the example's real
entry point end-to-end, `expected-output.txt`, and a README with
Prerequisites/How to run/Source/Expected output/Explanation/Production
notes sections. Realistic event names only ("Page Viewed", "Checkout
Started" — never `test`/`foo`/`bar`).

Since real `window`/`navigator`/`document`/`location` globals don't exist
in a plain Bun script, this example must simulate a "real page load" by
stubbing those globals before calling into `typetrack` — check what
browser-environment-stubbing approach issue 001's unit tests already
established (`src/context.test.ts`) and reuse the same technique here for
consistency, rather than inventing a second approach.

## Acceptance criteria

- New `examples/core/context-capture/` subdirectory added alongside the
  existing `canonical-event-shape`/`provider-switch` subdirectories
  (`examples/core/README.md`'s index updated to link it, following the
  same one-paragraph-per-example style as the existing two entries).
- The example demonstrates, in one coherent, realistic flow simulating a
  real page load:
  - `createAnalytics({ context: true })` with a stubbed browser
    environment (`window`/`navigator.userAgent`/`document.referrer`/
    `location.search` set to realistic values — e.g. a Chrome-on-macOS
    UA, a `document.referrer` from a search engine, `?utm_source=
    newsletter&utm_medium=email&utm_campaign=spring-sale` in the URL).
  - A `page()` call (e.g. `analytics.page("Home")`) whose delivered event
    (captured by the stub provider) shows the full auto-captured
    `context` shape: `locale`, `timezone`, `browser`, `os`, `device`,
    `viewport`, `referrer`, `campaign`, `session`.
  - At least one subsequent `track()` call (e.g. `analytics.track
    ("Checkout Started", { plan: "pro" })`) showing `context.session
    .eventCount` incrementing across calls within the same instance.
  - A demonstration of the merge/precedence rule: one call passes an
    explicit `TrackOptions.context` (e.g. overriding `locale`) and the
    stub-provider-recorded event shows the caller's value winning while
    other auto-captured fields (e.g. `timezone`, `session`) remain
    present.
  - A demonstration of the `featureFlags` getter: `createAnalytics({
    context: { autoCapture: true, featureFlags: () => ({...}) } })`
    (either as a second flow/entry point in the same subdirectory, or
    folded into the main flow — implementor's call, whichever reads more
    coherently) showing the getter's return value mirrored verbatim into
    `context.featureFlags` on a delivered event.
  - A demonstration of the Node/non-browser fallback: the same
    `createAnalytics({ context: true })` config, but without stubbing
    `window`/`navigator` — the delivered event's `context` still has
    `locale`/`timezone`/`session`, but `browser`/`os`/`device`/
    `viewport`/`referrer`/`campaign` are absent (not `undefined` keys) —
    this is the single most important thing for a reader of this example
    to see clearly, since it's the safe-no-op guarantee the whole
    feature depends on.
- `package.json` (`file:../../..` dependency, mirroring the existing
  `examples/core/*` subdirectories' shape), `index.ts` (exported flow
  function(s)), `index.integration.test.ts` (runs the real flow(s),
  asserts the stub-provider-received events' `context` shape against
  hand-computed expectations for both the browser-stubbed and
  non-browser cases), optionally a unit test for any isolated pure logic
  (e.g. the UTM-string fixture construction, if non-trivial enough to
  warrant one — do not manufacture one otherwise), `expected-output.txt`
  (literal captured output), `README.md` (Prerequisites/How to run/
  Source/Expected output/Explanation/Production notes).
- Production notes section covers at minimum: `context: true` is opt-in
  and off by default (zero behavior change for existing apps); the
  merge rule (caller-supplied `TrackOptions.context` always wins on key
  collision, shallow not deep); the safe-no-op guarantee server-side
  (browser-only fields are simply absent, `locale`/`timezone`/`session`
  still populate); the `featureFlags` getter is app-owned — typetrack
  does not evaluate or fetch flags itself, only mirrors whatever the
  getter returns at call time; UA parsing is best-effort (a small
  internal heuristic, not exhaustive) and should not be relied on for
  precise browser/OS version detection in analytics dashboards that
  need it.

## Test requirements

- Integration test required, as described above — run the real flow(s),
  assert the stub provider's recorded `CanonicalEvent.context` shape for
  both the browser-stubbed and plain-Node cases, and for the merge/
  precedence and `featureFlags` scenarios.
- A unit test is required only if `index.ts` contains non-trivial pure
  logic beyond direct `typetrack` API calls, provider-stub construction,
  and global stubbing — do not manufacture one if there's nothing
  non-trivial to unit-test; state explicitly in the commit notes if
  omitted and why.

## Out of scope

- Any change to `src/` — this issue is examples-only.
- Live vendor infrastructure — the provider in the example is a
  hand-written stub, never a real `packages/provider-*` adapter.
- A new top-level `examples/frameworks/` entry — folded into
  `examples/core/` per the resolved scope above; revisit only if a real
  framework wrapper (Phase 14) later wants its own browser-context demo.
