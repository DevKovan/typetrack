// Pure statistics/formatting helpers for Phase 19 issue 005
// (`plan/phase-19-performance-benchmarking/005-cross-library-throughput.md`),
// factored out of `tests/throughput.spec.ts` so they can be unit-tested
// (`throughput-utils.test.ts`) in isolation from real browser/network I/O --
// same "pure logic exported, spec's own I/O calls into it" split
// `cold-start-memory-utils.ts` (issue 004) already uses. `median()` itself
// is imported from that file rather than duplicated -- identical algorithm,
// same reasoning (average-of-two-middle-values resists a single
// slow/GC-paused outlier run better than a mean).

import { median } from "./cold-start-memory-utils";

export interface FixtureThroughputRunResult {
  elapsedMs: number;
  callsPerSecond: number;
}

export interface FixtureThroughputSummary {
  fixture: string;
  n: number;
  runs: number;
  medianElapsedMs: number;
  medianCallsPerSecond: number;
}

export function summarizeThroughputRuns(
  fixture: string,
  n: number,
  runs: FixtureThroughputRunResult[],
): FixtureThroughputSummary {
  if (runs.length === 0) {
    throw new Error(`summarizeThroughputRuns("${fixture}") requires at least one run`);
  }
  return {
    fixture,
    n,
    runs: runs.length,
    medianElapsedMs: median(runs.map((run) => run.elapsedMs)),
    // Deliberately the median of each run's own `callsPerSecond` (not
    // `n / (medianElapsedMs / 1000)`) -- taking the median independently
    // per statistic keeps this function a straightforward per-field
    // reduction, and the two are close enough in practice (`n` is fixed
    // across every run of a given fixture, so `callsPerSecond` is a strictly
    // decreasing function of `elapsedMs`) that they never disagree on which
    // run is the "middle" one.
    medianCallsPerSecond: median(runs.map((run) => run.callsPerSecond)),
  };
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function formatCallsPerSecond(callsPerSecond: number): string {
  return callsPerSecond.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function renderThroughputReport(results: FixtureThroughputSummary[]): string {
  const lines: string[] = [];
  lines.push("# Cross-library throughput comparison");
  lines.push("");
  lines.push(
    "Produced by running `cd benchmarks && bun run bench:browser` (Playwright/Chromium, `tests/throughput.spec.ts`). See `plan/phase-19-performance-benchmarking/BRIEF.md` Design decision 4 for the overall approach, and issue 004's `../results/cold-start-memory.md` for the shared fixture/stub-server setup this issue extends rather than duplicates.",
  );
  lines.push("");
  lines.push("## Methodology & fairness caveats");
  lines.push("");
  lines.push(
    "- Every fixture (`../fixtures/typetrack.html`, `../fixtures/posthog.html`, `../fixtures/segment.html`, `../fixtures/rudderstack.html`) is measured against this workspace's own local stub server (`../stub-server.ts`, Bun.serve()), never live vendor infrastructure -- no network call in this run leaves `localhost`.",
  );
  lines.push(
    "- Each fixture's `window.__runThroughput(n)` calls that library's own real event-tracking method `n` times in a loop (after its ready callback has already fired) and returns `{ elapsedMs, callsPerSecond }` -- see each fixture file's own HTML comment, right above its `__runThroughput` definition, for exactly which method was inspected and what it does under the hood. **These four numbers are not measuring the same kind of work**, confirmed by reading each library's real installed source rather than assumed:",
  );
  lines.push(
    "  - **typetrack**: `analytics.track()` against `noopProvider` is fully synchronous (`void`, no I/O, no microtask) -- this measures pure dispatch-loop overhead only, and never touches the local stub server at all (`noopProvider` makes no network call, by design).",
  );
  lines.push(
    "  - **posthog-js**: `posthog.capture()` is synchronous (`CaptureResult | undefined`) and enqueues into an in-memory `RequestQueue` that flushes on a timer (`flush_interval_ms`, default 3000ms), combining multiple queued events into one batched HTTP request. This measures time-to-all-*dispatched* (synchronous enqueue cost), not time-to-all-network-confirmed -- the loop completes before any request reaches the local stub.",
  );
  lines.push(
    "  - **@segment/analytics-next**: `analytics.track()` returns `Promise<DispatchedEvent>`, and with no `deliveryStrategy` configured (this fixture's config), the \"Segment.io\" destination plugin uses its standard (non-batching) dispatcher -- one real `fetch()` per `track()` call, and the returned promise resolves only once that `fetch()` call's response has been read. This measures time-to-all-network-*confirmed* (against the local stub) -- the only one of the four that includes a response round trip in its number.",
  );
  lines.push(
    "  - **@rudderstack/analytics-js**: `rudderanalytics.track()` is synchronous (`void`) and, like posthog-js, enqueues into a client-side events queue (`maxItems`/`flushQueueInterval` options) that periodically flushes a batched request to a `/v1/batch` endpoint. This measures time-to-all-dispatched (synchronous enqueue cost), not time-to-all-network-confirmed -- but that enqueue cost is not free: this SDK's `RetryQueue` is backed by `localStorage` by default, and every single `track()` call serializes and rewrites the *entire* queue array back to storage (`setStorageEntry`), an O(queue length) cost per call rather than O(1). That is the real, source-confirmed (not assumed) reason its measured calls/sec below is markedly lower than posthog-js's in-memory-only queue, not a fixture bug -- see `../fixtures/rudderstack.html`'s own comment.",
  );
  lines.push(
    "- Each vendor SDK fixture still has its heaviest optional init-time features disabled the same way as issue 004's cold-start/memory comparison -- see that issue's fixture-file comments and `../results/cold-start-memory.md`'s own methodology section; this is a reduced-feature-set comparison, not each vendor's default configuration.",
  );
  lines.push(
    "- `n` (the number of calls per run, see the table below) and the reasoning for that choice are documented in `tests/throughput.spec.ts`'s own header comment.",
  );
  lines.push(
    "- Median of 5 runs, fresh browser context per run (same discipline as issue 004's cold-start/memory comparison) -- `elapsedMs` and `callsPerSecond` are each reduced to their own median independently across the 5 runs.",
  );
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| Library | n | Median elapsed | Median calls/sec |");
  lines.push("|---|---|---|---|");
  for (const result of results) {
    lines.push(
      `| ${result.fixture} | ${result.n} | ${formatMs(result.medianElapsedMs)} | ${formatCallsPerSecond(result.medianCallsPerSecond)} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}
