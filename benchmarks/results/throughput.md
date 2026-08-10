# Cross-library throughput comparison

Produced by running `cd benchmarks && bun run bench:browser` (Playwright/Chromium, `tests/throughput.spec.ts`). See `plan/phase-19-performance-benchmarking/BRIEF.md` Design decision 4 for the overall approach, and issue 004's `../results/cold-start-memory.md` for the shared fixture/stub-server setup this issue extends rather than duplicates.

## Methodology & fairness caveats

- Every fixture (`../fixtures/typetrack.html`, `../fixtures/posthog.html`, `../fixtures/segment.html`, `../fixtures/rudderstack.html`) is measured against this workspace's own local stub server (`../stub-server.ts`, Bun.serve()), never live vendor infrastructure -- no network call in this run leaves `localhost`.
- Each fixture's `window.__runThroughput(n)` calls that library's own real event-tracking method `n` times in a loop (after its ready callback has already fired) and returns `{ elapsedMs, callsPerSecond }` -- see each fixture file's own HTML comment, right above its `__runThroughput` definition, for exactly which method was inspected and what it does under the hood. **These four numbers are not measuring the same kind of work**, confirmed by reading each library's real installed source rather than assumed:
  - **typetrack**: `analytics.track()` against `noopProvider` is fully synchronous (`void`, no I/O, no microtask) -- this measures pure dispatch-loop overhead only, and never touches the local stub server at all (`noopProvider` makes no network call, by design).
  - **posthog-js**: `posthog.capture()` is synchronous (`CaptureResult | undefined`) and enqueues into an in-memory `RequestQueue` that flushes on a timer (`flush_interval_ms`, default 3000ms), combining multiple queued events into one batched HTTP request. This measures time-to-all-*dispatched* (synchronous enqueue cost), not time-to-all-network-confirmed -- the loop completes before any request reaches the local stub.
  - **@segment/analytics-next**: `analytics.track()` returns `Promise<DispatchedEvent>`, and with no `deliveryStrategy` configured (this fixture's config), the "Segment.io" destination plugin uses its standard (non-batching) dispatcher -- one real `fetch()` per `track()` call, and the returned promise resolves only once that `fetch()` call's response has been read. This measures time-to-all-network-*confirmed* (against the local stub) -- the only one of the four that includes a response round trip in its number.
  - **@rudderstack/analytics-js**: `rudderanalytics.track()` is synchronous (`void`) and, like posthog-js, enqueues into a client-side events queue (`maxItems`/`flushQueueInterval` options) that periodically flushes a batched request to a `/v1/batch` endpoint. This measures time-to-all-dispatched (synchronous enqueue cost), not time-to-all-network-confirmed -- but that enqueue cost is not free: this SDK's `RetryQueue` is backed by `localStorage` by default, and every single `track()` call serializes and rewrites the *entire* queue array back to storage (`setStorageEntry`), an O(queue length) cost per call rather than O(1). That is the real, source-confirmed (not assumed) reason its measured calls/sec below is markedly lower than posthog-js's in-memory-only queue, not a fixture bug -- see `../fixtures/rudderstack.html`'s own comment.
- Each vendor SDK fixture still has its heaviest optional init-time features disabled the same way as issue 004's cold-start/memory comparison -- see that issue's fixture-file comments and `../results/cold-start-memory.md`'s own methodology section; this is a reduced-feature-set comparison, not each vendor's default configuration.
- `n` (the number of calls per run, see the table below) and the reasoning for that choice are documented in `tests/throughput.spec.ts`'s own header comment.
- Median of 5 runs, fresh browser context per run (same discipline as issue 004's cold-start/memory comparison) -- `elapsedMs` and `callsPerSecond` are each reduced to their own median independently across the 5 runs.

## Results

| Library | n | Median elapsed | Median calls/sec |
|---|---|---|---|
| typetrack | 1000 | 0.70 ms | 1,428,571 |
| posthog | 1000 | 6.80 ms | 147,059 |
| segment | 1000 | 518.70 ms | 1,928 |
| rudderstack | 1000 | 2474.90 ms | 404 |
