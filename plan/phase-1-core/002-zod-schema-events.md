# 002 — Optional per-event Zod schemas with `z.infer`-derived types and runtime validation

## Context

Depends on: `001-typed-event-map-track.md` (the `Events`/`EventMap` generic on `track()` must exist first).

The phase goal requires that callers may *optionally* supply a Zod schema per event instead of, or alongside, a hand-written payload type — and that the payload type for a schema-backed event must be derived via `z.infer`, never hand-declared separately (single source of truth). At runtime, if a schema exists for the event being tracked, it must actually be run against the payload before the call reaches the provider.

Zod is a schema/validation library, not a vendor analytics SDK, so it is explicitly exempt from the "zero vendor deps in core" rule in `CLAUDE.md` (that rule targets provider/vendor SDKs like PostHog/Segment client libraries, not validation libraries) — confirmed with the user's task instructions for this phase.

### Design decisions made here (research-backed)

- **Dependency type**: `zod` is added as an **optional peerDependency**, range `^4.0.0`, plus a matching `devDependency` (pinned to the current latest at implementation time — verify against the npm registry, do not assume a stale version) for local dev/typecheck/test. This follows Zod's own published guidance for library authors (peerDependency, not a bundled dependency, so consumers control their own Zod version) — made optional via `peerDependenciesMeta.zod.optional = true` because per-event schemas are opt-in; a `typetrack` consumer who never uses `schemas` should not be forced to install Zod.
  - `package.json` changes: add `"zod": "^4.0.0"` under `peerDependencies`, `"zod": { "optional": true }` under `peerDependenciesMeta`, and a pinned current version under `devDependencies`.
- **Zod version/API assumed**: v4 line. `z.infer<typeof schema>` (unchanged from v3), `.safeParse()` returns `{ success: true, data } | { success: false, error: ZodError }`. Implementor should re-verify the installed version's exact API against `https://zod.dev/api` if anything below doesn't typecheck, since this is a fast-moving library.
- **API shape — `schemas` option**:
  ```ts
  type SchemaMap<Events extends EventMap> = {
    [K in keyof Events]?: z.ZodType<Events[K]>;
  };

  interface CreateAnalyticsOptions<Events extends EventMap> {
    provider?: AnalyticsProvider;
    schemas?: SchemaMap<Events>;
  }
  ```
  `schemas` is a **partial** map — a caller may supply a Zod schema for some events only ("alongside" plain hand/derived TS types for the rest); events without a `schemas` entry get no runtime validation, only the compile-time check from issue 001.
- **One-source-of-truth mechanism**: export a helper mapped type `InferEvents<S extends Record<string, z.ZodType>> = { [K in keyof S]: z.infer<S[K]> }` from `src/index.ts` (or `src/schema.ts`). Recommended usage pattern (document in the issue/tests, not necessarily in README):
  ```ts
  const eventSchemas = {
    signup_completed: z.object({ plan: z.enum(["free", "pro"]) }),
    page_viewed: z.undefined(),
  } satisfies Record<string, z.ZodType>;

  type Events = InferEvents<typeof eventSchemas>;

  const analytics = createAnalytics<Events>({ schemas: eventSchemas });
  ```
  This means the payload shape is written exactly once (inside the Zod schema); `Events` is *derived*, never hand-declared redundantly. Because `schemas[K]: z.ZodType<Events[K]>` is enforced by the `SchemaMap` constraint, mismatches between a hand-written `Events` map (from issue 001, if a caller chooses not to use `InferEvents`) and a supplied schema's inferred output are still caught at compile time.
- **What gets forwarded to the provider**: the *validated/parsed* output (`safeParse(...).data`), not the raw input payload — so any Zod `.transform()`/`.default()` effects are honored downstream. For events without a schema entry, the raw payload passes through unchanged (as today).
- **Default failure behavior (this issue only ships the default; configurability is 003)**: if validation fails, `track()` throws synchronously. Throw a new exported `EventValidationError` (extends `Error`), carrying at minimum the event name, the original payload, and the Zod validation issues (e.g. `error.issues` from the `ZodError`, or the whole `ZodError` itself). The provider is **not** called when validation fails. Rationale: since the payload already satisfies TypeScript at compile time, a runtime failure means the caller bypassed type-checking (e.g. `any`, JS caller, external/dynamic data) — this is a real bug worth surfacing loudly by default, consistent with Zod's own default `.parse()`-throws convention. (Issue 003 adds an opt-out.)

## Acceptance criteria

- [ ] `zod` added to `package.json` as described above (optional peerDependency `^4.0.0` + devDependency), and `bun install` succeeds.
- [ ] `SchemaMap<Events>` type and `InferEvents<S>` type are exported as public types from `typetrack`.
- [ ] `CreateAnalyticsOptions<Events>` gains an optional `schemas` field typed as `SchemaMap<Events>`.
- [ ] `EventValidationError` is exported, extends `Error`, and exposes at least the event name and the Zod error/issues.
- [ ] At runtime, `track(event, payload)`:
  - if `schemas[event]` exists: runs `safeParse` (or equivalent) against `payload`; on success, forwards the **parsed** data (not the raw input) to `provider.track()`; on failure, throws `EventValidationError` synchronously and does *not* call `provider.track()`.
  - if `schemas[event]` does not exist (or `schemas` wasn't supplied at all): behaves exactly as in issue 001 (raw payload forwarded, no validation).
- [ ] A supplied `schemas[K]`'s inferred type (`z.infer`) must be compile-time compatible with `Events[K]`; the `SchemaMap` type constraint enforces this without any hand-duplicated type declaration being required from the caller when using `InferEvents`.
- [ ] `identify()`/`page()` remain unaffected by `schemas` (no validation on traits/props in this issue — see Out of scope).

## Test requirements

**Unit tests**:
- `InferEvents<typeof someSchemaObject>` produces the same type as manually writing the equivalent `Events` interface (type-level test, e.g. via a helper `Expect<Equal<A, B>>` pattern or `// @ts-expect-error` around a deliberately-wrong assignment).
- Unit test that a valid payload for a schema-backed event results in `provider.track` receiving the *parsed* data (e.g. demonstrate a Zod `.transform()` or `.default()` actually taking effect in the forwarded payload, proving parsed-not-raw data is passed through).
- Unit test that an event without a `schemas` entry is passed through unvalidated (raw payload forwarded byte-for-byte, even if it wouldn't satisfy some other event's schema).
- Unit test that `EventValidationError` carries the event name and the underlying Zod issues.

**Integration test**:
- End-to-end test: `createAnalytics<Events>({ provider: realTestProvider, schemas: eventSchemas })` where `eventSchemas` is a real `z.object({...})` (not mocked) with at least one required field and one refinement (e.g. `z.string().min(1)`), covering:
  - a valid `track()` call reaches the real test provider with correctly validated/parsed data.
  - an invalid `track()` call (e.g. missing required field, or a field failing a Zod refinement) throws `EventValidationError` and the test provider's `track` is confirmed **not** called (via a mock/spy assertion).
  - a mixed `Events` map where one event has a `schemas` entry and another doesn't, confirming only the schema-backed event is validated.

## Out of scope

- Configurable/overridable validation-failure behavior (`onValidationError`, non-throwing modes) — issue 003.
- Validating `identify()` traits or `page()` props against Zod schemas — not requested by the phase goal; only `track()` event payloads are Zod-validated in Phase 1.
- Async Zod schemas (`.parseAsync`/`.safeParseAsync`, refinements requiring `async`) — only synchronous `safeParse` is required for Phase 1; if the implementor judges async support is trivially free, it may be included, but it is not required and should not block this issue.
- Any change to `AnalyticsProvider`'s shape.
- Publishing/README documentation of the Zod usage pattern (a follow-up docs task, not required for this issue's acceptance).
