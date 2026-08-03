# 002 — `context` option on `createAnalytics()`, session bookkeeping, merge precedence

## Context

Depends on issue 001 (`src/context.ts` fully implemented and tested).
This issue wires that pure module into `src/index.ts`: a new
`CreateAnalyticsOptions.context` option, construction-time static
capture, per-call dynamic capture + session bookkeeping, and the merge
with caller-supplied `TrackOptions.context`. Runs on `track`/`page`/
`screen` only (mirrors Phase 8's middleware scope note — `identify`/
`group`/`alias`/`reset`/`flush`/`destroy` never had a `CanonicalEvent`
and still don't).

This issue implements the locked design from this phase's grill-me
interview exactly — do not relitigate:

- **Option shape**, matching the existing `devServer?: boolean | { url?
  }` precedent in `CreateAnalyticsOptions`:

```ts
context?: boolean | ContextOptions;
```

  `context: true` is shorthand for `{ autoCapture: true }`.
  `context` omitted (`undefined`, the default) means **zero behavior
  change** — no capture attempted, `CanonicalEvent.context` continues to
  be exactly whatever `TrackOptions.context` supplies (or `undefined`),
  byte-for-byte identical to pre-Phase-9 behavior. `context: false` (or
  omitted) and `context: { autoCapture: false }` are equivalent to
  omitted — no capture.

- **Merge precedence**: shallow merge, **caller wins**. For a given
  `track`/`page`/`screen` call:

```ts
context: {
  ...autoCaptured,        // this issue's captured fields
  ...verbOptions?.context, // existing TrackOptions.context, unchanged shape
}
```

  A key present in both is fully overwritten by the caller's value (not
  deep-merged) — e.g. a caller-supplied `context: { campaign: {...} }`
  fully replaces the auto-captured `campaign` object, it does not merge
  sibling campaign sub-fields. When neither auto-capture nor a caller
  `context` produced anything, `CanonicalEvent.context` is `undefined`
  (not `{}`) — preserves the existing "no context supplied" contract
  exactly.
- **Session bookkeeping** (`context.session`, additive — does **not**
  replace or duplicate `CanonicalEvent.sessionId`, which is unchanged by
  this phase): a new closure-scoped session-state object, alongside the
  existing `anonymousId`/`sessionId`/`userId` state:

```ts
let sessionStartedAt = Date.now();
let sessionEventCount = 0;
```

  On every `track`/`page`/`screen` call (only when auto-capture is
  enabled — see below), increment `sessionEventCount` and compute
  `durationMs = Date.now() - sessionStartedAt` fresh, merging:

```ts
session: {
  startedAt: sessionStartedAt,
  eventCount: sessionEventCount, // includes the current call
  durationMs,
}
```

  `reset()` reinitializes `sessionStartedAt = Date.now()` and
  `sessionEventCount = 0` alongside its existing `anonymousId`/
  `sessionId`/`userId` reassignment — a fresh session context starts
  counting from zero again, consistent with `sessionId` itself being
  reassigned.
- **Gating**: none of the above (static capture, dynamic capture, session
  bookkeeping) runs at all when `context` is not truthy/`autoCapture` is
  not `true` — no wasted `Intl`/UA-parsing work, and no
  `context.session` key appears on `CanonicalEvent.context` for apps that
  never opted in (existing `TrackOptions.context` behavior is completely
  unaffected either way).

## Scope of this issue

Update `src/index.ts`:

- Add `context?: boolean | ContextOptions` to `CreateAnalyticsOptions`
  (placed after `devServer`, matching the interface's
  ordering-by-recency-of-phase convention), with a doc comment
  explaining the shorthand and default-off behavior.
- Re-export from the public barrel: `export type { CapturedContext,
  ContextOptions } from "./context";`.
- Add a small local helper (mirroring `resolveDevServerUrl`'s pattern)
  to normalize `context` into `{ autoCapture: boolean; featureFlags?:
  () => Record<string, unknown> } | undefined`, e.g.:

```ts
function resolveContextOptions(
  context: CreateAnalyticsOptions["context"],
): ContextOptions | undefined {
  if (!context) return undefined;
  if (context === true) return { autoCapture: true };
  return context.autoCapture ? context : undefined;
}
```

- At construction time (inside `createAnalytics()`, alongside the
  existing `anonymousId`/`sessionId` initialization): if
  `resolveContextOptions(options.context)` is truthy, call
  `captureStaticContext()` **once** and cache the result in a closure
  variable (e.g. `const staticContext = ... ? captureStaticContext() :
  undefined;`). Initialize `sessionStartedAt`/`sessionEventCount` here
  too (unconditionally cheap — `Date.now()`/`0` — but only ever read/
  merged when auto-capture is on).
- Update `buildEvent()` (used by `page`/`screen`) and `track()`'s inline
  canonical-event construction (the two call sites that currently set
  `context: verbOptions?.context` / `context: trackOptions?.context`
  directly, `src/index.ts:282` and `:386` at time of writing) to:
  1. When auto-capture is off (`staticContext` is `undefined`): behavior
     is **byte-for-byte unchanged** — `context: verbOptions?.context`
     exactly as today, no new object allocation, no session-count
     increment.
  2. When auto-capture is on: increment `sessionEventCount`, call
     `captureDynamicContext(contextOptions)`, merge
     `{ ...staticContext, ...dynamicContext, session: {...}, ...verbOptions?.context
     }` (caller's `context` spread last, wins on collision), and set the
     result as `context` — but if the merged object would be empty
     (impossible in practice since `session` is always present when
     auto-capture is on, included for completeness) fall back to
     `undefined`.
  Since both call sites need identical merge logic, factor it into one
  shared local function (e.g. `function resolveEventContext(verbOptions:
  TrackOptions | undefined): Record<string, unknown> | undefined`) called
  from both `buildEvent()` and `track()`'s inline construction, rather
  than duplicating the merge inline in two places.

## Design decisions made in this issue (narrow implementation gaps, not open architecture questions)

- **Where `resolveEventContext` lives**: inline closure function inside
  `createAnalytics()`, alongside `buildEvent()` — needs access to
  `staticContext`/`contextOptions`/`sessionStartedAt`/`sessionEventCount`
  closure state, so it can't be a standalone pure export the way
  `src/context.ts`'s functions are.
- **`context: false` handling**: treated identically to `context`
  omitted/`undefined` — `resolveContextOptions` returns `undefined` for
  any falsy input, no special-cased third state.
- **Session increment ordering**: `sessionEventCount` increments
  unconditionally once per `track`/`page`/`screen` call (when
  auto-capture is on), regardless of whether that call's event is later
  dropped by middleware or fails validation — this issue's context
  building happens at event-construction time, before middleware/
  validation run, matching where `context`/`metadata` were already being
  set pre-Phase-9. Do not attempt to "undo" the increment on a later
  drop/validation-failure — that would require threading rollback logic
  through unrelated pipeline stages for a cosmetic counter.

## Acceptance criteria

- `createAnalytics()` (no `context` option) behaves byte-for-byte
  identically to pre-Phase-9: `CanonicalEvent.context` is exactly
  `verbOptions?.context`, `undefined` when not supplied. No `Intl`/UA
  work performed at all (assert via a spy on `captureStaticContext`
  never being called when `context` is omitted, or equivalent).
- `createAnalytics({ context: true })` — first `track()` call's
  delivered event has `context.locale`/`context.timezone` populated;
  `context.session.eventCount === 1`; a second `track()` call has
  `context.session.eventCount === 2` and a `durationMs` greater than or
  equal to the first call's.
- `createAnalytics({ context: { autoCapture: true, featureFlags: () =>
  ({ "new-checkout": "b" }) } })` — delivered event's
  `context.featureFlags` equals `{ "new-checkout": "b" }`; a mutated
  return value on a later call (stub returns a different object each
  invocation) is reflected fresh in that later call's event, not cached
  from construction time.
- Caller-supplied `TrackOptions.context` wins on key collision: with
  auto-capture on and a stubbed browser environment producing
  `context.locale = "en-US"`, a call with `{ context: { locale: "fr-FR"
  } }` delivers `context.locale === "fr-FR"` while other auto-captured
  keys (`timezone`, `session`, etc.) remain present from auto-capture.
- `reset()` reinitializes the session: after a few `track()` calls
  (`eventCount` > 1), calling `reset()` then `track()` again yields
  `context.session.eventCount === 1` and a new `startedAt` greater than
  or equal to the original.
- `page()`/`screen()` receive identical auto-capture/merge treatment to
  `track()` (same `resolveEventContext` call site).
- `identify`/`group`/`alias`/`flush`/`destroy` are completely unaffected
  — no context capture attempted, no session increment (they have no
  `CanonicalEvent`).
- `CapturedContext`/`ContextOptions` types are exported from the
  package's public entry point.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (extend `src/index.test.ts` or a new
`src/index.context.test.ts`, implementor's call on file organization,
consistent with how Phase 7/8's tests were organized):

- `resolveContextOptions`-equivalent behavior for all three option
  shapes (`undefined`/`false`, `true`, `{ autoCapture: true, ... }`,
  `{ autoCapture: false }`).
- Merge precedence (caller wins on collision, auto-capture fills gaps).
- Session counter increments and `reset()` reinitialization, using a
  stubbed/mocked `Date.now()` if needed for deterministic `durationMs`
  assertions (or asserting monotonic non-decreasing rather than exact
  values, implementor's call).

**Integration tests**
(`src/index.context.integration.test.ts` or folded into the existing
integration suite): construct `createAnalytics({ context: true, provider
})` with a stub provider that records every received `CanonicalEvent`,
call `track`/`page`/`screen` a few times, assert the recorded events'
`context` shape end-to-end (including the byte-for-byte-unchanged
regression case with `context` omitted entirely).

## Out of scope

- Any change to `src/context.ts` itself — issue 001.
- `examples/` — issue 003.
- Any interaction with Phase 7 routing or Phase 8 middleware beyond the
  existing pipeline order (context is built before middleware runs,
  exactly where `context`/`metadata` were already being set — unchanged
  ordering, this issue does not move where in the pipeline context
  construction happens).
