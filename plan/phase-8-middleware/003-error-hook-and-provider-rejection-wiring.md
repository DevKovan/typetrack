# 003 — `onError` invocation wiring (`src/index.ts`)

## Context

Depends on issue 002 (middleware chain fully wired into `track`/`page`/
`screen`, `before`/`after` running at the right points, but with
`before`/`after` throws left as unhandled propagation, and no `onError`
invocation for provider-dispatch rejections). This issue closes both
gaps per the phase's locked `onError` design.

Locked design this issue implements:

- `onError(error, event, ctx)` fires for **two** distinct situations,
  both surfaced through the same signature with a `ctx.source`
  discriminant:
  1. A middleware's own `before()` or `after()` throwing synchronously,
     or its returned promise rejecting → `ctx = { source: "middleware" }`
     (no `providerName`).
  2. A provider's dispatch rejecting during the existing
     `dispatchToProviders` fan-out, or the single-provider (non-multi)
     fast path's direct `entry.provider.track/page/screen(...)` call
     throwing/rejecting → `ctx = { source: "provider", providerName:
     <failing provider's .name> }`.
- **Which middlewares get notified**:
  - Middleware-throw case: every middleware whose `before()` actually ran
    for this event gets `onError` called — this includes the middleware
    that threw itself (it gets `onError` for its own failure) and every
    middleware *before* it in registration order (their `before()` did
    run). Middlewares *after* the throwing one in registration order
    never ran their `before()` (the chain stopped), so they do **not**
    receive `onError` for this failure.
  - Provider-rejection case: dispatch only happens after a successful
    (non-dropped) `before` chain, meaning **every** registered middleware
    ran its `before()` — so every registered middleware receives
    `onError` for a provider-dispatch failure, once per failing provider
    (i.e. if 2 providers in a fan-out both reject, every middleware's
    `onError` is called twice, once per failing provider, each with that
    provider's own `providerName`).
  - An `after()`-throw case (an already-successfully-dispatched event
    whose `after()` phase then throws for some middleware): treat
    identically to the `before()`-throw case — every middleware up to
    and including the throwing one (in registration order) gets
    `onError` with `source: "middleware"`; middlewares after it in
    registration order still have their `after()` skipped for this call
    (mirrors `before`'s short-circuit — a thrown `after()` stops the
    `after` chain the same way a dropped `before()` stops the `before`
    chain), but note this is a *different* code path from a `before()`
    drop (`after` throwing isn't a "drop", the event already dispatched
    — `onError` fires here specifically because it's a genuine failure,
    not a a deliberate drop).
- **Swallow policy**: `onError` handlers never propagate. If calling a
  middleware's `onError` itself throws, `console.warn` and continue to
  the next middleware's `onError` call — do not let a broken `onError`
  handler crash `track()`/`page()`/`screen()`, and do not let one
  middleware's broken `onError` prevent other middlewares from receiving
  their own `onError` call for the same failure. This mirrors the
  existing swallow-and-warn policy already used in `dispatchToProviders`
  for provider-call rejections.
- **Existing `console.warn` reporting stays**: `dispatchToProviders`'s
  existing per-provider-rejection `console.warn` (mentioning provider
  name, verb, and rejection reason) is unchanged and still fires
  independently of whether any middleware has an `onError` — `onError`
  is additive, not a replacement for the existing warning.
- After all this, the original `before()`-drop contract from issue 002 is
  unaffected: a drop is not an error, `onError` is never called for a
  drop, and no middleware's `after()` runs for a dropped event (issue
  002's contract, unchanged here).

## Design decisions made in this issue (narrow implementation gaps)

- **How the middleware-throw path is detected without duplicating
  `runBeforeChain`/`runAfterChain`'s logic**: the recommended approach is
  to have `src/index.ts`'s call site wrap `runBeforeChain`/
  `runAfterChain` in a `try/catch`, using `BeforeChainResult
  .ranMiddlewares` (issue 001) to know which middlewares to notify on
  catch. If `runAfterChain` needs an analogous "which middlewares already
  ran their `after()`" tracking to support the identical short-circuit
  contract, extend `runAfterChain`'s return type in this issue (small,
  additive change to issue 001's module — acceptable since issue 001 is
  presumably still in-flight or freshly landed; do not treat issue 001's
  file as frozen if a small, clearly-justified extension is needed here).
- **Provider-rejection detection for the single-provider fast path**:
  today's fast path calls `entry.provider.track/page/screen(event)`
  directly without going through `dispatchToProviders`'s
  `Promise.allSettled` wrapping — this issue must wrap that direct call
  (e.g. in a `try/catch`/`.catch()`) specifically to detect the failure
  and invoke `onError` with `source: "provider", providerName:
  entry.provider.name`, then continue exactly as `dispatchToProviders`
  does today for the multi-provider case (swallow, `console.warn`,
  verb resolves normally) — do not change the single-provider fast
  path's other zero-overhead properties (no routing evaluation, no
  capability gating change) beyond adding this failure-detection wrap.
- **Ordering of `onError` calls vs. `console.warn`**: not prescribed
  exactly — either order is acceptable as long as both happen for every
  provider failure. State your choice.

## Acceptance criteria

- A middleware whose `before()` throws: `onError` is called on it and
  every middleware before it in registration order, with `source:
  "middleware"`, no `providerName`; middlewares after it never had their
  `before()` run and do not receive `onError`; `track()`/`page()`/
  `screen()` resolves normally (does not throw/reject to the caller) —
  the provider is never dispatched to (same as a drop, but this is a
  distinct "error" outcome, not a "drop" outcome, in that `onError`
  fired).
- A middleware whose `after()` throws: `onError` is called on it and
  every middleware before it (registration order) with `source:
  "middleware"`; the provider(s) were still dispatched to (dispatch
  already happened before `after` runs); `track()`/`page()`/`screen()`
  resolves normally.
- A single-provider (non-multi) config where the provider's `.track()`
  throws/rejects: every registered middleware's `onError` is called once
  with `source: "provider", providerName: <that provider's name>`;
  `console.warn` still fires (existing behavior preserved); `track()`
  resolves normally.
- A multi-provider config where 2 of 3 providers reject: every registered
  middleware's `onError` is called twice (once per failing provider),
  each with the correct `providerName`; the third (succeeding) provider
  does not trigger any `onError` call; `console.warn` fires twice
  (existing per-rejection behavior preserved); `after()` still runs for
  every middleware once, with the final event, after all 3 providers
  have settled.
- A middleware's `onError` handler itself throwing: caught and
  `console.warn`'d, does not propagate, and does not prevent other
  middlewares' `onError` from being called for the same failure.
- No `onError` call ever occurs for a clean `before()`-drop (issue 002's
  contract unaffected).

## Test requirements

Both unit and integration tests are required.

**Unit tests** (extend `src/middleware.test.ts` and/or
`src/index.middleware.test.ts`):

- `before()`-throw → correct `onError` fan-out (which middlewares, what
  `ctx`).
- `after()`-throw → correct `onError` fan-out, provider still dispatched.
- Single-provider dispatch failure → `onError` with `source: "provider"`
  on every middleware, `console.warn` still fires.
- Multi-provider partial failure → `onError` called once per failing
  provider per middleware, with correct `providerName` each time;
  succeeding provider triggers no `onError`.
- Broken `onError` handler (itself throws) → swallowed, warned, other
  middlewares' `onError` still invoked.
- Drop via `before()` returning `undefined`/`null` → `onError` never
  called (regression check against issue 002's contract).

**Integration tests**
(`src/index.middleware.error.integration.test.ts`): construct
`createAnalytics({ provider: [...] })` with a realistic mix of providers
(some rejecting, some succeeding) and middlewares (some with `onError`,
one whose `before()` throws under a specific condition), drive a
realistic sequence of calls, and assert the full per-middleware
`onError`-received log (error, event, ctx) matches hand-computed expected
outcomes across the whole sequence.

## Out of scope

- Built-in middleware implementations — issue 004+.
- `examples/middleware/` — last issue.
- Any change to `dispatchToProviders`'s/`settleAll`'s existing
  `console.warn`/`AggregateError` contracts for `flush`/`destroy` — those
  verbs are entirely outside middleware's scope, unchanged by this issue.
