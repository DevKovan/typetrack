# 005 -- Performance regression smoke test

## Context

Independent of every other issue in this phase. Read
`plan/phase-16-testing-infrastructure/BRIEF.md`'s Design decision 3 first
-- this issue is deliberately narrow (a regression guard, not the
comparative benchmarking suite Phase 19 owns) and adds **no new
dependency**: plain `performance.now()`/`Bun.nanoseconds()` timing inside
a `bun:test` file, nothing else.

## Scope of this issue

New `src/index.performance.test.ts`. Covers two hot paths, each as its own
`it()`:

1. **`createAnalytics()` construction overhead**: construct an `Analytics`
   instance (minimal config -- `noopProvider`, no middleware/routing/
   reliability/context extras enabled) in a loop (e.g. 1,000 iterations),
   measure total elapsed time, assert the **average per-call** time stays
   under a generous threshold (e.g. well under 1ms/call on typical CI
   hardware -- pick the actual number empirically: run it locally first,
   observe the real average, then set the threshold at roughly 5-10x that
   observed value, so routine CI-runner variance/jitter never produces a
   false failure, while a genuine order-of-magnitude regression -- e.g.
   someone accidentally making construction do synchronous I/O -- still
   trips it).
2. **`track()` dispatch overhead**: construct one `Analytics` instance
   once (`noopProvider`, no `schemas`/validation enabled, so this measures
   core's own dispatch path, not a specific provider's or Zod's cost),
   then call `track()` in a loop (e.g. 1,000 iterations) awaiting each
   call, measure total elapsed time, assert the average per-call time
   stays under a generous threshold, same empirical-measure-then-multiply
   approach as above.

Both assertions must be **generous enough that they don't flake on a
loaded CI runner** -- the goal is catching a real regression (an
accidental synchronous network call, an O(n²) loop, a forgotten `await`
turning something serial that should be parallel), not asserting tight
production performance numbers. If the implementor finds these still
flake in a few local repeated runs, widen the threshold further rather
than trying to make CI hardware more consistent.

## Design notes

- Use `noopProvider` (`src/providers/index.ts`) for both cases -- it's
  already a genuine no-op, so any measured overhead is core's own, not a
  provider's.
- Do not enable middleware/routing/reliability/context/plugins for this
  test -- the point is measuring `createAnalytics()`/`track()`'s own
  baseline dispatch cost, not any optional feature's added cost (those
  each already have their own correctness tests elsewhere; none need a
  performance regression guard in this initial pass).
- If Bun's `bun:test` run is meaningfully affected by JIT warm-up on the
  first several iterations, discard a small warm-up prefix (e.g. the first
  50-100 iterations) before starting the timed measurement, a standard
  microbenchmarking practice -- implementor's call on the exact warm-up
  count.

## Testing

This issue's own file *is* its test -- no separate test-of-the-test is
needed (unlike issue 001's kit, this isn't reusable library code other
files import, just one test file). Run it standalone several times
(`bun test src/index.performance.test.ts`, repeated 5+ times locally) to
confirm the chosen thresholds don't flake before committing.

## Out of scope

Comparative benchmarking against other providers/SDKs, cold-start/memory/
throughput measurement, tree-shaking analysis -- all Phase 19. Any new
benchmarking library (`mitata`/`tinybench`/etc.) -- plain timing is
sufficient for a regression guard at this scope.
