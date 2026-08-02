# 001 — `Middleware` type, `src/middleware.ts` chain runner, and `.use()` registration

## Context

New `src/middleware.ts` module — the Phase 8 analog of `src/routing.ts` for
Phase 7: a dedicated, standalone module for this phase's own vocabulary.
Depends on Phase 6's `CanonicalEvent` (`src/schema.ts`); does not touch
`src/index.ts`'s runtime wiring yet — that's issue 002. This issue is
purely additive and pure-functional except for the `Analytics.use()`
interface addition itself (a type-only change to `src/index.ts`'s
`Analytics<Events>` interface — no behavior change to any verb yet).

This issue implements the locked design from this phase's grill-me
interview exactly — do not relitigate:

- Middleware is an **object**, not a bare function:

```ts
export interface Middleware {
  name: string;
  before?(event: CanonicalEvent): CanonicalEvent | null | undefined | Promise<CanonicalEvent | null | undefined>;
  after?(event: CanonicalEvent): void | Promise<void>;
  onError?(
    error: unknown,
    event: CanonicalEvent,
    ctx: { source: "middleware" | "provider"; providerName?: string },
  ): void | Promise<void>;
}
```

- Execution model is **linear**, not onion/wrap: every registered
  middleware's `before()` runs in registration order, threading the
  (possibly transformed) event through each in turn; every registered
  middleware's `after()` later runs in the **same** registration order
  (not reversed).
- `name` is informational only (error messages/debugging) — **no dedup by
  name required**. Multiple `use()` calls accumulate in an ordered list.
  If you find a concrete correctness reason mid-implementation to dedup,
  do not decide it silently — leave a comment flagging it as an open
  question for a future issue instead of changing this contract.

## Scope of this issue

This issue owns the **pure chain-running logic** and the **registration
API surface**, not the wiring into `track`/`page`/`screen` (issue 002) and
not the error-hook/provider-rejection semantics beyond what's needed to
define the function signatures (issue 003 owns the actual `onError`
invocation wiring against `dispatchToProviders`/`settleAll`).

`src/middleware.ts` exports:

```ts
export interface Middleware {
  name: string;
  before?(event: CanonicalEvent): CanonicalEvent | null | undefined | Promise<CanonicalEvent | null | undefined>;
  after?(event: CanonicalEvent): void | Promise<void>;
  onError?(
    error: unknown,
    event: CanonicalEvent,
    ctx: { source: "middleware" | "provider"; providerName?: string },
  ): void | Promise<void>;
}

// Result of running every registered middleware's `before()` in order.
// `dropped: true` means some middleware's `before()` returned
// `null`/`undefined` (or the chain never started because `middlewares` is
// empty and there's nothing to drop -- that case is `dropped: false`,
// `event` unchanged); `ranMiddlewares` is the list of middlewares whose
// `before()` actually executed for this call, in registration order (used
// by issue 003 to know which middlewares' `onError`/`after` to invoke).
export interface BeforeChainResult {
  event: CanonicalEvent;
  dropped: boolean;
  ranMiddlewares: Middleware[];
}

// Runs `before()` for each middleware in `middlewares` (registration
// order), threading the event through each. Stops immediately (does not
// call later `before()`s) the first time a `before()` returns
// `null`/`undefined`. Does NOT catch errors thrown by `before()` --
// letting them propagate is deliberate; issue 003's caller in
// `src/index.ts` wraps this call and handles `onError` dispatch, since
// only `src/index.ts` has access to `dispatchToProviders`'s existing
// swallow-and-warn conventions and knows which middlewares already ran
// (from a partial `BeforeChainResult` reconstructed on catch, or by
// wrapping per-middleware -- implementor's call, document whichever
// shape you pick).
export async function runBeforeChain(
  middlewares: Middleware[],
  event: CanonicalEvent,
): Promise<BeforeChainResult>;

// Runs `after()` for each middleware in `middlewares` (registration
// order, NOT reversed), passing `event`. Like `runBeforeChain`, does not
// catch errors -- propagates them to the caller (issue 003) for
// `onError` handling.
export async function runAfterChain(
  middlewares: Middleware[],
  event: CanonicalEvent,
): Promise<void>;
```

Also update `src/index.ts`:

- Add `use(middleware: Middleware): void` to the `Analytics<Events>`
  interface (after `destroy()`, matching the interface's existing
  ordering-by-recency-of-phase convention).
- Re-export `Middleware` as a type from the public barrel: `export type {
  Middleware } from "./middleware";` (alongside the existing
  `CanonicalEvent`/`ProviderEntry`/etc. re-exports).
- Implement `use()` in `createAnalytics()`: push onto a local
  closure-scoped `const middlewares: Middleware[] = []` array (declared
  alongside the existing `warnedCapabilities`/identity-state closure
  variables), simply `middlewares.push(middleware)`. **Do not wire this
  array into `track`/`page`/`screen` yet** — that is issue 002's entire
  scope. After this issue, `middlewares` is populated but inert (dead
  code from the compiler's perspective is fine; it will be consumed next
  issue).

## Design decisions made in this issue (narrow implementation gaps, not open architecture questions)

- **Where the chain-runner functions live**: `src/middleware.ts`, mirroring
  `src/routing.ts`'s precedent of pure, side-effect-light functions
  operating on `CanonicalEvent`, decoupled from `createAnalytics`'s
  closure state.
- **Error propagation from `runBeforeChain`/`runAfterChain`**: they do not
  themselves swallow or report errors — that responsibility belongs to
  `src/index.ts` (issue 003), which has access to the `onError`
  invocation policy and existing `console.warn` conventions. This keeps
  `src/middleware.ts` a pure, easily-unit-testable module.
- **`BeforeChainResult.ranMiddlewares`**: exists specifically so issue 003
  can determine, on a thrown error mid-chain, exactly which middlewares
  already ran their `before()` (and therefore should receive `onError`)
  without re-deriving that from a partial/inconsistent state.

## Acceptance criteria

- `src/middleware.ts` exists, exports exactly the surface above (types
  and both functions), depends only on `./schema` (`CanonicalEvent`).
- `runBeforeChain([])` (empty middleware list) returns `{ event,
  dropped: false, ranMiddlewares: [] }` unchanged (reference-equal
  `event`).
- `runBeforeChain` calls each middleware without a `before` method as a
  no-op passthrough (event unchanged, still counted in
  `ranMiddlewares` since it "ran" — trivially).
- `runBeforeChain` threads a transformed event from one middleware's
  `before()` into the next middleware's `before()` call.
- `runBeforeChain` stops at the first `before()` returning
  `null`/`undefined`; later middlewares are never invoked (assert via a
  spy/call-count); `dropped: true`; `ranMiddlewares` includes the
  dropping middleware itself but not any after it.
- `runAfterChain` invokes every middleware's `after()` (skipping
  middlewares without one) in registration order, passing the same
  `event` reference to each (not re-transformed between calls — `after`
  is not a transform stage, `void` return).
- `Analytics<Events>.use()` is present in the interface; `createAnalytics()`
  returns a working `use()` that accumulates calls into an internal array
  (assert via a white-box test or by having issue 002/003 build on top —
  a minimal test here can check that calling `use()` twice doesn't throw
  and doesn't affect `track()`'s behavior yet, since wiring is out of
  scope).
- `Middleware` type is exported from the package's public entry point.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (`src/middleware.test.ts`):

- Empty list passthrough (both chain functions).
- Single middleware, no `before`/`after` defined — no-op passthrough.
- Multiple middlewares, each mutating a distinct property — assert final
  event reflects all transformations in registration order.
- Drop mid-chain — assert exact call counts (later `before()`s never
  called) and `ranMiddlewares` contents.
- `runAfterChain` — assert call order via a shared array each stub
  pushes its `name` into.
- Async `before()`/`after()` (returning `Promise<...>`) — chain still
  resolves correctly, in order (not concurrently — assert via
  timestamps/ordering, not just Promise.all-style concurrent resolution).

**Integration tests** (`src/middleware.integration.test.ts` or folded into
`src/index.test.ts`): construct `createAnalytics()`, call `.use()` a
few times with realistic-looking middleware objects (e.g. one that
appends to `properties`, one with only `onError`), assert no errors are
thrown and `track()` still behaves exactly as pre-Phase-8 (since wiring
isn't live yet) — this is primarily a regression guard that `use()`
existing doesn't break anything, full pipeline integration tests belong
to issue 002.

## Out of scope

- Wiring `runBeforeChain`/`runAfterChain` into `track`/`page`/`screen` —
  issue 002.
- `onError` invocation policy and its interaction with
  `dispatchToProviders`/`settleAll` — issue 003.
- Any built-in middleware implementations — issue 004+.
- `examples/middleware/` — last issue.
