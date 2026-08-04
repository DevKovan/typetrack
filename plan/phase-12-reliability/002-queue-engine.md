# 002 — `src/reliability/queue.ts`: queue engine — priority ordering, backoff, eviction, dead-lettering

## Context

Depends on issue 001 (`QueueStorageAdapter`, `PersistedQueueEntry`). This
issue is the pure decision/orchestration logic of the queue — priority
ordering, exponential backoff scheduling, `maxQueueSize` eviction, and
`maxAttempts` dead-lettering — operating against an injected
`QueueStorageAdapter` (tests use issue 001's memory adapter; no real
IndexedDB/localStorage needed to test this issue). Still not wired into
`createAnalytics()` — that's issue 003.

## Scope of this issue

`src/reliability/queue.ts` exports:

- `BackoffOptions` — `{ baseMs?: number; factor?: number; maxMs?: number
  }`, defaults `{ baseMs: 1000, factor: 2, maxMs: 30000 }` applied by
  `computeBackoffDelay`, not by this type itself (mirrors Phase 11 issue
  001's "options types don't self-default, resolver functions do"
  convention).
- `computeBackoffDelay(attempts: number, options: BackoffOptions |
  undefined): number` — pure: `min(maxMs, baseMs * factor ** attempts)`,
  with defaults filled in when `options` (or individual fields) are
  absent. `attempts` is the number of prior attempts (0 for the first
  retry after an initial failure).
- `QueueEngineOptions` — `{ storage: QueueStorageAdapter; maxQueueSize?:
  number; maxAttempts?: number; backoff?: BackoffOptions; onDeadLetter?:
  (entry: PersistedQueueEntry, reason: unknown) => void }`. Defaults:
  `maxQueueSize: 100`, `maxAttempts: 5`. `onDeadLetter` is invoked (in
  addition to a `console.warn`, not instead of) whenever an entry is
  dropped after exhausting `maxAttempts` — issue 003 uses this hook to
  route the drop through the existing middleware `onError` fan-out, but
  this issue's engine itself only guarantees the callback fires, it does
  not know about middleware.
- `createQueueEngine(options: QueueEngineOptions)` returning:
  ```ts
  interface QueueEngine {
    hydrate(): Promise<void>;
    enqueue(entry: Omit<PersistedQueueEntry, "id" | "attempts" | "enqueuedAt" | "nextAttemptAt">): Promise<void>;
    peekReady(now: number): PersistedQueueEntry[];
    recordSuccess(id: string): Promise<void>;
    recordFailure(id: string, error: unknown): Promise<void>;
    size(): number;
    clear(): Promise<void>;
  }
  ```
  - `hydrate()`: loads persisted entries from `storage` into the engine's
    in-memory working set (call once, at construction time — issue 003's
    job to call it). A `storage.load()` rejection is caught and logged
    (`console.warn`), leaving the in-memory set empty rather than
    throwing — a corrupt/inaccessible storage backend must not prevent
    `createAnalytics()` from completing.
  - `enqueue(...)`: assigns a fresh `id`/`attempts: 0`/`enqueuedAt: now`/
    `nextAttemptAt: now` (immediately ready), applies the `maxQueueSize`
    eviction policy (BRIEF.md decision 6: if adding this entry would
    exceed `maxQueueSize`, first evict the lowest-priority, then oldest
    (`enqueuedAt`), existing entry — repeat until there's room, which for
    `maxQueueSize >= 1` is always exactly one eviction per over-limit
    enqueue since entries are added one at a time), then persists the
    full updated set via `storage.save()`.
  - `peekReady(now)`: returns every in-memory entry with `nextAttemptAt
    <= now`, sorted by `priority` descending, then `enqueuedAt` ascending
    (higher priority first; among equal priority, oldest first — FIFO
    within a priority tier). Read-only, does not mutate or persist.
  - `recordSuccess(id)`: removes the entry from the in-memory set and
    persists the updated set.
  - `recordFailure(id, error)`: increments `attempts` for the entry; if
    the new `attempts` count reaches `maxAttempts`, removes the entry
    from the set (dead-letter), calls `onDeadLetter?.(entry, error)`, and
    `console.warn`s (naming `entry.providerName`, `entry.event.name`, and
    `attempts`); otherwise sets `nextAttemptAt = now +
    computeBackoffDelay(attempts, options.backoff)` and leaves the entry
    in the set. Either way, persists the updated set via `storage.save()`
    at the end.
  - `size()`: current in-memory entry count (sync, no storage read).
  - `clear()`: empties the in-memory set and calls `storage.clear()`.

## Design decisions made in this issue

- **In-memory working set is the source of truth during a session;
  storage is a durability mirror, not queried live on every operation.**
  `hydrate()` reads storage once; every subsequent `enqueue`/
  `recordSuccess`/`recordFailure`/`clear()` call updates the in-memory set
  first, then calls `storage.save()`/`clear()` to mirror it — `peekReady`
  and `size()` never touch storage at all (cheap, synchronous). This is
  why `hydrate()` is a separate, explicit method rather than something
  every read implicitly triggers.
- **`peekReady` does not itself mark entries as "in flight."** It's a
  read-only snapshot; the caller (issue 003) is responsible for not
  concurrently processing the same entry twice within a single drain
  cycle (issue 003's drain loop processes one `peekReady()` batch fully —
  calling `recordSuccess`/`recordFailure` for each — before the next
  timer tick calls `peekReady()` again, so this is naturally satisfied by
  the drain loop's structure, not by anything in this engine).
- **Eviction happens on `enqueue`, not lazily during `peekReady`/drain.**
  Keeping the in-memory set (and therefore what's persisted) always
  within `maxQueueSize` at all times, rather than allowing temporary
  overflow, avoids ambiguity about what "current queue size" means to a
  caller inspecting `size()` between operations.

## Acceptance criteria

- `computeBackoffDelay(0, undefined)` returns `1000`; `computeBackoffDelay(1,
  undefined)` returns `2000`; `computeBackoffDelay(2, undefined)` returns
  `4000`; grows exponentially and is clamped at `maxMs` (default `30000`)
  for large `attempts` values (e.g. `computeBackoffDelay(10, undefined)`
  returns exactly `30000`, not an astronomically large number).
- Custom `{ baseMs: 500, factor: 3, maxMs: 5000 }` produces the expected
  sequence and clamp point.
- `enqueue()` assigns a unique `id` per call, `attempts: 0`, and
  `nextAttemptAt` equal to the `now` value passed/used at enqueue time
  (immediately eligible for the next `peekReady`).
- `maxQueueSize: 2`: enqueuing a 3rd entry evicts the lowest-priority
  existing entry; if two existing entries tie on priority, evicts the
  older (`enqueuedAt`) one; `size()` never exceeds 2 after any sequence
  of enqueues.
- `peekReady(now)` excludes entries whose `nextAttemptAt > now`, includes
  exactly those `<= now`, and orders by priority desc then `enqueuedAt`
  asc.
- `recordFailure` below `maxAttempts`: entry remains in the set with
  incremented `attempts` and a `nextAttemptAt` matching
  `computeBackoffDelay(attempts, backoff)` added to `now`; still present
  in a subsequent `peekReady` once that time has passed, absent before.
- `recordFailure` reaching `maxAttempts`: entry removed from the set,
  `onDeadLetter` called exactly once with the entry and the failure
  reason, and a `console.warn` fires.
- `recordSuccess` removes the entry; a subsequent `peekReady`/`size()`
  reflects the removal.
- `hydrate()` populates the in-memory set from a pre-seeded storage
  adapter; a `storage.load()` that throws/rejects leaves the set empty
  and logs a warning rather than propagating.
- Every mutating method (`enqueue`, `recordSuccess`, `recordFailure`,
  `clear`) calls `storage.save()`/`storage.clear()` with the correct
  resulting whole-array state (verify via a spy on the injected memory
  adapter's `save`/`clear`).

## Test requirements

Unit tests only (`src/reliability/queue.test.ts`), using issue 001's
`createMemoryStorageAdapter()` as the injected storage — no wiring exists
yet for integration tests.

- Every branch in Acceptance criteria above.
- A combined scenario: enqueue 3 entries with mixed priorities → fail one
  repeatedly until dead-lettered → succeed another → verify `peekReady`/
  `size()`/persisted storage state are consistent at each step.

## Out of scope

- Storage adapter implementations — issue 001.
- Any `createAnalytics()` wiring, drain-loop timer, offline detection,
  provider dispatch — issue 003.
- `priority` as a public per-call option — issue 004 (this issue's engine
  already accepts and orders by a numeric `priority` field; issue 004
  wires the public `TrackOptions.priority` value into what `enqueue()`
  receives).
- Batching — issue 005.
