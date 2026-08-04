# 006 — Flush-on-unload: `sendBeacon`-based teardown flush

## Context

Depends on issue 003 (the queue/drain machinery this issue triggers on
page unload) but is otherwise independent of issues 004/005. Read
`src/context.ts`'s `isBrowserEnvironment()` and its browser-global-access
conventions before starting. This issue is the ROADMAP's "`sendBeacon`"
and "flush-on-unload" lines: when the user is navigating away from/closing
the page, a normal `fetch()`-based flush may be cancelled mid-flight by
the browser — `navigator.sendBeacon` is the browser API specifically
designed to survive that (a fire-and-forget POST guaranteed to be
attempted even during unload).

Note this issue is about typetrack's **own reliability-queue flush**
during unload, not about changing how any `AnalyticsProvider.track()` call
is transported in general (an individual provider adapter's own transport
choice — `fetch`, an SDK's internal beacon, etc — is that adapter's
business, untouched by this issue).

## Scope of this issue

- `ReliabilityOptions.flushOnUnload?: boolean` (already typed in issue
  003; this issue is what actually consumes it), default `true` whenever
  `reliability` is enabled at all (including the `reliability: true`
  shorthand) — an app opting into reliability almost always wants
  best-effort delivery on unload too; set `flushOnUnload: false`
  explicitly to opt out.
- In a browser environment, when `reliability` is enabled and
  `flushOnUnload` resolves `true`: register a `pagehide` listener (not
  `beforeunload`/`unload`, which are unreliable and increasingly
  restricted by browsers, especially for bfcache — `pagehide` is the
  current best-practice event for this) that:
  1. Reads every currently-ready-or-not queued entry (bypass the
     `nextAttemptAt` backoff filter, same as `flush()`'s existing
     bypass-backoff behavior from issue 003 — an unload is the last
     chance to deliver, backoff scheduling is irrelevant).
  2. For each entry, attempts delivery via `navigator.sendBeacon(url,
     body)` **if and only if** the live provider (looked up by
     `entry.providerName`, same as the drain loop) exposes a way to
     produce a beacon-compatible URL+body — see the capability decision
     below — falling back to a synchronous-as-possible best-effort
     `fetch(..., { keepalive: true })` (not awaited; unload handlers
     cannot reliably await anything) when the provider doesn't support
     beacon delivery.
  3. Does **not** attempt `recordSuccess`/`recordFailure` bookkeeping for
     these attempts (there is no reliable way to know if a beacon actually
     delivered, and the page is being torn down regardless — the queue's
     persisted state in storage already reflects these entries; if the
     beacon succeeds, the events are delivered but redundantly remain
     queued for one more retry on the *next* page load, which will
     simply succeed immediately and call `recordSuccess` then — a
     harmless at-least-once delivery characteristic, document this
     explicitly as an accepted tradeoff rather than engineering exactly-
     once semantics here).
- Provider beacon-capability decision: rather than requiring every
  provider adapter to implement a new "give me a beacon URL+body" method
  (a real API surface change to `AnalyticsProvider` this phase does not
  take on, given it would need per-adapter work in `packages/provider-*`
  that BRIEF.md's "Out of scope" already excludes), this issue's
  `sendBeacon` usage targets **typetrack's own dev-server mirror only**
  (the existing opt-in `devServer` POST from Phase 3/6) — when `devServer`
  is also configured, the unload flush uses `navigator.sendBeacon` for
  that mirror POST specifically, since typetrack already fully controls
  that URL+body shape. For actual configured `AnalyticsProvider`s, the
  unload flush's "best effort" is exactly issue 003's `drainQueueOnce()`-
  style direct call to `provider.track/page/screen(event)` (whatever
  transport that provider's own implementation uses internally) —
  attempted without awaiting completion (fire-and-forget, matching
  `pagehide`'s constraints), not routed through `sendBeacon` at the
  typetrack level. Document this scoping precisely in code comments: the
  ROADMAP's "`sendBeacon`" line is satisfied for the dev-server mirror
  path; provider adapters get "best-effort fire-and-forget on unload,"
  which is the meaningful reliability improvement for them (avoiding the
  queue being wiped by a cancelled async call), even without literal
  `sendBeacon` usage.
- `destroy()` also removes this `pagehide` listener (alongside issue
  003's timer/`online`-listener cleanup).

## Design decisions made in this issue

- **`pagehide`, not `beforeunload`/`unload`.** `beforeunload` blocks
  bfcache eligibility (actively harmful to page-load performance for the
  *next* visit) and `unload` is deprecated/unreliable across modern
  browsers; `pagehide` is the current recommended event for "do a final
  best-effort action as the page goes away" and does not defeat bfcache
  when no listener side effects require it to (this issue's listener
  itself doesn't call anything that would prevent bfcache eligibility,
  since it's fire-and-forget with no blocking work).
- **True `sendBeacon` calls are scoped to the dev-server mirror**, not
  every configured provider — see the Scope section's rationale.
  Retrofitting a `sendBeacon`-compatible URL+body contract onto
  `AnalyticsProvider` (and every existing adapter) is real, adapter-facing
  scope this phase does not take on; the queue/pagehide-flush combination
  already delivers this phase's actual reliability value (surviving a
  brief offline gap, retrying a transient failure) without that.
- **No success/failure bookkeeping from the unload attempt itself** — see
  Scope point 3's rationale; correctness under this design degrades
  gracefully to "occasionally send a duplicate event on the next page
  load," never to silent data loss beyond what was already unrecoverable
  (a beacon that genuinely fails to deliver leaves the entry queued,
  exactly as if nothing had been attempted).

## Acceptance criteria

- `reliability: true` (default `flushOnUnload: true`), `devServer` also
  configured, a `pagehide` event (simulated in tests) fires with queued
  entries present: `navigator.sendBeacon` (stubbed) is called with the
  dev-server mirror URL and a serialized body for each queued entry.
- `reliability: { flushOnUnload: false }`: `pagehide` listener is never
  registered (verify via a spy on `addEventListener`/an explicit
  "listener count" check, implementor's choice) — no unload-time
  behavior at all.
- `reliability` omitted entirely: no `pagehide` listener registered,
  byte-for-byte pre-Phase-12 behavior (regression-tested).
- With one or more configured `AnalyticsProvider`s (no `devServer`): a
  simulated `pagehide` with queued entries triggers a fire-and-forget
  `provider.track/page/screen(event)` call per queued entry (verify via a
  spy provider — call happens, but the `pagehide` handler itself does not
  await/block on its resolution).
- `destroy()` removes the `pagehide` listener (verify no further
  unload-time calls occur after `destroy()`, by simulating `pagehide`
  post-destroy and confirming zero additional calls).
- Outside a browser environment: no `pagehide` registration attempted, no
  throw.

## Test requirements

**Unit tests**: none new — no standalone pure logic; covered by
integration tests below.

**Integration tests** (`src/index.test.ts`, extending issue 003's
`describe` block):

- Every scenario in Acceptance criteria above, using the exact
  `window`/`navigator`/event-dispatch stubbing convention already
  established in `src/context.test.ts` and later plugin tests (simulate
  `pagehide` by invoking the registered listener directly, or by
  dispatching a real `Event("pagehide")` against the stubbed
  `window` — implementor's choice, whichever is more consistent with
  how other phases' unload/visibility-driven tests were written; check
  `src/plugins/autoVisibility.test.ts` if it exists for precedent).

## Out of scope

- A `sendBeacon`-compatible URL+body contract added to
  `AnalyticsProvider` itself, or any `packages/provider-*` adapter
  change.
- Exactly-once delivery guarantees for the unload path.
- `beforeunload`/`unload` event support.
