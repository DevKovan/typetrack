# Issue 002: typetrack's own cold-start/throughput/memory benchmarks (`mitata`)

## Context

Read `plan/phase-19-performance-benchmarking/BRIEF.md` in full first,
especially Design decisions 1 and 3, and the "Research grounding" section's
`mitata` citation. Read `src/index.performance.test.ts` end to end — this
issue is *not* a replacement for it (that file stays exactly as-is, see
Design decision 1) but should not duplicate its exact two assertions
either; this issue goes wider (multiple configs, memory, not just two
single-number thresholds) and deeper (real distribution/percentile output
via `mitata`, not a single average). Read `src/index.ts`'s `createAnalytics`
signature and options (`provider`, `middleware`/`use()`, `context`,
`reliability`, `schemas`) to pick a representative, real matrix of configs —
do not invent options that don't exist.

Depends on issue 001 (`benchmarks/` workspace + `mitata` devDependency must
exist first).

## Scope

Create `benchmarks/internal.bench.ts` (mitata's own convention is a plain
script, not a `bun:test` file — confirm the exact current API shape,
`bench()`/`group()`/`run()` or whatever `mitata`'s currently-published
version uses, by reading its own README/type definitions inside
`node_modules/mitata` once installed, rather than assuming a remembered
API), covering:

1. **Cold start** — time to construct `createAnalytics({...})` for at least
   three real configs: (a) `noopProvider`, nothing else enabled (the
   cheapest possible construction); (b) `noopProvider` + `context: true` +
   two or three real built-in middleware registered via `.use()`
   (`loggingMiddleware`, `redactMiddleware` — pick real exports from
   `src/middleware/*`, confirm exact names by reading `src/index.ts`'s
   export list); (c) `noopProvider` + `reliability: true` (the offline
   queue setup path). This directly shows the real, measured *cost of
   opting into* each feature, which `docs/performance.md`'s existing
   "What's opt-in cost" section currently only describes qualitatively —
   issue 006 replaces that qualitative language with these real numbers.
2. **Throughput** — `track()` calls/sec (or ms/call, whichever `mitata`'s
   own reporting format naturally gives) for the same three configs from
   (1), plus a fourth: multi-provider fan-out (`provider: [noopProvider,
   noopProvider]`, confirming `Promise.allSettled` fan-out's real overhead
   vs. the single-provider fast path both `src/index.ts` and
   `docs/performance.md` already describe qualitatively).
3. **Memory** — heap growth over a fixed large number of `track()` calls
   (e.g. 10,000) for the noop-baseline config vs. the `reliability: true`
   config (the one path that deliberately buffers/queues, so is the one
   config most likely to show real retained-memory growth). Use Bun's own
   `process.memoryUsage()` (`heapUsed` delta, forcing a GC pass first via
   `Bun.gc(true)` if available — confirm this API's exact current name/
   availability in the installed Bun version rather than assuming) around
   the loop, reported alongside the `mitata` timing output rather than as a
   separate `mitata`-timed benchmark (memory deltas are not what `mitata`
   itself measures — it's a timing tool — so this part of the script
   measures memory directly and prints/writes it, it does not ask `mitata`
   to do it).

Write all three sets of results to a committed `benchmarks/results/
internal.md` (human-readable table, one row per config/dimension) generated
by running the script — do not hand-write fabricated numbers into this
file; run the actual script, capture its real output, and paste that. State
at the top of the file the exact command used to produce it (`cd
benchmarks && bun run bench`) and the date/machine class it was run on
(mirror `src/index.performance.test.ts`'s own comment precedent: "Apple
Silicon" or whatever is accurate at implementation time — do not invent a
false machine descriptor).

Add a unit test, `benchmarks/internal.bench.test.ts` (`bun:test`, not part
of the `mitata` run itself), asserting the benchmark *script's own
correctness* — e.g. that each config object it builds actually constructs
without throwing, that the memory-measurement helper returns a sane
non-negative number for a trivial loop — not asserting any specific timing
number (per BRIEF Design decision 6, no comparative timing assertions
belong in a test that could run in CI; this test only guards against the
benchmark script itself silently breaking, e.g. from a future `src/`
API-shape change).

## Explicitly not in this issue

- Cross-library/vendor comparison (issues 004-005) — this is typetrack-only.
- Bundle size / tree-shaking (issue 003).
- Wiring `bun run bench` into `.github/workflows/qa.yml` — explicitly out
  of scope, see BRIEF Design decision 6.

## Acceptance criteria

- `cd benchmarks && bun run bench` runs `internal.bench.ts` successfully
  end to end and prints real timing output for all three configs across all
  three dimensions (cold start, throughput, memory).
- `benchmarks/results/internal.md` exists, contains real numbers copied
  from an actual run (not fabricated), and states the command + date/machine
  used to produce it.
- `bun test` (repo-wide, or `cd benchmarks && bun test`) passes
  `internal.bench.test.ts`'s correctness assertions.
- `bun run lint`/`typecheck`/`knip` stay green with the new files included.
