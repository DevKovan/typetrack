# Issue 005: cross-library throughput comparison (Playwright)

## Context

Read `plan/phase-19-performance-benchmarking/BRIEF.md` first. Read issue
004 in full and its landed output (`benchmarks/fixtures/*.html`,
`benchmarks/playwright.config.ts`) — this issue extends the same four
fixtures rather than creating new ones.

Depends on issue 004 (fixtures + config must exist and pass first).

## Scope

1. Extend each of the four fixtures from issue 004 with a
   `window.__runThroughput(n)` function (added after the ready callback
   fires) that calls that library's own event-tracking method `n` times in
   a tight loop against the local stub endpoint (already wired in issue
   004's init config) and returns `{ elapsedMs, callsPerSecond }`:
   - `typetrack.html`: `await Promise.all(Array.from({ length: n }, () =>
     analytics.track("benchmark_event", { i })))` — confirm whether
     `track()` needs awaiting per-call or can be fired-and-collected, based
     on `src/index.ts`'s real return type.
   - `posthog.html`: `posthog.capture("benchmark_event", { i })` (PostHog's
     `capture()` is fire-and-forget/batches client-side — confirm current
     behavior against the installed version, and if it batches, measure
     time-to-all-dispatched rather than time-to-all-network-confirmed,
     documenting which one clearly).
   - `segment.html`: `analytics.track("benchmark_event", { i })`.
   - `rudderstack.html`: `rudderanalytics.track("benchmark_event", { i
     })`.

   For each, pick `n` large enough to produce a stable, non-noise-dominated
   measurement (start with 1,000, adjust upward if a dry run shows high
   run-to-run variance — document the chosen `n` and why in the spec file).

2. `benchmarks/tests/throughput.spec.ts` — for each fixture: navigate, wait
   for ready (reuse issue 004's ready-wait helper — extract it to a small
   shared helper module, e.g. `benchmarks/tests/helpers.ts`, if issue 004
   didn't already factor it out, rather than copy-pasting the wait logic
   four times over across two spec files), call `window.__runThroughput(n)`
   via `page.evaluate`, and record the result. Same median-of-5-runs
   discipline as issue 004, fresh page context per run.

3. Write results to `benchmarks/results/throughput.md` — a table: library,
   `n`, median elapsed ms, median calls/sec — with the same "Methodology &
   fairness caveats" framing as issue 004's results file (in particular:
   state plainly whether each library's number reflects synchronous
   dispatch-queueing cost only, or includes the local stub's response
   round-trip, since that distinction matters for interpreting the number
   correctly — inspect each library's actual method behavior rather than
   assuming they're all doing the same kind of work under the hood, since
   they are not: some batch, some fire one request per call). Run the real
   spec and paste real output.

## Explicitly not in this issue

- Cold start / memory — issue 004 already covers those; do not re-measure
  them here even though the fixtures are shared.
- Wiring into `qa.yml` — see BRIEF Design decision 6.

## Acceptance criteria

- `cd benchmarks && bun run bench:browser` runs both `cold-start-memory.
  spec.ts` (issue 004) and `throughput.spec.ts` (this issue) successfully.
- `benchmarks/results/throughput.md` exists with real numbers from an
  actual run, including the methodology/fairness section explaining what
  is and isn't being measured per library.
- No duplicated wait-for-ready logic between the two spec files (factored
  into a shared helper if not already done in issue 004).
- `bun run lint`/`typecheck`/`knip` stay green with the new files included.
