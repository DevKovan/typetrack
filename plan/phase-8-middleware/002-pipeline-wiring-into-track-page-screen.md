# 002 — wire the middleware chain into `track()`/`page()`/`screen()` (`src/index.ts`)

## Context

Depends on issue 001 (`Middleware`, `runBeforeChain`, `runAfterChain`,
`use()` registration already landed and inert). This issue makes the
chain actually run, in the exact position locked by this phase's grill-me
interview: **once globally per call, on the single canonical event,
immediately after the event is built and BEFORE `sortByPriority`/routing/
`dispatchToProviders`** (Phase 7's fan-out machinery). Never re-run
per-provider inside the fan-out loop.

Locked design this issue implements:

- Only `track`/`page`/`screen` run through middleware — the three verbs
  that build a `CanonicalEvent`. `identify`/`group`/`alias`/`reset`/
  `flush`/`destroy` are entirely unaffected by this phase, exactly as
  Phase 7 scoped routing identically and for the same reason (no
  canonical event object exists for the other verbs).
- Per call: run `runBeforeChain(middlewares, canonicalEvent)`. If the
  result is `dropped: true`, the verb returns early —
  `sortByPriority`/`shouldRouteToProvider`/`dispatchToProviders`/the
  single-provider fast-path provider call **never happen at all** for
  that call. The verb resolves normally (`void`/`Promise<void>` per the
  existing single-vs-multi return-type contract) — no error, no throw,
  exactly as if the app itself had chosen not to call `track()`.
- If not dropped, proceed with the (possibly transformed) event exactly
  as today: single-provider fast path calls `entry.provider.track/page/
  screen(event)` directly; multi-provider path runs
  `sortByPriority`/`shouldRouteToProvider`/`dispatchToProviders` exactly
  as Phase 7 left it, using the post-`before`-chain event (routing
  predicates and provider adapters see the transformed event, never the
  pre-middleware one).
- After dispatch settles (the existing `Promise.allSettled`-based
  fan-out in `dispatchToProviders` never rejects, and the single-provider
  fast path's own call has resolved or rejected), run
  `runAfterChain(middlewares, event)` — same registration order, using
  the final post-`before`-chain event. `after()` runs regardless of
  whether individual providers failed within the fan-out (provider-level
  failures are reported via `onError`, wired in issue 003 — this issue
  can leave `after()` running unconditionally after dispatch settles;
  issue 003 layers `onError` on top without changing `after`'s trigger
  condition).
- This issue does **not** yet implement `onError` invocation for thrown
  errors from `before()`/`after()` themselves, or for provider-dispatch
  rejections — issue 003's scope. For this issue, it is acceptable
  (temporary, intermediate state) for a thrown `before()`/`after()` error
  to propagate as an unhandled rejection/synchronous throw out of
  `track()`/`page()`/`screen()`, since issue 003 immediately wraps this
  in proper `onError` handling. Do not spend effort building throwaway
  error handling here that issue 003 will replace — state plainly in
  your implementation notes / commit message that error handling is
  deferred to issue 003.
- `track()`'s existing dev-server mirror (`devServerUrl` fire-and-forget
  POST) and schema validation continue to run **before** middleware, on
  the raw/validated payload, exactly as today — middleware only sees the
  already-validated `CanonicalEvent`, never re-triggers validation.

## Design decisions made in this issue (narrow implementation gaps)

- **Where to build the canonical event relative to the chain**: exactly
  where `buildEvent()`/`track()`'s inline canonical-event construction
  already happens today — the chain runs immediately after that, before
  any routing/dispatch code. No change to `buildEvent()`'s own logic.
- **Single-provider fast path also runs middleware**: the "zero fan-out
  overhead" fast path from Phase 7 is specifically about routing/
  capability-gating/`Promise.allSettled` wrapping being skipped for a
  bare single provider — middleware runs regardless of single-vs-multi,
  since it's a pre-dispatch, pre-routing concern that applies uniformly.
- **Return type**: unchanged from Phase 7's existing contract
  (`void | Promise<void>`) — adding an `await` on the middleware chain
  before the existing provider-call logic naturally makes every one of
  `track`/`page`/`screen` return a `Promise` at runtime when middleware
  is involved; this is already covered by the interface's existing union
  type, no signature change needed. (If zero middlewares are registered,
  the implementor may special-case an early return of the un-awaited
  chain to preserve exact synchronous passthrough for the zero-middleware
  case — recommended, matches the spirit of Phase 7's single-provider
  fast path, but not a hard requirement if it complicates the code
  more than it's worth; state your choice.)

## Acceptance criteria

- `track()`, `page()`, `screen()` each: build the canonical event (as
  today) → run `runBeforeChain` → if dropped, return early (no dispatch,
  no `after`) → else dispatch (routing/fan-out exactly as Phase 7) → run
  `runAfterChain` on the final event.
- `identify()`, `group()`, `alias()`, `reset()`, `flush()`, `destroy()`
  are byte-for-byte unchanged by this issue (no middleware interaction).
- A middleware registered via `use()` that mutates `event.properties` (or
  any other field) in its `before()` results in the provider(s) receiving
  the mutated event, for both single- and multi-provider configurations.
- A middleware whose `before()` returns `undefined` (or `null`) prevents
  the provider from being called at all — assert via a provider stub's
  call count staying `0` for that specific call, while a *different*
  `track()` call without triggering the drop condition still reaches the
  provider.
- Multiple registered middlewares run in registration order, each seeing
  the previous one's transformed event (assert via order-sensitive
  transformations, e.g. appending to an array property).
- `after()` hooks run once dispatch has settled, receiving the final
  transformed event, for both single- and multi-provider configurations,
  and regardless of whether an individual provider in a multi-provider
  fan-out rejected (a rejecting provider must not prevent `after()` from
  running for any middleware).
- Zero registered middlewares: `track`/`page`/`screen` behave
  byte-for-byte as they did at the end of Phase 7 (regression check —
  run the existing Phase 6/7 test suites unmodified as a sanity check).

## Test requirements

Both unit and integration tests are required.

**Unit tests** (extend `src/index.test.ts` or add
`src/index.middleware.test.ts`):

- Single middleware mutating properties — provider receives mutated
  event (single-provider fast path).
- Single middleware mutating properties — every provider in a
  multi-provider array receives the same mutated event (deep-equal).
- Drop via `before()` returning `undefined` — provider(s) never called
  for that call; a subsequent non-dropped call still reaches them.
- Drop via `before()` returning `null` — same as above (both falsy
  sentinels behave identically).
- Multiple middlewares — registration-order transformation threading,
  asserted via an order-sensitive mutation (e.g. each middleware appends
  its `name` to `event.properties.trace: string[]`).
- `after()` fires post-dispatch with the final event, for both track/
  page/screen, single- and multi-provider.
- `after()` still fires when one provider in a multi-provider array
  rejects/throws in its `.track()`.
- Routing (`include`/`exclude`/`predicate`/`sampling` from Phase 7)
  evaluates against the **post-middleware** event, not the pre-middleware
  one — construct a middleware that changes `event.name` and a routing
  `include` that only matches the *post*-transform name, assert the
  provider receives the call.
- `identify`/`group`/`alias`/`reset`/`flush`/`destroy` are unaffected —
  registering a middleware that would drop every event has zero effect
  on these verbs (they still reach every provider as in Phase 7).

**Integration tests** (`src/index.middleware.integration.test.ts`):
construct `createAnalytics({ provider: [...] })` with 2-3 realistic
hand-written `AnalyticsProvider` stubs and 2-3 realistic-looking
middlewares (e.g. one enriching properties, one conditionally dropping
based on a property value), drive a realistic sequence of `track()`/
`page()`/`screen()` calls with varying payloads, and assert the full
per-provider received-event log matches hand-computed expected outcomes
(including which calls were dropped entirely) across the whole sequence.

## Out of scope

- `onError` invocation for middleware throws or provider-dispatch
  rejections — issue 003.
- Built-in middleware implementations — issue 004+.
- `examples/middleware/` — last issue.
