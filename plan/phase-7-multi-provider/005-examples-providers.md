# 005 — `examples/providers/` multi-provider + routing example

## Context

Depends on issues 001-004 (multi-provider fan-out, routing, priority,
`AggregateError` all fully implemented and passing QA). Per
`plan/VISION.md`'s Examples policy — every feature ships its `examples/`
entries in the same phase that built it — this closes out Phase 7.

Follow `examples/core/`'s established conventions exactly (read
`examples/core/README.md` and `examples/core/canonical-event-shape/` in
full before starting): a top-level `examples/providers/README.md` index,
one example subdirectory, a `runXxxFlow(...)`-style exported function
importing the real, unmodified `typetrack` package (`file:../../..`
dependency, own `package.json`), a hand-written `AnalyticsProvider` stub
(or several) rather than mocks, both a unit test (for any pure logic worth
isolating) and an integration test that runs the example's real entry
point end-to-end, `expected-output.txt`, and a README with Source/Expected
output/Explanation/Production notes sections. Realistic event names only
("Purchase Completed", "Checkout Started", "User Signed Up" — never
`test`/`foo`/`bar`).

## Acceptance criteria

- New `examples/providers/README.md` (top-level index, mirroring
  `examples/core/README.md`'s structure): explains what
  `examples/providers/` demonstrates (multi-provider fan-out + routing),
  links to the one example subdirectory, states the
  not-part-of-any-published-package / excluded-from-build note exactly as
  `examples/core/README.md` does.
- One example subdirectory, e.g.
  `examples/providers/multi-provider-routing/`, containing:
  - `package.json` (mirrors `examples/core/canonical-event-shape/
    package.json`'s shape — `file:../../..` dependency on root
    `typetrack`).
  - `index.ts`: constructs `createAnalytics({ provider: [...] })` with
    **4 hand-written stub providers** (realistic vendor-flavored names,
    e.g. `analyticsWarehouseProvider`, `marketingPixelProvider`,
    `debugConsoleProvider`, `fullFeaturedProvider` — or similar; avoid
    naming them literally `provider1`/`providerA`), configured as:
    1. One entry with `include: ["Purchase Completed", "Checkout
       Started"]` (only receives commerce events).
    2. A different entry with `exclude: [/^debug\./]` (receives
       everything except debug-namespaced events) — must be a *different*
       provider than #1, since same-provider include+exclude throws
       (issue 001).
    3. One entry with a `predicate` (e.g. only route events whose
       `properties.value` exceeds some realistic threshold, or whose
       `context` marks a particular environment) — pick a realistic,
       explainable condition.
    4. One entry with `sampling` (e.g. `0.5`) demonstrating deterministic
       per-`anonymousId` sampling — run the flow with at least two
       distinct simulated `anonymousId`s (via two separate
       `createAnalytics()` instances, since `anonymousId` isn't settable
       post-construction) to show one lands in and the other out (or both
       consistently the same way across repeated calls) at a fixed
       sampling rate.
    5. At least one entry (or a 5th provider) with an explicit `priority`
       different from the others, demonstrating call-order (not
       exclusion) — the example's provider stubs should log/record when
       they're invoked so the README's expected output can show the
       observed call order.
    Runs a realistic flow: a few `track()` calls (mixing commerce event
    names that hit `include`/`exclude` differently, and at least one
    `debug.*`-namespaced event demonstrating the exclude), an
    `identify()` call (demonstrating always-fan-out — every one of the 4
    providers receives it regardless of their routing config), and a
    `flush()` call at the end.
  - `index.integration.test.ts`: imports and runs `index.ts`'s exported
    flow function against the real providers/config, asserts each stub
    provider's recorded call log matches the expected routed/excluded/
    sampled/ordered outcome — this is the example's regression guard, not
    just illustrative prose.
  - Optionally a small unit test file if the example's own predicate/
    sampling-demo logic has any non-trivial pure logic worth isolating
    (not required if the example is straightforward orchestration).
  - `expected-output.txt`: literal captured output of running `index.ts`.
  - `README.md`: Prerequisites/How to run (mirror
    `canonical-event-shape/README.md`'s exact style), Source (excerpt the
    key `provider` array construction with routing config), Expected
    output (link to `expected-output.txt`), Explanation (walk through
    *why* each provider did/didn't receive each event — this is the
    pedagogical core of the example, spend real effort here per event/
    provider combination), Production notes (at minimum: sampling is
    per-`anonymousId` not per-event, so a user's sampling in/out decision
    for a given provider stays stable across their whole session/until
    `reset()`; routing config is evaluated per-call, not cached, so it's
    cheap to have many providers with different routing rather than
    manually branching application code; `flush()`/`destroy()` on a
    multi-provider array can throw `AggregateError` — real apps should
    catch and log it rather than letting it propagate uncaught).

## Test requirements

- Integration test (`index.integration.test.ts`) is required, as
  described above — run the real flow, assert real per-provider call logs
  against hand-computed expectations covering every routing mechanism
  (include, exclude, predicate, sampling, priority ordering, and
  always-fan-out `identify()`).
- A unit test is required only if `index.ts` contains non-trivial pure
  logic beyond direct `typetrack` API calls and provider-stub
  construction (e.g. if the predicate or sampling demonstration involves
  a helper worth testing in isolation) — do not manufacture one if there's
  nothing non-trivial to unit-test; state explicitly in the PR/commit
  notes if omitted and why.

## Out of scope

- Any change to `src/` — this issue is examples-only.
- A second example subdirectory — one well-built example covering all
  five routing mechanisms is sufficient for this phase; do not split into
  multiple thin examples.
- Live vendor infrastructure — every provider in the example is a
  hand-written stub, never a real `packages/provider-*` adapter pointed at
  real infrastructure (matches `canonical-event-shape/`'s approach, not
  `provider-switch/`'s optional live-GA4 entry point).
