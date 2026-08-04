# 004 — `priority` option threading: `TrackOptions.priority` → queue ordering

## Context

Depends on issue 002 (the queue engine already accepts/orders by a
numeric `priority` field) and issue 003 (the wiring that currently
hardcodes `priority: 0` on every `enqueue()` call — this issue replaces
that hardcoded value with a real, caller-supplied one). Read
`src/schema.ts`'s `TrackOptions` and `src/index.ts`'s `page`/`screen`
signatures (both already accept a `TrackOptions`-typed trailing options
argument) before starting.

## Scope of this issue

- Add `priority?: number` to `TrackOptions` in `src/schema.ts`, default
  `0` when omitted. Document: higher values are drained first (ties
  broken oldest-first, per issue 002's `peekReady` ordering); this only
  has an observable effect when `reliability` is enabled and the event
  in question actually gets queued (offline or a failed provider call) —
  for the common case (provider call succeeds immediately), `priority`
  has no effect at all, since the event never touches the queue.
- Thread the `priority` value from `track()`'s/`page()`'s/`screen()`'s
  `options` argument through to issue 003's `queueEngine.enqueue(...)`
  call sites, replacing the hardcoded `priority: 0` (which remains the
  correct fallback when the caller didn't pass one).

## Design decisions made in this issue

- **A single flat numeric field, no named priority levels (`"low"` /
  `"high"` etc).** Matches Phase 11's "freeform, not an enum" preference
  for extensibility (an app can establish its own convention, e.g. "10
  for purchase events, 0 for page views") without typetrack imposing a
  fixed vocabulary — consistent with how `ConsentCategory` was
  deliberately left freeform rather than a fixed union.
- **No default-priority-by-event-name mechanism** (e.g. an app-wide
  config mapping event names to priorities) — every call site sets its
  own `priority` explicitly via `TrackOptions`, or accepts the `0`
  default. A mapping-based convenience layer is real, separate,
  reasonably-deferrable scope an app can trivially build itself (a small
  wrapper function around `track()`).

## Acceptance criteria

- `TrackOptions.priority?: number`, default `0`, documented.
- `track("Event", payload, { priority: 5 })` with `reliability` enabled
  and the provider offline: the resulting queue entry has `priority: 5`
  (verify via `analytics.queue`'s internal state or an observable
  drain-order effect — implementor's choice of how to assert this without
  reaching into private engine internals from the test).
- Two queued events with different `priority` values, both offline, then
  brought back online: the higher-priority one's provider call happens
  first during drain (verify via a stub provider that records call
  order).
- `page()`/`screen()` also accept and thread `priority` through
  identically to `track()`.
- No `priority` passed: defaults to `0`, byte-for-byte matching issue
  003's pre-this-issue hardcoded behavior (regression-tested).

## Test requirements

**Unit tests**: none new — no standalone pure logic beyond threading a
value through; covered by integration tests below (issue 002's own
priority-ordering unit tests already cover the engine's sorting logic in
isolation).

**Integration tests** (`src/index.test.ts`, extending issue 003's
`describe` block):

- The priority-threading and drain-order scenarios above, for `track`,
  `page`, and `screen`.

## Out of scope

- Priority for `identify`/`group`/`alias` — out of scope for the whole
  phase (no `CanonicalEvent`/queue entry exists for these verbs at all).
- Any named-level priority vocabulary or per-event-name default mapping.
