# 003 — wire multi-provider fan-out into `createAnalytics()` (`src/index.ts`)

## Context

Depends on issue 001 (`ProviderEntry`, `RouteMatcher`, `normalizeProviders`)
and issue 002 (`shouldRouteToProvider`, `sortByPriority`). This is the
breaking rewrite of `src/index.ts`'s provider-call plumbing: `provider`
becomes `AnalyticsProvider | ProviderEntry | (AnalyticsProvider |
ProviderEntry)[]`, capability gating (`isCapabilitySupported`) becomes
per-provider, and every verb dispatches to one or many providers. `flush`/
`destroy`'s `AggregateError` behavior is **out of scope here** — issue 004
builds on top of this issue's fan-out plumbing for those two verbs only;
this issue can leave them using the same swallow-and-warn helper as every
other verb, since `flush`/`destroy` are also always-fan-out verbs and the
provider-list traversal is shared.

Locked design this issue implements:

- `CreateAnalyticsOptions.provider` type: `AnalyticsProvider | ProviderEntry
  | (AnalyticsProvider | ProviderEntry)[]`. A single bare provider (the
  `isMulti: false` case from issue 001) keeps **exact Phase 6 passthrough
  behavior** — same return values, same capability-gate warning behavior
  (one shared `warnedCapabilities` Set, not per-provider-in-array — there's
  only one provider), no `Promise.allSettled` wrapping, no routing
  evaluation. This is a deliberate fast path so the ergonomic single-
  provider default has zero fan-out overhead.
- Any `isMulti: true` shape (array of any length including 0/1, or a lone
  `ProviderEntry`) uses the multi-provider path for every verb.
- Capability gating becomes per-provider: the `warnedCapabilities` Set is
  keyed by `` `${provider.name}:${capability}` `` exactly as today, but is
  now checked/populated once per provider in the fan-out list, not once
  globally — a provider that doesn't support a capability warns and is
  skipped *for that call*, without affecting whether other providers in
  the list receive the call.
- `track`/`page`/`screen`: for each provider entry (after
  `sortByPriority`), evaluate `shouldRouteToProvider(entry, canonicalEvent)`
  — skip (no call, no warning) if it returns `false`. For entries that
  route, apply capability gating exactly as `identify`/`group`/`alias`
  already do today (note: today's code does NOT capability-gate `track`,
  since `AnalyticsProvider.track` is required — that stays true; `page`/
  `screen` are already gated today and stay gated). Call
  `entry.provider.track/page/screen(canonicalEvent)` for every provider
  that passes both routing and capability gating, via `Promise.allSettled`;
  any rejection is swallowed with `console.warn` (message includes
  provider name, verb, and the rejection reason) — never dedup these
  runtime-failure warnings the way capability warnings are deduped; every
  failure warns.
- `identify`/`group`/`alias`/`reset`: always fan out to every provider in
  the list unconditionally (no routing evaluation — `shouldRouteToProvider`
  is never called for these verbs). Capability gating still applies
  per-provider exactly as above. `Promise.allSettled` + swallow-and-warn
  on rejection, same as `track`/`page`/`screen`.
- `flush`/`destroy`: issue 004's scope for their `AggregateError` contract,
  but this issue must still make them iterate every provider in the list
  (single-provider fast path unchanged from Phase 6: `await
  provider.flush?.()` / `await provider.flush?.(); await
  provider.destroy?.()` exactly as today). Leave the array path calling
  each provider's `flush?.()`/`destroy?.()` via `Promise.allSettled` with
  simple swallow-and-warn for now if you want a working intermediate
  state — issue 004 changes the array path's rejection handling to throw
  `AggregateError` instead of warning. Do not spend excess effort here if
  issue 004 immediately follows; a minimal correct iteration is enough.
- Return type: single-provider path — unchanged passthrough (`void |
  Promise<void>`, whatever the provider itself returns). Multi-provider
  path (array of length > 1, or `isMulti: true` generally) — `track`/
  `page`/`screen`/`identify`/`group`/`alias`/`reset` always return
  `Promise<void>` (resolves once all applicable providers settle, never
  rejects). Note this means the `Analytics<Events>` interface's existing
  `void | Promise<void>` return types on these methods remain accurate
  (the union already allows `Promise<void>`) — no interface signature
  change needed, just runtime behavior.
- Identity state (`anonymousId`/`sessionId`/`userId`) stays exactly as
  today: one set of identity fields in core, shared across every provider
  in the list (not per-provider) — `identify()` still only mutates
  `userId` once, and every provider that receives any canonical event
  sees the same `anonymousId`/`sessionId`/`userId`.
- `reset()`: identity reassignment stays eager (before any provider call),
  exactly as today; then fans out `provider.reset?.()` to every provider
  in the list (capability-gated: `reset` is not itself in
  `GatedCapability`/`ProviderCapabilities` today — keep it un-gated, exactly
  matching Phase 6's existing `reset()` behavior, just now iterated over a
  list instead of a single provider).

## Design decisions made in this issue (narrow implementation gaps)

- **Where routing/capability/fan-out logic lives**: keep it inline in
  `src/index.ts` (as today's `isCapabilitySupported` already is), not a
  separate module — this is glue between `src/routing.ts`'s pure functions
  and the existing verb closures, tightly coupled to `createAnalytics`'s
  local state (`warnedCapabilities`, identity fields). A small local
  helper (e.g. `dispatchToProviders(entries, verb, ...)`) is reasonable to
  avoid duplicating the `Promise.allSettled` + warn pattern six times, but
  is an internal implementation detail, not a new export.
- **`console.warn` message format for runtime rejections**: not
  prescribed exactly — must include the provider's `name`, the verb name,
  and the rejection reason, in whatever format matches the existing
  capability-warning message's style/tone.
- **Order of capability-gate check vs. routing check** for `track`/`page`/
  `screen`: evaluate routing first (`shouldRouteToProvider`), then
  capability gating, for providers that pass routing. A provider skipped
  by routing never gets a capability-gate warning either (it was never a
  candidate for the call at all) — this matters because a provider that
  doesn't support `page` but was also excluded by routing shouldn't warn
  about the unrelated capability gap on every excluded event.

## Acceptance criteria

- `CreateAnalyticsOptions.provider` type updated; `ProviderEntry` and
  `RouteMatcher` imported from `./routing` and re-exported from the public
  barrel (`export type { ProviderEntry, RouteMatcher } from "./routing"`).
- `createAnalytics()` calls `normalizeProviders(options.provider ??
  noopProvider)` once at construction (after the existing `noopProvider`
  default is applied — matches issue 001's contract that
  `normalizeProviders` doesn't own that default). Construction-time
  `include`+`exclude` conflicts throw synchronously out of
  `createAnalytics()` itself, exactly as `normalizeProviders` throws.
- Every verb dispatches via the single-provider fast path when
  `!normalized.isMulti`, and via per-provider iteration
  (`sortByPriority(normalized.entries)` for the three routable verbs;
  `normalized.entries` in original order for the always-fan-out verbs —
  priority ordering is documented as track/page/screen-relevant in the
  locked design; for always-fan-out verbs, applying `sortByPriority` too
  is harmless and acceptable if simpler to implement uniformly — your
  choice, but be consistent and state which you chose) when
  `normalized.isMulti`.
- `warnedCapabilities` Set stays a single `Set<string>` closure variable,
  keyed by `` `${provider.name}:${capability}` `` — this naturally
  provides "per-provider" dedup already since the key includes
  `provider.name`; the fix needed relative to today's code is that the
  gate-check function itself must take a `provider`/`entry` parameter
  instead of closing over one outer `provider` variable, so it can be
  called once per provider in a fan-out list, not just the single outer
  one.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (extend `src/index.test.ts` / add
`src/index.multiProvider.test.ts`, `src/index.routing.test.ts`):

- Single bare provider: all existing Phase 6 tests continue to pass
  unmodified (no behavior change) — run the existing suite as a
  regression check, don't rewrite it.
- Array of 2 bare providers, no routing config: `track()` calls both
  providers' `.track()` with the identical `CanonicalEvent`
  (reference-equal or deep-equal — assert deep-equal at minimum).
- Array with one `ProviderEntry` using `include`, one bare provider: an
  event not matching `include` is skipped for the wrapped provider but
  still delivered to the bare provider.
- Array with one provider whose `capabilities.page === false`: `page()`
  warns once for that provider (capability warning) and still calls
  `.page()` on a second, capable provider in the same array.
- A provider excluded by routing never triggers a capability warning for
  that call, even if it also lacks the capability (assert `console.warn`
  is not called for the excluded provider on that event).
- Fan-out error isolation: one provider's `.track()` throws/rejects,
  assert (a) the other provider(s) in the array still received the call,
  (b) `track()` itself does not throw/reject, (c) `console.warn` was
  called mentioning the failing provider's name.
- `identify`/`group`/`alias`/`reset` fan out to every provider regardless
  of any `include`/`exclude`/`predicate`/`sampling` set on their entries
  (construct entries where routing config would exclude every event, call
  `identify()`, assert every provider's `.identify?.()` was still called).
- `priority` ordering: 3 providers with priorities `[2, 0, 1]`, assert
  `.track()` is invoked on them in the order priority `0, 1, 2` (capture
  call order via a shared array each stub pushes its name into).
- Identity fields (`anonymousId`/`sessionId`/`userId`) are identical
  across every provider's received `CanonicalEvent` for the same call, and
  `identify()` updates `userId` for all subsequent calls to every
  provider.

**Integration tests** (`src/index.multiProvider.integration.test.ts`):
construct `createAnalytics({ provider: [...] })` with 3 realistic
hand-written `AnalyticsProvider` objects (not mocks) mixing bare and
wrapper entries with `include`/`exclude`/`predicate`/`sampling`/
`priority`, drive a realistic sequence of `track()`/`page()`/`identify()`/
`group()`/`alias()`/`screen()`/`reset()` calls with varying event names,
and assert the full per-provider received-call log matches hand-computed
expected routing/ordering/identity outcomes across the whole sequence —
mirrors issue 002's integration test structure but through the real
`createAnalytics()` entry point instead of calling `routing.ts` functions
directly.

## Out of scope

- `flush`/`destroy`'s `AggregateError` behavior — issue 004 (this issue
  only needs a minimally correct multi-provider iteration for them; the
  swallow-and-warn variant is an acceptable intermediate state).
- `examples/providers/` — issue 005.
- Any adapter changes.
- Persistence, offline queueing, middleware — later phases.
