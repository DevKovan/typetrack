// Phase 12 issue 005: pure batch-chunking logic for `drainQueueOnce()`'s
// `trackBatch` coalescing (`src/index.ts`) -- extracted here so it can be
// unit-tested in isolation, independent of the full drain-loop integration
// (`src/index.test.ts`).
//
// This module knows nothing about providers, `queueEngine`, or capability
// gating -- it is handed a single provider's *already-grouped* list of ready
// entries (in drain order -- priority desc, then FIFO, exactly as
// `queue.ts`'s `peekReady()` produces) and decides how (and whether) to
// split that group into `trackBatch` chunks for this tick.
import type { PersistedQueueEntry } from "./storage";

// Decides whether `entries` (a single provider's ready group) should be
// batch-sent this tick, and if so, splits it into chunks of at most
// `batchSize` entries each (in original order).
//
// Simplification (documented per issue 005's "Design decisions" and BRIEF's
// avoid-a-second-timer constraint): rather than a genuine, separate
// accumulation window/timer, "has this group waited long enough" is
// approximated per-tick as "the oldest ready entry in the group has been
// enqueued for >= intervalMs". A group is sent this tick if *either* it
// already has `>= batchSize` entries, *or* the oldest entry has waited that
// long -- otherwise, this returns `[]` (nothing sent this tick).
//
// Implementor's choice, documented here (see the issue's Acceptance
// criteria, which explicitly allows either): when neither condition holds,
// this function returns `[]`, meaning the caller (`drainQueueOnce()`) sends
// nothing for this group this tick -- it does **not** fall back to draining
// the group's entries individually. Rationale: falling back to individual
// sends for an under-threshold batch-capable group would defeat the point
// of opting a provider into batching in the first place (a bursty-but-
// still-forming group would otherwise almost always end up drained one at a
// time, since the very first ready tick after a single enqueue is rarely
// already `>= batchSize`). The entries are simply left ready for the next
// drain tick (still governed by each entry's own `nextAttemptAt` backoff --
// this function is never the reason an entry's backoff is bypassed), where
// the same check runs again; once either condition is met, the whole
// (possibly still-partial) group is chunked and sent.
//
// A group of size 0 or 1 is never expected to reach this function (the
// caller only invokes it for a batch-capable provider whose ready group has
// size `>= 2`, per the issue's Scope), but this function makes no
// assumption about that -- it's pure, general chunking logic that behaves
// sensibly for any input size.
export function chunkForBatching(
  entries: PersistedQueueEntry[],
  batchSize: number,
  intervalMs: number,
  now: number,
): PersistedQueueEntry[][] {
  if (entries.length === 0) return [];

  const hasFullBatch = entries.length >= batchSize;

  if (!hasFullBatch) {
    let oldestEnqueuedAt = entries[0]!.enqueuedAt;
    for (const entry of entries) {
      if (entry.enqueuedAt < oldestEnqueuedAt) {
        oldestEnqueuedAt = entry.enqueuedAt;
      }
    }
    const oldEnough = now - oldestEnqueuedAt >= intervalMs;
    if (!oldEnough) {
      return [];
    }
  }

  const chunks: PersistedQueueEntry[][] = [];
  for (let i = 0; i < entries.length; i += batchSize) {
    chunks.push(entries.slice(i, i + batchSize));
  }
  return chunks;
}
