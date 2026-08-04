# 005 — Batching: `ProviderCapabilities.batch` + `trackBatch()`, drain-loop coalescing

## Context

Depends on issue 003 (the drain loop this issue modifies to coalesce
calls). Read `src/providers/index.ts`'s `AnalyticsProvider` and
`ProviderCapabilities` in full first — this issue extends both, following
the exact optional-method + capability-flag pattern already established
there (e.g. how `flush`/`destroy` are optional methods, and how
`ProviderCapabilities` already gates other optional behavior).

Batching only ever applies to entries that are already in the reliability
queue (drained via the background loop or `flush()`) — it does not change
the fast path for a `track()` call whose provider succeeds immediately
(that path calls `provider.track(event)` for exactly that one event, as
today; there is nothing to batch when there's only one event and it's not
queued).

## Scope of this issue

- Add an optional `trackBatch?(events: CanonicalEvent[]): void |
  Promise<void>` method to `AnalyticsProvider`. Document: receives 2+
  events destined for `track`/`page`/`screen` in original priority/FIFO
  drain order; a provider implementing this opts into receiving queued
  events in batches instead of one `track`/`page`/`screen` call per
  event, when the drain loop has multiple ready entries for it at once.
- Add `batch?: boolean` to `ProviderCapabilities`, following the existing
  capability-flag convention (`isCapabilitySupported`-style gating
  elsewhere in the codebase — read how existing capability flags are
  declared/checked and mirror it exactly).
- Modify issue 003's `drainQueueOnce()`: group `peekReady()`'s results by
  `providerName`; for a provider group where the live provider declares
  `capabilities.batch === true` and implements `trackBatch`, and the
  group's size is `>= 2`: split the group into chunks of at most
  `ReliabilityOptions.batch.size` (default 10), and for each chunk within
  `ReliabilityOptions.batch.intervalMs` of the drain tick (see below),
  call `provider.trackBatch(chunk.map(e => e.event))` once; on success,
  `recordSuccess` for every entry in the chunk; on failure, `recordFailure`
  for every entry in the chunk (a batch failure is treated as a uniform
  failure of every event in it — no partial-success signal exists in the
  `trackBatch` contract, since the return type carries no per-event
  status). A group of size `1`, or a provider without batch support, is
  drained exactly as issue 003 already does (one `track`/`page`/`screen`
  call per entry) — batching never applies to a lone ready entry, since
  there's nothing to coalesce.
- `ReliabilityOptions.batch.intervalMs` (default 5000, per issue 003's
  type definition): governs how long the drain loop **waits to
  accumulate** a fuller batch before sending a partial one, distinct from
  the drain tick interval itself. Simplify: rather than a second,
  separate accumulation timer, this issue implements it as "a
  provider-group's queued entries are batch-sent on the drain tick if
  either the group already has `>= batch.size` ready entries, or the
  oldest ready entry in the group has been waiting `>= batch.intervalMs`"
  — avoids introducing a second concurrent timer loop; document this
  simplification explicitly (it's an approximation of "batch window"
  semantics, not a precise fixed-interval batcher, and is an accepted
  tradeoff given the drain tick itself already runs on a fixed interval
  per issue 003).
- Every existing/example provider adapter in `packages/provider-*` is
  **not** required to implement `trackBatch` by this issue (it's
  optional) — do not modify `packages/provider-ga4`, `-posthog`,
  `-segment` to add batch support; this issue's acceptance criteria are
  satisfiable entirely with hand-written stub providers in `src/`'s own
  tests.

## Design decisions made in this issue

- **All-or-nothing batch failure handling.** `trackBatch`'s signature
  carries no way to report which specific events in the chunk failed —
  designing a richer per-event-result return type is real, separate
  scope (would ripple into every provider adapter's error-reporting
  conventions); "the whole batch either succeeded or it didn't" is the
  simplest correct contract for this phase, and providers that need
  finer-grained reporting can simply not implement `trackBatch` (falling
  back to the existing one-call-per-event path, which already has
  precise per-event success/failure).
- **Batching only accumulates within a single drain tick's `peekReady()`
  snapshot**, never holds ready entries back across multiple ticks purely
  to build a bigger batch beyond what `batch.intervalMs`'s wait-check
  already covers — avoids a second timer/scheduling mechanism, per the
  simplification noted above.
- **No batching on the offline-proactive-enqueue or immediate-failure
  paths** (issue 003's fast paths) — batching is exclusively a drain-loop
  (queue-draining) optimization, never something a single live `track()`
  call waits around for.

## Acceptance criteria

- `AnalyticsProvider.trackBatch?` and `ProviderCapabilities.batch?` are
  present, documented, and optional (no existing provider/test that
  doesn't implement them breaks).
- A stub provider with `capabilities.batch: true` and a `trackBatch`
  implementation: draining 3 ready queued entries for that provider in
  one tick results in exactly one `trackBatch` call with all 3 events (in
  drain order), not 3 individual `track`/`page`/`screen` calls.
- The same scenario with only 1 ready entry for that provider: falls back
  to a single `track`/`page`/`screen` call, `trackBatch` never called.
- A provider without `capabilities.batch`/`trackBatch`: always drains one
  event at a time regardless of how many are ready, exactly as issue 003
  specified before this issue.
- `batch.size: 2` with 5 ready entries for a batch-capable provider:
  results in 3 `trackBatch` calls (sizes 2, 2, 1) — verify chunking.
  (The final chunk of size 1 still goes through `trackBatch`, not a
  fallback single call, since it's still part of a group that had
  `>= 2` ready entries overall — only groups of exactly size 1 from the
  start skip `trackBatch` entirely, per the Scope section above.)
- A `trackBatch` rejection: every event in that chunk gets
  `recordFailure` called (verify via subsequent `peekReady`/backoff
  state matching what issue 002's engine would do for each individually).
- `batch.intervalMs` wait-check: a group with fewer than `batch.size`
  ready entries, where the oldest has been ready less than
  `intervalMs`, is left un-batched on this tick (still individually
  drained per-entry, or skipped until enough entries accumulate —
  implementor's choice between "drain individually now" vs "wait for the
  next tick," document which was taken and why); once `intervalMs` has
  elapsed for the oldest entry, the (possibly still-partial) group is
  sent as one batch on the next tick.

## Test requirements

Both unit and integration tests are required.

**Unit tests**: batch-chunking pure logic, if implemented as a separable
pure function (e.g. `chunkForBatching(entries, batchSize, intervalMs,
now)`) — extract and unit-test it in isolation
(`src/reliability/queue.test.ts` or a new `src/reliability/batch.test.ts`,
implementor's choice) rather than only exercising it through the full
`drainQueueOnce()` integration path.

**Integration tests** (`src/index.test.ts`, extending issue 003's
`describe` block):

- Every scenario in Acceptance criteria above, using stub providers with
  and without `capabilities.batch`/`trackBatch`.

## Out of scope

- Modifying any real `packages/provider-*` adapter to implement
  `trackBatch`.
- Per-event success/failure reporting within a batch.
- A second, independent batch-accumulation timer distinct from the drain
  tick.
