# 003 — Wire `reliability` into `createAnalytics()`: offline detection, failure-path enqueue, drain loop, `analytics.queue`

## Context

Depends on issue 001 (storage adapters) and issue 002 (queue engine).
This is the large wiring issue (the Phase 12 analog of Phase 11 issue
002): construction-time queue instance, offline detection, integrating
the queue into the existing provider-failure path
(`callSingleProvider`/`dispatchToProviders` in `src/index.ts`), a
background drain loop, and the `analytics.queue` controller surface.

Read `src/index.ts`'s `callSingleProvider`, `dispatchToProviders`, and
`settleAll` in full before starting — this issue changes the failure
branch of the first two (not `settleAll`, which is only used by
`flush`/`destroy`'s own provider-teardown calls, unrelated to this
queue). Read the `track()`/`page()`/`screen()` implementations in full to
find the exact call sites of `callSingleProvider`/`dispatchToProviders`
you need to route through the offline check first.

## Scope of this issue

- Add `reliability?: boolean | ReliabilityOptions` to
  `CreateAnalyticsOptions<Events>`, mirroring the existing `devServer?:
  boolean | { url? }` shorthand-or-object shape. `ReliabilityOptions`:
  ```ts
  interface ReliabilityOptions {
    storage?: "auto" | "indexeddb" | "localstorage" | "memory";
    maxQueueSize?: number;
    maxAttempts?: number;
    backoff?: BackoffOptions;
    batch?: { size?: number; intervalMs?: number };
    flushOnUnload?: boolean;
  }
  ```
  `true` ⇒ every field takes its documented default (`storage: "auto"`,
  `maxQueueSize: 100`, `maxAttempts: 5`, `backoff` per issue 002's
  defaults, `batch: { size: 10, intervalMs: 5000 }` — consumed by issue
  005, not this issue — and `flushOnUnload: true` — consumed by issue
  006, not this issue). Omitted entirely (`undefined`) ⇒ no `QueueEngine`
  is constructed at all; `analytics.queue` still exists per design
  decision 7 but is permanently empty/no-op (see below).
- Construction-time setup (only when `reliability` is truthy):
  - Resolve the storage adapter: `options.reliability.storage` (if an
    object was passed and set to something other than `"auto"`) selects
    `createIndexedDbStorageAdapter`/`createLocalStorageAdapter`/
    `createMemoryStorageAdapter` directly; `"auto"`/default calls
    `detectBestStorage(...)`. Use a stable per-instance name prefix for
    the storage key/DB name — implementor's choice of a reasonable
    scheme (e.g. derived from a random suffix generated once at
    construction, since nothing in `CreateAnalyticsOptions` today
    provides an app-supplied stable identifier for the `Analytics`
    instance) — document whichever is chosen and why.
  - `const queueEngine = createQueueEngine({ storage, maxQueueSize,
    maxAttempts, backoff, onDeadLetter })`, where `onDeadLetter` invokes
    `notifyOnError(middlewares, reason, deadLetteredEvent, { source:
    "provider", providerName })` (reuse the exact existing
    `notifyOnError` helper `callSingleProvider` already calls, so a
    dead-lettered event surfaces through the same middleware `onError`
    channel a same-tick failure would have, just later).
  - `await queueEngine.hydrate()` — this issue makes `createAnalytics()`
    itself `async`? **No** — `createAnalytics()` must remain synchronous
    per every prior phase's contract (nothing today awaits it). Instead:
    kick off `hydrate()` fire-and-forget at construction
    (`void queueEngine.hydrate()`), and have the drain loop's first tick
    naturally pick up whatever hydration completed by then — document
    this explicitly as a deliberate "queue may not reflect prior-session
    persisted entries for the first few hundred milliseconds after
    construction" tradeoff, not a bug, in both the option's doc comment
    and this issue's own comments.
- Offline detection helper: `function isOffline(): boolean { return
  isBrowserEnvironment() && navigator.onLine === false; }` (outside a
  browser environment, or when `navigator.onLine` is unavailable/`true`,
  never considered offline — matches Phase 11's
  `detectBrowserPrivacySignal`'s "best-effort, never throws" convention;
  wrap the `navigator.onLine` read in the same try/catch-returns-false
  pattern).
- Integrate into the existing failure paths:
  - In `callSingleProvider` (single-provider fast path) and
    `dispatchToProviders` (multi-provider fan-out), **before** attempting
    `call()`/`invoke(entry)` for a given `(event, entry)` pair: if
    `reliability` is enabled and `isOffline()`, skip the call entirely and
    route straight to `queueEngine.enqueue({ providerName: entry.provider
    .name, verb, event, priority })` (see issue 004 for where `priority`
    comes from) instead — do not warn on this path (being offline isn't a
    provider misconfiguration; issue 003 is silent here, by design).
  - On an actual call failure (existing `handleFailure`/rejection
    branches): if `reliability` is enabled, instead of (or in addition
    to?) the existing `console.warn` + `notifyOnError` + swallow, also
    call `queueEngine.enqueue(...)` for that `(event, entry)` pair. Keep
    the existing `console.warn` (still useful signal that a failure just
    happened) but suppress the immediate `notifyOnError` call in this
    case — defer it to `onDeadLetter` (only notify middleware once the
    queue engine gives up, not on every individual retry attempt, to
    avoid flooding `onError` handlers with per-attempt noise for an event
    that ultimately succeeds on retry 2). When `reliability` is
    disabled/omitted, behavior is byte-for-byte unchanged (warn +
    immediate `notifyOnError` + swallow, exactly as pre-Phase-12).
- Background drain loop (only runs when `reliability` is enabled):
  - A `setInterval`-driven tick (implementor's choice of a reasonable
    fixed interval, e.g. every 5 seconds — document the choice; this is
    independent of any individual entry's `nextAttemptAt` backoff, which
    is enforced by `peekReady`'s own filtering) that calls
    `drainQueueOnce()`: `queueEngine.peekReady(Date.now())`, then for each
    ready entry, looks up the matching live provider by
    `entry.providerName` in `normalized.entries` (BRIEF.md decision 3);
    if not found, `recordFailure` immediately with a "provider no longer
    configured" reason (which will eventually dead-letter it through
    normal `maxAttempts` exhaustion — do not special-case an instant
    drop, to keep the dead-letter/warning path uniform); if found, calls
    `entry.provider[verb](event)`, awaits it, and calls
    `queueEngine.recordSuccess(id)` or `queueEngine.recordFailure(id,
    error)` accordingly.
  - Also triggered by the browser `online` event (in a browser
    environment, `window.addEventListener("online", () =>
    drainQueueOnce())`) — coming back online should not wait for the next
    timer tick.
  - `destroy()` clears the `setInterval` and removes the `online`
    listener (does **not** call `drainQueueOnce()` itself — BRIEF.md
    decision 8).
- `flush()`: before its existing per-provider `flush()` calls, if
  `reliability` is enabled, `await drainQueueOnce()` once (immediate,
  ignoring each entry's `nextAttemptAt` backoff gate — BRIEF.md decision
  8 — so `peekReady` here should be called with a very large `now`, or
  the drain-for-flush path should bypass the `nextAttemptAt` filter
  entirely; implementor's choice of mechanism, document which was taken).
- `analytics.queue: { size(): number; drain(): Promise<void>; clear():
  void }` on the `Analytics` interface, always present. `size()` returns
  `queueEngine?.size() ?? 0`. `drain()` calls `drainQueueOnce()` (or is a
  resolved no-op `Promise` if `reliability` was never enabled).
  `clear()` calls `queueEngine?.clear()` (no-op otherwise).

## Design decisions made in this issue

- **Deferred `notifyOnError` on the retry path, immediate on
  dead-letter.** Chosen specifically so an app's error-monitoring
  middleware sees "this event ultimately failed" exactly once per event,
  not once per retry attempt — a transient failure that succeeds on
  retry 2 never reaches `onError` at all, matching how a human would want
  to reason about "did tracking actually fail."
- **Fire-and-forget `hydrate()` rather than making `createAnalytics()`
  async.** Every prior phase's `createAnalytics()` is synchronous; making
  it async here would be a much larger breaking change than this phase's
  actual scope — the brief window where a freshly-constructed instance
  hasn't yet loaded its persisted queue is an accepted, documented
  tradeoff.
- **The drain-loop provider lookup is by name, live, every tick** — not a
  captured reference from enqueue time — so that if the app never
  reconstructs its `Analytics` instance (the common case), this is simply
  "look up the same provider every time," and the by-name indirection
  only matters in the documented edge case from BRIEF.md decision 3.

## Acceptance criteria

- `reliability` omitted entirely: byte-for-byte pre-Phase-12 behavior for
  every failure path (regression-tested — existing failure-path tests
  must continue passing unmodified).
- `reliability: true` (or an object), provider offline
  (`navigator.onLine` stubbed `false`): `track()`/`page()`/`screen()`
  never call the provider at all; `analytics.queue.size()` increases by
  one per call; no `console.warn` fires for the offline-skip itself.
- `reliability: true`, provider online but its `track()` rejects: the
  existing `console.warn` still fires; `notifyOnError` is **not** called
  immediately (assert via a spy middleware `onError` — zero calls right
  after the failed `track()` resolves); `analytics.queue.size()`
  increases by one.
- Simulating the background drain tick (implementor may expose a
  test-only way to trigger `drainQueueOnce()` synchronously, or simply
  advance fake timers — implementor's choice, document it) with the
  provider now succeeding: the queued entry is removed
  (`analytics.queue.size()` back to 0), `recordSuccess` path confirmed.
- Simulating repeated failures through `maxAttempts`: `onDeadLetter` /
  `notifyOnError` fires exactly once, at exhaustion, not on every
  intermediate attempt.
- `analytics.flush()` with `reliability` enabled and a queued entry whose
  `nextAttemptAt` is still in the future (backoff not yet elapsed):
  `flush()` still attempts it immediately (bypasses the backoff gate),
  confirming decision 8.
- `analytics.destroy()`: stops the background timer (no further drain
  attempts occur after `destroy()`, verified by advancing time/timers
  post-destroy and confirming no additional provider calls) without
  itself draining.
- A second `Analytics` instance constructed against the same resolved
  storage location (e.g. same explicit `localStorage` key, for a
  deterministic test — implementor's choice of how to make this testable
  without relying on the internal auto-generated prefix scheme) picks up
  entries a first, now-destroyed instance had persisted — confirms
  hydration actually restores cross-instance/cross-reload state.
- `analytics.queue` is present and its three methods work as specified
  even when `reliability` was never configured (`size()` always `0`,
  `drain()`/`clear()` resolve/no-op without error).

## Test requirements

Both unit and integration tests are required.

**Unit tests**: none new beyond issues 001/002's own test files — this
issue is wiring; cover it via integration tests below.

**Integration tests** (`src/index.test.ts`, new `describe` block):

- Every scenario in Acceptance criteria above, using a stub
  `AnalyticsProvider` whose `track`/`page`/`screen` can be scripted to
  fail N times then succeed (a small controllable test double), a stubbed
  `navigator.onLine`, and either fake timers or an exposed manual-drain
  hook (per the implementor's choice documented above) to avoid tests
  that actually wait out real backoff delays.
- The cross-instance hydration scenario.

## Out of scope

- `priority` as a public per-call option (this issue's `enqueue()` calls
  pass a `priority`, but where that value comes from beyond a hardcoded
  default is issue 004's job) — for this issue, hardcode `priority: 0`
  for every enqueue call.
- Batching (`ReliabilityOptions.batch` is defined in this issue's type
  but not consumed — issue 005 wires it into the drain loop).
- `flushOnUnload` (`ReliabilityOptions.flushOnUnload` is defined in this
  issue's type but not consumed — issue 006 wires it).
- `examples/` — issue 007.
