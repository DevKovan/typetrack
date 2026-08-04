# offline-resilient-tracking

Demonstrates `typetrack`'s full Phase 12 reliability surface through a single,
realistic e-commerce storefront session: the `reliability` construction
option (`storage`/`maxAttempts`/`backoff`/`batch`), the always-present
`analytics.queue` runtime, offline detection and the browser `online`
auto-drain, `TrackOptions.priority` (a checkout event jumping the queue ahead
of earlier-queued page-view events), `ProviderCapabilities.batch` +
`AnalyticsProvider.trackBatch` coalescing, `maxAttempts` dead-lettering (one
permanently-invalid event genuinely dropped, not just eventually retried
successfully), and a `pagehide`-driven unload flush -- composed the way a
real storefront would actually hit all of them in one browsing session, not
exercised one feature at a time.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/advanced/offline-resilient-tracking
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/advanced/offline-resilient-tracking/index.ts
```

## Source

`index.ts`'s `runOfflineResilientTrackingFlow()` constructs the instance with
the exact reliability configuration this phase's issues specify:

```ts
const analytics = createAnalytics({
  provider,
  reliability: {
    storage: "memory",
    maxAttempts: 3,
    backoff: { baseMs: 100, factor: 2, maxMs: 1000 },
    batch: { size: 5, intervalMs: 200 },
  },
});
```

against a hand-written `createWarehouseAnalyticsStub()` (never a real
`packages/provider-*` adapter) standing in for a vendor analytics API. That
stub has two independent, realistic failure modes: a toggleable `outageActive`
(a transient vendor-side incident every event eventually recovers from) and a
single hardcoded "poison" SKU (`TT-RETIRED-001`, a discontinued product the
vendor's ingestion API *permanently* rejects, regardless of the general
outage) -- the latter is what drives this example's `maxAttempts`
dead-letter demonstration. See `index.ts`'s own comments for the full
scenario walkthrough.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal
capture of `bun run index.ts`'s output (with one documented exception: the
dead-letter warning's stack-trace block contains this checkout's own absolute
filesystem path -- see that file's header for why), or the "Explanation"
section below for the annotated version.

## Explanation

### Steps 1-3 -- browsing during a vendor outage: nothing is lost

The stub provider starts mid-incident (`outageActive: true`). 4 low-priority
`track("Product Viewed", { sku, price }, { priority: 0 })` calls and a
high-priority `track("Checkout Started", { cartTotal, itemCount }, {
priority: 10 })` call all fail their first attempt and land in
`analytics.queue` instead of being lost -- `analytics.queue.size()` grows
from 4 to 5. A 6th event -- viewing a discontinued product (`sku:
"TT-RETIRED-001"`) -- also fails and queues at this point, indistinguishably
from the rest (it's the vendor's *general* outage causing this failure too,
for now).

### Step 4 -- recovery: priority ordering and batching in the same call

The vendor recovers (`provider.setOutage(false)`), and `analytics.flush()`
(issue 003's decision 8: an explicit `flush()` bypasses every entry's own
backoff gate) drains everything ready in one pass. `queueEngine.peekReady()`
sorts by priority first, then FIFO within a priority tier (issue 002) --
"Checkout Started" (priority 10) sorts ahead of every "Product Viewed"
(priority 0), even though it was queued *after* the first four. Because this
provider declares `capabilities.batch: true` and implements `trackBatch`
(issue 005), and the ready group has `>= 2` entries, `drainQueueOnce()`
chunks the group by `batch.size` (5) rather than calling `track()` once per
entry: the first chunk is exactly those 5 entries, *in priority order* --
one `trackBatch(["Checkout Started", "Product Viewed", "Product Viewed",
"Product Viewed", "Product Viewed"])` call demonstrates both priority
ordering (checkout first) and batching (one call, not five) simultaneously.
That chunk succeeds; none of those 5 events reappear in the queue again.

The 6th entry (the discontinued product) ends up alone in the next chunk --
still sent via `trackBatch` (chunking is driven by the *original* ready-group
size, not each chunk's own size) -- and fails again. This is no longer the
general outage (that's now resolved); it's the vendor permanently rejecting
this specific SKU's payload.

### Retrying towards `maxAttempts: 3` -- the ceiling is real

With only the discontinued-product entry left, `analytics.queue.drain()`
(backoff-respecting, issue 002) is called immediately after that failure --
its own `nextAttemptAt` backoff window hasn't elapsed yet, so this is a
no-op (queue size unchanged). `analytics.flush()` bypasses that gate on
demand and retries immediately: attempt 2 of 3 fails (still the same
permanently-invalid SKU). A third `flush()` call exhausts `maxAttempts`:
`queueEngine.recordFailure()` drops the entry for good (never retried
again) and the `onError` middleware registered via `.use()` fires exactly
once, with `ctx.source === "provider"` -- proving there's a real ceiling on
retries, not an eventually-always-succeeds assumption.

### Step 5 -- the visitor goes offline, then comes back

`navigator.onLine` is flipped to `false` mid-session, then one more
`track("Product Viewed", ...)` call is made: `callSingleProvider()`'s
offline check (issue 003) runs *before* attempting the call at all, so the
provider's `track()`/`trackBatch()` is never invoked for this event -- it's
queued directly, with zero new provider-call attempts recorded. When the
browser's `"online"` event fires, the registered `online` listener triggers
an immediate `drainQueueOnce()` on its own -- no explicit `flush()`/`queue
.drain()` call is needed for this event to be delivered.

### Step 6 -- one last event, then the page unloads

One final "Product Viewed" call queues while offline again, then a
simulated `pagehide` fires. `flushQueueOnUnload()` (issue 006) makes one
best-effort, fire-and-forget `provider.track()` call for it -- not awaited,
with no `recordSuccess`/`recordFailure` bookkeeping at all -- so
`analytics.queue.size()` is exactly the same before and after, even though a
real delivery attempt was made. `analytics.destroy()` then stops the
background drain timer and removes the `online`/`pagehide` listeners.

## Production notes

- **This example uses `storage: "memory"` for deterministic, dependency-free
  test output -- a real app should use `storage: "auto"` (or omit `storage`
  entirely, since `"auto"` is the default) instead.** `"auto"` probes
  IndexedDB, then `localStorage`, then falls back to an in-memory queue
  (`detectBestStorage()`, `src/reliability/storage.ts`) -- letting queued
  events survive a page reload/crash, which `"memory"` deliberately does not
  (this example's whole point is a fully self-contained, reproducible script
  run). Only pick an explicit backend yourself (`"indexeddb"`/
  `"localstorage"`/`"memory"`) when you have a specific reason to skip the
  probe.
- **`priority` and batching only matter once events are actually sitting in
  the queue -- neither has any effect on the happy path.** A `track()` call
  whose provider succeeds on the first attempt is delivered immediately,
  synchronously dispatched, never touching `queueEngine`/`drainQueueOnce()`
  at all -- `priority` is read only when an entry is later drained from the
  queue (`peekReady()`'s sort), and `trackBatch` coalescing only ever
  applies to entries that reached the queue in the first place. An app whose
  provider basically never fails will essentially never observe either
  behavior in practice -- they exist for the failure/backlog case, not to
  change normal delivery order or shape.
- **`flushOnUnload`'s `pagehide` delivery is at-least-once, not
  exactly-once (issue 006's documented tradeoff).** Because the fire-and-
  forget attempt made on `pagehide` has no `recordSuccess`/`recordFailure`
  bookkeeping (there's no reliable way to know it actually landed before the
  page finishes tearing down), a successful last-ditch delivery still
  leaves the entry in the persisted queue -- it's simply retried again (and
  immediately succeeds, a harmless no-op from the vendor's point of view for
  most analytics events) the next time this instance's queue is hydrated and
  drained. Don't build any true exactly-once assumption on top of this path;
  if a specific event must never be double-counted, that idempotency has to
  be handled on the ingestion side (e.g. a client-generated event id the
  vendor can dedupe on), not by this library.
- **The dead-letter ceiling (`maxAttempts`) is a deliberate design decision,
  not a missing feature.** A permanently-invalid event (a malformed payload,
  a delisted/rejected resource, etc.) would otherwise retry forever,
  indistinguishable from a genuinely transient outage, silently growing the
  persisted queue without bound. `maxAttempts` (default 5; this example uses
  3 to keep the demo short) caps that, and `onDeadLetter`/the `onError`
  middleware channel is how an app finds out an event was actually dropped,
  so it can alert/log/route to a dead-letter store of its own if it needs
  stronger guarantees than "best effort, bounded retries" for a particular
  event type.
