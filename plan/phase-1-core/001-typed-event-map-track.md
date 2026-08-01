# 001 — Generic `Events` map and typed `track()`

## Context

Phase 0 shipped an untyped `createAnalytics()` in `src/index.ts`: `track(event: string, payload?: Record<string, unknown>)`. Phase 1's core goal is compile-time-checked `track()` calls against a user-defined event schema:

```ts
const analytics = createAnalytics<{
  signup_completed: { plan: "free" | "pro" };
  page_viewed: undefined; // no payload
}>();

analytics.track("signup_completed", { plan: "pro" }); // ok
analytics.track("page_viewed");                        // ok, no second arg
analytics.track("signup_completed", { plan: "enterprise" }); // compile error
analytics.track("nope", {});                            // compile error
```

This issue covers *only* the TypeScript-level typing of `track()` against a generic `Events` map — no Zod, no runtime validation. `identify()` and `page()` are out of scope (see below) and keep their Phase 0 signatures unchanged, still calling into `src/providers/index.ts`'s `AnalyticsProvider` exactly as today.

Depends on: Phase 0 scaffold (`src/index.ts`, `src/providers/index.ts`, `src/schema.ts`) — already exists, do not re-plan it.

### Design decisions made here (research-backed, not deferred to the user)

- **`EventMap` shape**: `type EventMap = Record<string, Record<string, unknown> | undefined>`. Payload types must be an object shape or `undefined` (for no-payload events). Rationale: the existing `AnalyticsProvider.track(event, payload: Record<string, unknown>, meta)` signature is not being changed (no compelling reason found — see CLAUDE.md "provider interface already exists, do not change unless compelling reason"), so the typed payload must ultimately be assignable to `Record<string, unknown>` when forwarded to the provider. Primitive/array/tuple payload types are explicitly not supported (see Out of scope).
- **No-payload events**: declared as `SomeEvent: undefined` in the `Events` map. `track()`'s second parameter must become *optional* precisely when `Events[K]` is `undefined`, and *required* otherwise. Use a conditional tuple-spread rest parameter (or equivalent) rather than a hand-maintained overload set, e.g. shape:
  `track<K extends keyof Events>(event: K, ...args: Events[K] extends undefined ? [payload?: Events[K]] : [payload: Events[K]]): void | Promise<void>`
  The implementor may choose overloads instead if it proves cleaner, as long as the observable typing behavior (below) holds.
- **Backward compatibility / default generic**: `createAnalytics()` called with no explicit `<Events>` type argument must keep working exactly like Phase 0 — any string event name, any `Record<string, unknown>` payload, payload optional. Default the generic to a fully permissive `EventMap`, e.g. `Events extends EventMap = Record<string, Record<string, unknown> | undefined>`. The existing `src/index.test.ts` file must keep passing unmodified and untyped.
- **`identify`/`page` stay untouched**: no generic typing added to traits/props in this issue (see Out of scope). They keep exactly the Phase 0 signatures and behavior.

## Acceptance criteria

- [ ] `createAnalytics<Events extends EventMap>(options?)` accepts an optional generic type parameter constrained to `EventMap` (`Record<string, Record<string, unknown> | undefined>`), exported as a named type (e.g. `EventMap`) from `src/index.ts` or `src/schema.ts`.
- [ ] When `Events` is explicitly supplied, `analytics.track(event, payload)`:
  - accepts only event names that are keys of `Events` (unknown event name → compile error).
  - requires `payload` to structurally match `Events[K]` when `Events[K]` is not `undefined` (wrong/missing/extra required fields → compile error; the exact strictness — excess property checks etc. — should follow normal TS object literal assignability, no custom enforcement needed).
  - makes `payload` optional (may be omitted) when `Events[K]` is `undefined`.
- [ ] When `Events` is *not* explicitly supplied (`createAnalytics()` with no type argument), `track()` behaves exactly as in Phase 0: any string event name, optional `Record<string, unknown>` payload.
- [ ] `track()`'s runtime behavior is unchanged from Phase 0 in this issue: it still builds `EventMeta` and forwards `event`, `payload ?? {}`, `meta` to `provider.track()` — no new runtime logic beyond what's needed to make the above typing work (no Zod, no validation).
- [ ] `identify()` and `page()` signatures and behavior are unchanged from Phase 0 (no generic typing added).
- [ ] `AnalyticsProvider` (`src/providers/index.ts`) is unmodified.
- [ ] Any new/changed public types (`EventMap`, updated `Analytics<Events>`, `CreateAnalyticsOptions<Events>`) are exported from `src/index.ts`.

## Test requirements

**Unit tests** (`src/index.test.ts` or a new `src/index.typed.test.ts`):
- Runtime unit test confirming that with a typed `Events` map, calling `track` with a valid event/payload still forwards the correct `event`, `payload`, and `meta.timestamp` to the mocked provider (mirrors the existing Phase 0 "forwards track calls" test, but through a typed `createAnalytics<Events>()` instance).
- Runtime unit test confirming a no-payload event (`Events[K] = undefined`) can be called as `track("some_event")` with no second argument, and the provider receives `{}` (or whatever the established no-payload default is) as payload.
- The existing Phase 0 tests in `src/index.test.ts` (untyped `createAnalytics()`) must continue to pass unmodified.

**Compile-time / type-level tests** (required — this issue is primarily about typing):
- A dedicated type-test file (e.g. `src/index.types.test.ts`, using `// @ts-expect-error` comments plus `bun test`/`tsgo --noEmit` as the enforcement mechanism — implementor's choice of harness, but it must run as part of `bun test` or `typecheck` in CI) that asserts, for a sample `Events` map:
  - a call with an unknown event name is a compile error (`// @ts-expect-error`).
  - a call with a wrong-shaped payload for a known event is a compile error.
  - a call omitting a required payload is a compile error.
  - a call to a no-payload event without a second argument compiles successfully.
  - a call with a valid, correctly-shaped payload compiles successfully.

**Integration test**:
- End-to-end test using a real (non-mock, but test-local) `AnalyticsProvider` implementation and a multi-event `Events` map (at least 2 events, one with payload, one without) exercising `createAnalytics<Events>({ provider })` → `track()` for both event kinds → asserting the provider received the right calls, in the same style as Phase 0's integration-style test but against the typed factory.

## Out of scope

- Zod schema support, `z.infer`, or any runtime payload validation — issue 002.
- Typed `identify()` traits or typed `page()` props — not requested by the phase goal's concrete example, and left as Phase 0's loose `Record<string, unknown>` signatures. A future phase may extend the `Events`-style typing to these if requested.
- Primitive, array, or tuple event payload types (e.g. `Events["x"] = string`) — payloads must be object-shaped or `undefined`, to remain compatible with `AnalyticsProvider.track`'s existing `Record<string, unknown>` parameter without modifying that interface.
- Changing `AnalyticsProvider`'s shape in `src/providers/index.ts`.
- Any build/export map (`package.json` `exports`) changes — Phase 4 concern per `plan/phase-0-foundations/BRIEF.md`.
