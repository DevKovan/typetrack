# 007 — `examples/advanced/`

## Context

Depends on issues 001-006 (full reliability surface implemented and
passing QA: `reliability` option + `analytics.queue`, offline
detection/queueing, retry/backoff, `priority`, batching, flush-on-unload).
Per `plan/VISION.md`'s Examples policy — every feature ships its
`examples/` entries in the same phase that built it — this closes out
Phase 12. `examples/advanced/` is the exact directory name the ROADMAP's
Phase 12 line specifies.

Read `examples/recipes/README.md` (Phase 11) and `examples/middleware/
README.md` (Phase 8) in full first for the established structure/tone,
and reuse the same "simulate a real page via stubbed globals" technique
already established by `src/context.test.ts` and every subsequent
plugin/phase's examples.

## Scope of this issue

One new subdirectory, `examples/advanced/offline-resilient-tracking/`,
plus an `examples/advanced/README.md` index (mirroring the established
index structure). Per the "two composed recipes, not many toy
directories" precedent Phase 11 issue 008 set, and given this phase's
features (offline queue, retry/backoff, priority, batching, flush-on-
unload) are all facets of one coherent reliability story rather than
independently useful features an app would reach for separately, **one**
composed example is appropriate here (documented explicitly in the
README as the reason there's only one, so a future reader doesn't wonder
if more were meant to follow).

### `examples/advanced/offline-resilient-tracking/`

A realistic e-commerce app flow demonstrating the full reliability
surface end-to-end. Composes: `reliability` options (`storage: "memory"`
for deterministic testing — document that a real app would typically use
`"auto"` and let the fallback chain pick IndexedDB/localStorage), a stub
provider scripted to fail intermittently, `priority` (checkout/purchase
events marked high-priority vs. low-priority page-view events),
`ProviderCapabilities.batch`/`trackBatch` on the stub provider, and a
simulated `pagehide` at the end. Flow:

1. Construct `createAnalytics({ provider: flakyStub, reliability: {
   storage: "memory", maxAttempts: 3, backoff: { baseMs: 100, factor: 2,
   maxMs: 1000 }, batch: { size: 5, intervalMs: 200 } } })`, where
   `flakyStub` is a hand-written provider whose `track`/`trackBatch`
   rejects for the first N calls (simulating a flaky network) then
   succeeds, and implements `capabilities.batch: true` +
   `trackBatch`.
2. Simulate a visitor browsing: fire several realistic low-priority
   `track("Product Viewed", { sku }, { priority: 0 })` calls while the
   stub provider is failing — show they land in `analytics.queue`
   (`analytics.queue.size()` growing), not lost.
3. Fire a high-priority `track("Checkout Started", { cartTotal }, {
   priority: 10 })` call, also failing initially — show that once the
   provider recovers and the queue drains, the checkout event is sent
   before the earlier-queued product-view events (priority ordering).
4. Simulate the provider recovering (stub flips to succeeding) and
   trigger a drain (via whatever test/manual-drain hook issue 003
   exposed, or `analytics.flush()`) — show multiple ready product-view
   events for the batch-capable provider get sent via one `trackBatch`
   call rather than N individual calls, while the (already-sent, since
   consumed on 3.) checkout event doesn't reappear.
5. Simulate the visitor going offline (`navigator.onLine = false`) mid-
   session, firing one more `track("Product Viewed", ...)` — show it's
   queued directly (no failed-call attempt logged) — then simulate an
   `online` event firing and the queue draining automatically without an
   explicit `flush()` call.
6. Simulate a `pagehide` at the end with one final unsent event still
   queued — show the fire-and-forget unload attempt happens (verify via
   the stub provider recording the call), then call `analytics.destroy()`.

## Acceptance criteria

- `examples/advanced/README.md` exists, follows the established index
  structure, links the one subdirectory, and explicitly explains why
  there's only one example in this directory (per Scope above).
- `examples/advanced/offline-resilient-tracking/` follows the established
  example shape: `package.json` (`file:../../..` dependency), `index.ts`
  (exported flow function), an integration test running the real flow
  end-to-end against the hand-written flaky/batch-capable stub provider,
  a unit test only if the example defines non-trivial pure logic of its
  own (state explicitly if omitted and why), `expected-output.txt`, and a
  `README.md` with Prerequisites/How to run/Source/Expected
  output/Explanation/Production notes sections.
- Every feature from issues 001-006 is exercised: offline detection,
  retry/backoff, `maxAttempts`/dead-letter is at least mentioned/shown
  (e.g. one event genuinely exhausting attempts and being dropped, to
  demonstrate the ceiling exists, not just the happy-eventually-succeeds
  path), priority ordering, batching, flush-on-unload.
- Realistic event/property names only (`"Product Viewed"`, `"Checkout
  Started"`, etc.) — no `test`/`foo`/`bar` placeholders.
- The README's Production notes section covers: the `storage: "auto"`
  recommendation for real apps (vs. this example's deterministic
  `"memory"` choice), that batching/priority only matter once events are
  actually queued (not on the happy path), and the at-least-once
  (not exactly-once) delivery characteristic of the flush-on-unload path
  per issue 006's documented tradeoff.

## Test requirements

- Integration test required — run the real flow, assert the stub
  provider's recorded calls (individual vs. batch, order, count) and
  `analytics.queue.size()` at each step match hand-computed expectations,
  including the dead-letter/exhaustion demonstration.
- A unit test is required only where non-trivial pure logic exists inside
  the example's own code — do not manufacture one otherwise.

## Out of scope

- Any change to `src/` or `packages/*` — this issue is examples-only.
- Live vendor infrastructure — the provider is a hand-written stub.
- IndexedDB/localStorage-backed determinism in the example itself (uses
  `storage: "memory"` for reproducibility, as noted above).
