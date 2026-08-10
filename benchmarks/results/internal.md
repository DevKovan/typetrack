# typetrack internal benchmarks (`mitata`)

Produced by running:

```sh
cd benchmarks && bun run bench
```

Run date: 2026-08-10. Machine: Apple Silicon (Apple M5, `arm64-darwin`), as
reported by `mitata` itself (`cpu: Apple M5`, `clk: ~4.18 GHz`) and confirmed
independently via `uname -m` (`arm64`) / `sysctl -n machdep.cpu.brand_string`
(`Apple M5`) on the machine this was run on. Bun version: 1.3.14.

This is a *measurement* snapshot (see
`plan/phase-19-performance-benchmarking/BRIEF.md` Design decision 6) --
regenerated on demand, never a CI gate. It is not the same thing as
`src/index.performance.test.ts` (Phase 16's regression-guard smoke test,
which stays exactly as-is and asserts generous, non-comparative thresholds
inside `bun test`).

Numbers below are pasted directly from a real run of
`benchmarks/internal.bench.ts` (ANSI color codes stripped for markdown
legibility -- no numbers hand-edited). Re-run the command above to reproduce
locally; run-to-run variance of low single-digit percent is normal for
`mitata`'s own reported `avg`.

## Configs measured

- **(a) baseline** -- `createAnalytics({ provider: noopProvider })`, nothing
  else enabled. The cheapest possible construction/dispatch path.
- **(b) context + middleware** -- `createAnalytics({ provider: noopProvider,
  context: true })`, plus three real built-in middleware registered via
  `.use()`: `loggingMiddleware({ log: () => {} })` (silenced, so this
  measures dispatch-chain overhead, not stdout I/O cost),
  `redactMiddleware({ fields: ["email"] })`, and
  `enrichmentMiddleware({ properties: { app: "benchmarks" } })`.
- **(c) reliability** -- `createAnalytics({ provider: noopProvider,
  reliability: true })`, the offline queue/retry setup path.
- **(d) multi-provider fan-out** -- `createAnalytics({ provider:
  [noopProvider, noopProvider] })`, throughput only (per issue 002's own
  scope) -- confirms the real overhead of the `Promise.allSettled` fan-out
  path vs. the single-provider fast path (a) uses.

## Cold start -- `createAnalytics()` construction time

| Config | avg (ns/iter) | min … max |
|---|---|---|
| (a) noopProvider only | 209.61 ns | 198.61 ns … 548.71 ns |
| (b) context:true + 3 middleware | 30,490 ns (30.49 µs) | 29,760 ns … 31,670 ns |
| (c) reliability: true | 1,370 ns (1.37 µs) | 416.00 ns … 4.15 ms |

`(b)` includes three real `.use()` calls plus middleware-array allocation
inside the timed construction, which is why it's ~145x costlier than the
bare baseline -- this is the real, measured "cost of opting into" context
capture + middleware `docs/performance.md`'s "opt-in cost" section
previously only described qualitatively. `(c)`'s wide max (4.15 ms) reflects
occasional GC pauses hit during the run, not a stable per-call cost -- the
`avg`/`min` columns are the representative numbers.

## Throughput -- `track()` calls (instance constructed once, outside the timed loop)

| Config | avg (ns/iter) | min … max |
|---|---|---|
| (a) noopProvider only | 109.03 ns | 104.26 ns … 251.44 ns |
| (b) context:true + 3 middleware | 545.92 ns | 525.84 ns … 679.41 ns |
| (c) reliability: true | 116.37 ns | 111.67 ns … 160.82 ns |
| (d) multi-provider fan-out (2x noopProvider) | 573.39 ns | 375.00 ns … 228.33 µs |

`(c)`'s per-`track()` dispatch cost is close to the `(a)` baseline (both
providers succeed immediately, so the queue is never actually touched after
construction) -- the real cost of `reliability: true` is almost entirely at
construction time (the cold-start table above), not per-call. `(d)`'s
`Promise.allSettled` fan-out to two providers costs roughly 5x `(a)`'s
single-provider fast path.

## Memory -- heap growth over 10,000 `track()` calls

`process.memoryUsage().heapUsed` delta, `Bun.gc(true)` (confirmed available
in Bun 1.3.14) forced immediately before and after the measured 10,000-call
loop (plus a 50-call warm-up prefix, discarded, before the "before"
snapshot).

| Config | heap delta |
|---|---|
| noopProvider only | 0 B (0.00 KB) |
| reliability: true | 0 B (0.00 KB) |

Both configs measured 0 B of retained growth after the forced GC pass. This
is a real, expected result for both, not a measurement artifact: neither
config retains any reference to a dispatched event after `track()` resolves
-- `noopProvider` does nothing with the event at all, and
`reliability: true`'s queue only ever stores an entry when the wrapped
provider call actually fails or the instance is offline (see
`src/index.ts`'s `callSingleProvider`); `noopProvider` always succeeds
synchronously, so the queue is never populated and there is nothing for it
to retain across the loop. A config that exercises the queue's real
retention (e.g. a provider that always rejects) would be expected to show
non-zero growth, but that scenario is out of this issue's three-config
scope.

## Full raw `mitata` output

```
$ bun run internal.bench.ts
clk: ~4.18 GHz
cpu: Apple M5
runtime: bun 1.3.14 (arm64-darwin)

benchmark                                                avg (min … max) p75 / p99    (min … top 1%)
------------------------------------------------------------------------ -------------------------------
• cold start: createAnalytics() construction
------------------------------------------------------------------------ -------------------------------
(a) noopProvider only                                     209.61 ns/iter 205.32 ns ██
                                                 (198.61 ns … 548.71 ns) 350.74 ns ██
                                                 (  0.00  b …   2.85 kb)  20.77  b ██▁▃▅▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁

(b) context:true + logging/redact/enrichment middleware    30.49 µs/iter  30.66 µs █    █    █
                                                   (29.76 µs … 31.67 µs)  31.39 µs █  ▅▅█    █▅    ▅   ▅
                                                 (  8.00  b …  15.26 kb)   1.30 kb █▁▁███▁▁▁▁██▁▁▁▁█▁▁▁█

(c) reliability: true                                       1.37 µs/iter   1.42 µs █
                                                   (416.00 ns … 4.15 ms)   5.54 µs █▂
                                                 (  0.00  b …  54.78 mb)   5.30 kb ██▃▂▄▄▃▂▂▁▁▁▁▁▁▁▁▁▁▁▁

• throughput: track() calls/sec
------------------------------------------------------------------------ -------------------------------
(a) noopProvider only                                     109.03 ns/iter 108.33 ns  █
                                                 (104.26 ns … 251.44 ns) 145.89 ns  █▄
                                                 (  0.00  b … 272.00  b)   0.65  b ▅██▄▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁

(b) context:true + logging/redact/enrichment middleware   545.92 ns/iter 544.56 ns   █
                                                 (525.84 ns … 679.41 ns) 617.74 ns  ██
                                                 (  0.00  b … 100.00  b)   1.71  b ▃███▃▁▁▂▁▃▃▄▃▂▁▁▂▁▁▁▁

(c) reliability: true                                     116.37 ns/iter 115.93 ns  █▆
                                                 (111.67 ns … 160.82 ns) 146.37 ns  ██
                                                 (  0.00  b …   0.00  b)   0.00  b ▄██▇▄▂▁▁▁▁▁▁▁▁▁▂▁▁▂▁▁

(d) multi-provider fan-out ([noopProvider, noopProvider]) 573.39 ns/iter 584.00 ns   █▂
                                                 (375.00 ns … 228.33 µs)   1.25 µs  ▂██▆▂
                                                 (  0.00  b …  48.00 kb)   1.09  b ▁██████▅▄▃▃▂▁▁▁▁▁▁▁▁▁

memory: heap growth over 10,000 track() calls (Bun.gc(true) forced before/after)

  noopProvider only : 0 B (0.00 KB)
  reliability: true : 0 B (0.00 KB)
```
