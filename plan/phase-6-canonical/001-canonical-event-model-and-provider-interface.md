# 001 — Canonical event model + `AnalyticsProvider` interface rewrite (types only, breaking)

## Context

Phase 6 replaces today's bare `EventMeta` (`{ timestamp }`) with a full
canonical event model, and rewrites `AnalyticsProvider` so every verb
carries identity/session state instead of adapters reinventing it. This
issue lands the **type-level** half of that rework only — `src/schema.ts`
and `src/providers/index.ts` — with zero behavioral change to
`createAnalytics()` (that's issue 002). This is a foundational,
**intentionally breaking** change: `AnalyticsProvider.track()`/`.page()`
change from `(event, payload, meta)` / `(name?, props?)` to a single
`CanonicalEvent` object; `identify()` gains a required `anonymousId` third
argument; `flush()`'s contract is clarified; `group()`/`alias()`/`screen()`/
`reset()`/`destroy()` are added. Do not attempt to preserve the old
signatures for back-compat — there is no back-compat requirement for this
phase, per `plan/phase-6-canonical/BRIEF.md`.

This depends on nothing else in Phase 6 (it's the first issue) and issues
002-006 all depend on it.

## Acceptance criteria

**`src/schema.ts`:**
- Remove the `EventMeta` interface entirely (no re-export, no deprecated
  alias — this is breaking).
- Add and export:
  ```ts
  export interface CanonicalEvent {
    name: string;
    properties: Record<string, unknown>;
    timestamp: number;
    anonymousId: string;
    userId?: string;
    sessionId: string;
    context?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }

  export interface TrackOptions {
    context?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
  ```
- Update `TrackArgs<V>` to accept an optional trailing `TrackOptions`
  argument regardless of whether the event's payload is itself optional:
  ```ts
  export type TrackArgs<V> = V extends undefined
    ? [payload?: V, options?: TrackOptions]
    : [payload: V, options?: TrackOptions];
  ```
  Distribution behavior over the naked type parameter `V` (documented in
  the existing comment above `TrackArgs`) must be preserved — do not
  rewrite this against `Events[K]` directly.
- `EventMap`, `SchemaMap<Events>`, `InferEvents<S>`, `EventValidationError`
  are unchanged. Validation continues to apply only to the `payload`
  argument — `context`/`metadata` are never validated, never passed to
  `schema.safeParse()`.

**`src/providers/index.ts`:**
- Add and export:
  ```ts
  export interface ProviderCapabilities {
    identify: boolean;
    group: boolean;
    alias: boolean;
    page: boolean;
    screen: boolean;
    batching: boolean;
    offline: boolean;
    featureFlags: boolean;
    sessionReplay: boolean;
    heatmaps: boolean;
  }
  ```
- Rewrite `AnalyticsProvider` to exactly:
  ```ts
  export interface AnalyticsProvider {
    name: string;
    capabilities: ProviderCapabilities;
    init?(config: Record<string, unknown>): void | Promise<void>;
    track(event: CanonicalEvent): void | Promise<void>;
    identify?(userId: string, traits: Record<string, unknown> | undefined, anonymousId: string): void | Promise<void>;
    group?(groupId: string, traits: Record<string, unknown> | undefined, identity: { userId?: string; anonymousId: string }): void | Promise<void>;
    alias?(newUserId: string, previousUserId: string | undefined, anonymousId: string): void | Promise<void>;
    page?(event: CanonicalEvent): void | Promise<void>;
    screen?(event: CanonicalEvent): void | Promise<void>;
    flush?(): Promise<void>;
    reset?(): void | Promise<void>;
    destroy?(): Promise<void>;
  }
  ```
  Import `CanonicalEvent` as a type from `../schema`.
- Rewrite `noopProvider` to implement **every** optional method as a
  genuine no-op (not just `track`), and declare `capabilities` as **all
  `true`**. Rationale (state this in a code comment): `noopProvider`'s
  entire purpose is to accept every call harmlessly as a safe default/test
  double — declaring any capability `false` would make core's Phase-6
  capability-gating (issue 002) start silently warning/no-oping calls made
  against the *intentionally* do-nothing provider, which is exactly the
  opposite of what a no-op default should do.
  ```ts
  export const noopProvider: AnalyticsProvider = {
    name: "noop",
    capabilities: { identify: true, group: true, alias: true, page: true, screen: true, batching: true, offline: true, featureFlags: true, sessionReplay: true, heatmaps: true },
    track() {},
    identify() {},
    group() {},
    alias() {},
    page() {},
    screen() {},
    async flush() {},
    reset() {},
    async destroy() {},
  };
  ```
- `src/index.ts` re-exports (`export type { CanonicalEvent, TrackOptions } from "./schema";`, `export type { AnalyticsProvider, ProviderCapabilities } from "./providers";`) — but do **not** touch `createAnalytics()`'s implementation itself in this issue (that's issue 002's scope). It is acceptable/expected for `src/index.ts` to fail to typecheck against the new `AnalyticsProvider`/`TrackArgs` shapes until issue 002 lands — if the implementor finds this makes `bun run typecheck`/`bun test` fail across the whole repo, that is an accepted, temporary, single-commit-window state to be resolved by issue 002 landing immediately after; do not paper over it by inventing partial/interim core behavior in this issue.

## Test requirements

Both unit and integration tests are required; neither alone satisfies this
issue.

**Unit tests** (`src/providers/index.test.ts`, new file):
- `noopProvider.capabilities` has all ten fields `true`.
- Calling each of `noopProvider`'s methods (`track`, `identify`, `group`,
  `alias`, `page`, `screen`, `flush`, `reset`, `destroy`) with plausible
  arguments does not throw, and `flush()`/`destroy()` resolve.
- A type-only test file `src/providers/index.types.test.ts` (following the
  `@ts-expect-error` compile-time-assertion convention used in
  `src/index.types.test.ts`/`src/schema.types.test.ts`) asserting:
  - An object missing `capabilities` does **not** satisfy `AnalyticsProvider`
    (`@ts-expect-error`).
  - An object whose `track` takes `(event: string, payload, meta)` (the old
    shape) does **not** satisfy `AnalyticsProvider` (`@ts-expect-error`).
  - A minimal valid `AnalyticsProvider` (`name`, `capabilities`, `track`
    only, all optional methods omitted) type-checks with no error.
- Extend `src/schema.types.test.ts` (or a new
  `src/schema.canonicalEvent.types.test.ts`) with assertions that
  `TrackArgs<{ plan: "pro" }>` allows `[payload, options]`,
  `[payload]`, but not `[payload, options, extra]`
  (`@ts-expect-error`), and that `TrackArgs<undefined>` allows `[]`,
  `[undefined]`, `[undefined, options]`.

**Integration tests**: none required for this issue specifically beyond
what's already exercised by the repo's existing integration suite — this
is a pure types-and-noop-provider issue with no I/O. State explicitly in
the commit that no new integration test file is needed here because there
is no runtime/network behavior introduced; issues 002-005 each carry their
own integration test requirements once real behavior exists to integration
-test.

## Out of scope

- Any change to `createAnalytics()`'s runtime behavior, identity/session
  state, or the `Analytics<Events>` interface — issue 002.
- Any adapter changes (`packages/provider-*`) — issues 003-005.
- Multi-provider array support (`provider?: AnalyticsProvider[]`) — this is
  Phase 7 per `plan/ROADMAP.md`; do not add it here even though CLAUDE.md's
  decisions log already describes it as a resolved *design* decision — it
  is not yet an implemented one.
- `enable()`/`disable()` — explicitly deferred to the future Privacy/consent
  phase; do not add them to `AnalyticsProvider` or anywhere else.
- Middleware, routing, plugins, context auto-capture — later phases.
