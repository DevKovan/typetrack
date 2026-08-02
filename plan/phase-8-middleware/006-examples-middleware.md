# 006 — `examples/middleware/` example

## Context

Depends on issues 001-005 (full middleware pipeline plus all six built-ins
implemented and passing QA). Per `plan/VISION.md`'s Examples policy —
every feature ships its `examples/` entries in the same phase that built
it — this closes out Phase 8.

Follow `examples/core/` and `examples/providers/`'s established
conventions exactly (read `examples/core/README.md`,
`examples/providers/README.md`, and at least one example subdirectory
from each in full before starting): a top-level `examples/middleware/
README.md` index, one or more example subdirectories, a
`runXxxFlow(...)`-style exported function importing the real, unmodified
`typetrack` package (`file:../../..` dependency, own `package.json`),
hand-written `AnalyticsProvider` stubs (not mocks), both a unit test (for
any pure logic worth isolating) and an integration test that runs the
example's real entry point end-to-end, `expected-output.txt`, and a
README with Source/Expected output/Explanation/Production notes sections.
Realistic event names only ("Purchase Completed", "Checkout Started",
"User Signed Up" — never `test`/`foo`/`bar`).

Per `plan/VISION.md`'s middleware-example requirement specifically:
"Every middleware example: basic usage, composition, execution order,
error handling, performance notes" — this issue's example(s) must
demonstrably cover all five, not just illustrate one built-in in
isolation.

## Acceptance criteria

- New `examples/middleware/README.md` (top-level index, mirroring
  `examples/core/README.md`/`examples/providers/README.md`'s structure):
  explains what `examples/middleware/` demonstrates, links to the example
  subdirectory(ies), states the not-part-of-any-published-package /
  excluded-from-build note exactly as the other `examples/*/README.md`
  files do.
- At least one example subdirectory, e.g.
  `examples/middleware/pipeline-basics/`, that demonstrates in a single
  coherent, realistic flow:
  - **Basic usage**: a single built-in middleware (e.g.
    `versionMiddleware`) registered via `.use()` and shown affecting a
    `track()` call's delivered event.
  - **Composition**: multiple middlewares registered together (e.g.
    `versionMiddleware` + `enrichmentMiddleware` + `redactMiddleware` +
    `loggingMiddleware`), demonstrating registration-order-dependent
    behavior — pick an example where order visibly matters (e.g. enrich
    before redact vs. after, so the README can explain why the chosen
    order was necessary).
  - **Execution order**: explicitly demonstrate the `before` (all, in
    order) → dispatch → `after` (all, in order) sequence — e.g. via
    `loggingMiddleware` or a small custom middleware in the example that
    logs its own name at each phase, so `expected-output.txt` shows the
    literal interleaving.
  - **Error handling**: at least one scenario where a middleware's
    `before()` throws (demonstrating `onError` firing with `source:
    "middleware"`) and at least one scenario where a provider's dispatch
    rejects (demonstrating `onError` firing with `source: "provider"` and
    the correct `providerName`) — both via a registered `onError` handler
    (could reuse `loggingMiddleware`'s `onError` hook, or a
    purpose-built one) whose output is visible in
    `expected-output.txt`.
  - A second, focused example subdirectory (e.g.
    `examples/middleware/sampling-vs-routing/`) is recommended if it
    meaningfully clarifies the `samplingMiddleware` vs. Phase 7's
    `ProviderEntry.sampling` distinction (demonstrating both layers
    composing together on a multi-provider setup) — this directly serves
    `plan/VISION.md`'s "don't let the two features collide or duplicate"
    concern from the brief. Not mandatory as a separate directory if the
    first example already demonstrates this clearly enough — implementor's
    call, but the distinction must be demonstrated and explained somewhere
    in this issue's example(s).
  - Each subdirectory: `package.json` (`file:../../..` dependency,
    mirroring `examples/core`/`examples/providers`' shape),
    `index.ts` (exported flow function), `index.integration.test.ts`
    (runs the real flow, asserts provider-received-event logs and
    `onError`/logging output against hand-computed expectations),
    optionally a unit test for any isolated pure logic,
    `expected-output.txt` (literal captured output), `README.md`
    (Prerequisites/How to run, Source, Expected output, Explanation,
    Production notes — Production notes must cover at minimum: built-in
    middlewares are opt-in only, never auto-enabled; middleware order is
    significant and must be chosen deliberately; a dropped event via
    `samplingMiddleware`/a conditional middleware is silent by design —
    apps needing visibility into drops should register a
    `loggingMiddleware` or custom `before` observer; `onError` handlers
    must not throw, and if they do the failure is swallowed-and-warned,
    never crashing the calling `track()`).
- Performance notes section (can live in the README's Production notes,
  or a dedicated subsection) addressing: middleware runs synchronously
  in the hot path of every `track`/`page`/`screen` call (linear cost in
  number of registered middlewares); async `before`/`after` hooks add
  real latency to the call's returned promise — apps with strict latency
  budgets should keep `before()` cheap/synchronous where possible and
  push expensive work (e.g. real logging I/O) to `after()`/fire-and-forget
  where the dispatch has already happened.

## Test requirements

- Integration test(s) required for every example subdirectory, as
  described above — run the real flow, assert real per-provider
  received-event logs and `onError`/logging call logs against
  hand-computed expectations covering basic usage, composition/ordering,
  and both error-handling scenarios.
- A unit test is required only if an example's `index.ts` contains
  non-trivial pure logic beyond direct `typetrack` API calls, provider-
  stub construction, and built-in middleware configuration — do not
  manufacture one if there's nothing non-trivial to unit-test; state
  explicitly in the commit notes if omitted and why.

## Out of scope

- Any change to `src/` — this issue is examples-only.
- Live vendor infrastructure — every provider in the example(s) is a
  hand-written stub, never a real `packages/provider-*` adapter.
