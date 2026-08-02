# 002 — Core identity/session state, full verb set, and capability-gating (`src/index.ts`)

## Context

Depends on issue 001 (canonical event model + `AnalyticsProvider` shape).
This issue rewrites `createAnalytics()` itself: identity/session state
(`anonymousId`/`sessionId`/`userId`) moves into core (adapters no longer
generate or own it — issues 003-005 delete that logic from each adapter);
the `Analytics<Events>` interface gains `group`/`alias`/`screen`/`reset`/
`destroy`; and core enforces the capability-based ignore/warn/fallback
policy for the five gated verbs (`identify`/`page`/`group`/`alias`/
`screen`) before calling into the resolved provider. This is a **breaking**
rewrite of `src/index.ts` — do not preserve the old `track(event, payload,
meta)` provider-call shape or the old bare `Analytics` interface.

`provider` stays **singular** (`AnalyticsProvider`, not an array) this
phase — multi-provider fan-out is Phase 7's scope (see `plan/ROADMAP.md`);
do not add array support here even though it's already a resolved *design*
decision in CLAUDE.md.

## Design decisions made in this issue (not litigated with the user — narrow implementation gaps, not open architecture questions)

- **`page()`/`screen()` name sentinel**: `CanonicalEvent.name` is a
  required `string`. Core populates it with the app-supplied `name` when
  given, or the empty string `""` when omitted (never `undefined`).
  Adapters (issues 003-005) must treat `event.name === ""` as "no name was
  supplied," mirroring today's `name === undefined` checks.
- **`alias()` does not mutate core's stored `userId`.** `identify()` is the
  only verb that updates core's current `userId`; `alias()` only forwards
  to `provider.alias?.()`.
- **`reset()`'s `provider.reset?.()` call is not capability-gated** — it's
  a lifecycle hook, not a data verb, and `ProviderCapabilities` has no
  `reset` field. Same for `flush()`/`destroy()`.
- **`track()` is never capability-gated** — `AnalyticsProvider.track` is a
  required (non-optional) field on the interface, always called directly.

## Acceptance criteria

- `Analytics<Events>` becomes:
  ```ts
  export interface Analytics<Events extends EventMap = EventMap> {
    track<K extends keyof Events>(event: K, ...args: TrackArgs<Events[K]>): void | Promise<void>;
    identify(userId: string, traits?: Record<string, unknown>): void | Promise<void>;
    page(name?: string, props?: Record<string, unknown>, options?: TrackOptions): void | Promise<void>;
    group(groupId: string, traits?: Record<string, unknown>): void | Promise<void>;
    alias(newUserId: string, previousUserId?: string): void | Promise<void>;
    screen(name?: string, props?: Record<string, unknown>, options?: TrackOptions): void | Promise<void>;
    reset(): void | Promise<void>;
    flush(): Promise<void>;
    destroy(): Promise<void>;
  }
  ```
- `createAnalytics()` generates, once at construction, in-memory only (no
  persistence): `anonymousId = crypto.randomUUID()`, `sessionId =
  crypto.randomUUID()`; `userId` starts `undefined`.
- A closure-scoped `warnedCapabilities = new Set<string>()` backs a shared
  gate helper used by `identify`/`page`/`group`/`alias`/`screen`: if
  `!provider.capabilities[capability] || typeof provider[method] !==
  "function"`, `console.warn` exactly once per unique
  `` `${provider.name}:${capability}` `` key (never a second time for the
  same pair, even across many calls), and the verb becomes a no-op that
  returns normally (matching the interface's declared `void |
  Promise<void>` — resolve a promise if the interface says so where the
  call would otherwise have been awaited) and **never throws**.
- `track(event, payload?, options?)`: validation behavior (schema lookup,
  `EventValidationError`, `onValidationError`) is **unchanged** from
  today and applies only to `payload`. The dev-server mirror fire-and-forget
  POST (unchanged wire format: `{ event, payload: rawPayload }`) still
  fires before validation, exactly as today. After validation succeeds (or
  no schema exists), core builds:
  ```ts
  const canonicalEvent: CanonicalEvent = {
    name: event as string,
    properties: payload,
    timestamp: Date.now(),
    anonymousId,
    userId,
    sessionId,
    context: options?.context,
    metadata: options?.metadata,
  };
  return provider.track(canonicalEvent);
  ```
- `identify(userId, traits)`: sets core's `userId = userId`, then gated-calls
  `provider.identify?.(userId, traits, anonymousId)` (capability `identify`).
- `page(name, props, options)`: builds a `CanonicalEvent` with `name: name
  ?? ""`, `properties: props ?? {}`, `timestamp`, `anonymousId`, `userId`,
  `sessionId`, `context`/`metadata` from `options`; gated-calls
  `provider.page?.(canonicalEvent)` (capability `page`).
- `group(groupId, traits)`: gated-calls `provider.group?.(groupId, traits,
  { userId, anonymousId })` (capability `group`).
- `alias(newUserId, previousUserId)`: gated-calls
  `provider.alias?.(newUserId, previousUserId, anonymousId)` (capability
  `alias`); does **not** mutate core's `userId`.
- `screen(name, props, options)`: same shape as `page`, gated-calls
  `provider.screen?.(canonicalEvent)` (capability `screen`).
- `reset()`: synchronously reassigns `anonymousId = crypto.randomUUID()`,
  `sessionId = crypto.randomUUID()`, `userId = undefined` **before**
  calling `provider.reset?.()` (eager, not lazy); returns whatever
  `provider.reset?.()` returns (or `undefined` if the provider doesn't
  implement it); never throws; not capability-gated.
- `flush()`: unchanged behavior — `await provider.flush?.()`.
- `destroy()`: `await provider.flush?.()` first (drain), then `await
  provider.destroy?.()` (teardown); resolves after both complete; not
  capability-gated.
- All existing `devServer`/`schemas`/`onValidationError` options and
  behavior are preserved exactly as today.

## Test requirements

Both unit and integration tests are required; neither alone satisfies this
issue.

**Unit tests** (extend `src/index.test.ts` and its sibling
`src/index.*.test.ts` files, or add `src/index.identity.test.ts` /
`src/index.capabilities.test.ts` as new files matching the existing
per-concern test file split already used in this directory):
- `anonymousId`/`sessionId` are generated once and stay stable across
  multiple `track()` calls (assert via a provider stub capturing the
  `CanonicalEvent` and comparing IDs across two calls).
- `identify("user_1")` causes subsequent `track()`-built `CanonicalEvent`s
  to carry `userId: "user_1"`; a `track()` call made *before* `identify()`
  carries `userId: undefined`.
- `track(event, payload, { context, metadata })` produces a
  `CanonicalEvent` with those exact `context`/`metadata` values; omitting
  the third argument produces `context: undefined, metadata: undefined`.
- `page()`/`screen()` called with no `name` produce `CanonicalEvent.name
  === ""`; called with a `name` produce that exact string.
- Calling `identify()`/`page()`/`group()`/`alias()`/`screen()` against a
  stub provider whose `capabilities.<verb>` is `false` (or whose optional
  method is simply omitted) does not call the provider's method, does not
  throw, and calls `console.warn` (spy/mock it) exactly once; a second
  identical call to the same verb against the same provider instance does
  not call `console.warn` again; a call to a *different* gated verb (or a
  differently-`name`d provider) produces its own independent warning.
- `reset()`: generates new `anonymousId`/`sessionId` values different from
  the originals, clears `userId` back to `undefined` (verified via a
  subsequent `track()` call's `CanonicalEvent`), and calls
  `provider.reset?.()` exactly once.
- `destroy()`: calls `provider.flush?.()` before `provider.destroy?.()`
  (assert call order via a stub that records call order), and resolves.
- `alias()` does not mutate core's `userId` (a `track()` immediately after
  `alias()` without an intervening `identify()` still carries the
  pre-alias `userId`).
- Default (no `provider` supplied) `createAnalytics()` still works
  end-to-end against `noopProvider` and never throws, across every verb
  including the five new ones.

**Integration tests** (`src/index.canonicalEvent.integration.test.ts` or
similar, new file): construct `createAnalytics({ provider })` with a real
(non-stub) hand-written `AnalyticsProvider` object (not a `mock()`) whose
methods push received arguments into a plain array, drive a realistic
sequence — `track()` before `identify()`, `identify()`, `track()` after,
`group()`, `alias()`, `page()`, `screen()`, `reset()`, `track()` again,
`flush()`, `destroy()` — and assert the full recorded call sequence shows
the correct `CanonicalEvent`/identity values at each step, including the
identity discontinuity introduced by `reset()`. This test exercises the
whole core lifecycle contract end-to-end, not just one verb in isolation.

## Out of scope

- Any adapter changes — issues 003-005.
- `enable()`/`disable()` — deferred to the Privacy/consent phase; do not
  implement, and this omission is intentional (state so in code comments
  if helpful).
- Multi-provider array fan-out — Phase 7.
- Persisting `anonymousId`/`sessionId`/`userId` across process restarts
  (e.g. to disk/localStorage) — explicitly out of scope, a later phase.
- Any auto-capture of `context`/`metadata` — these fields are purely
  pass-through from whatever the app explicitly supplies via the trailing
  options argument; no browser/OS/locale detection logic here.
- Changing the dev-server mirror's wire format to include canonical
  fields — it stays exactly `{ event, payload: rawPayload }`.
