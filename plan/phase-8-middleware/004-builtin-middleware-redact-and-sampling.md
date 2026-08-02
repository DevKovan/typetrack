# 004 — built-in `redactMiddleware` and `samplingMiddleware`

## Context

Depends on issues 001-003 (full middleware pipeline, including `onError`
wiring, landed and passing QA). This issue ships the first two opt-in
built-in middlewares from `plan/VISION.md`'s list, as named exports from
the package (apps import and `.use()` them explicitly — **never**
auto-enabled by `createAnalytics()`).

New file: `src/middleware/redact.ts` and `src/middleware/sampling.ts` (or
a single `src/middleware/builtins.ts` if the implementor judges that
simpler for two small middlewares — your call, but keep each middleware's
logic clearly separated and independently testable either way). Re-export
both from the package's public barrel (`src/index.ts`).

### `redactMiddleware`

Redacts configured fields from `event.properties` (and optionally
`event.context`/`event.metadata` if the caller opts in) before the event
reaches any provider. Locked requirements:

- Configurable list of field paths to redact (support at minimum
  top-level property keys, e.g. `["email", "phone"]`; dotted paths for
  nested objects, e.g. `"user.ssn"`, are a reasonable stretch goal but not
  mandatory — state clearly in your implementation which you support).
- Redacts by **replacing the value** (e.g. with a fixed `"[REDACTED]"`
  string, or a caller-supplied replacement function/value) — does not
  delete the key structurally unless the caller explicitly configures a
  "remove" mode. Default behavior must be documented precisely in a doc
  comment.
- Runs in `before()` only (no `after()`/`onError()` needed for this
  middleware).
- Must not throw on a configured field path that doesn't exist in the
  event (no-op for that path).

Suggested shape (adjust as needed, keep it clean and typed):

```ts
export interface RedactOptions {
  fields: string[];
  replacement?: unknown | ((fieldPath: string, value: unknown) => unknown);
  targets?: ("properties" | "context" | "metadata")[]; // default: ["properties"]
}

export function redactMiddleware(options: RedactOptions): Middleware;
```

### `samplingMiddleware`

Implements the phase's locked global pre-dispatch sampling layer,
distinct from Phase 7's per-provider `ProviderEntry.sampling`:

- **Must reuse** `hashToUnitInterval`/`isSampledIn` from `src/routing.ts`
  — do not reimplement the hash function. Import them directly.
- Keyed on `event.anonymousId`, exactly like the per-provider mechanism,
  for consistent sampling semantics across both layers.
- Drops the event (returns `undefined` from `before()`) when
  `!isSampledIn(event.anonymousId, rate)`; passes the event through
  unchanged otherwise.
- Runs in `before()` only.

```ts
export interface SamplingOptions {
  rate: number; // [0, 1]
}

export function samplingMiddleware(options: SamplingOptions): Middleware;
```

Document the two-layer distinction clearly in this middleware's doc
comment: this is a **global, pre-dispatch, one-time-per-event** drop that
happens before any provider or routing evaluation even runs; it is
independent of and composable with Phase 7's `ProviderEntry.sampling`
(a **per-provider** gate evaluated later, inside `shouldRouteToProvider`,
after this middleware has already decided whether the event survives at
all). An event that passes `samplingMiddleware` can still be excluded
from an individual provider by that provider's own `ProviderEntry
.sampling`; an event dropped by `samplingMiddleware` never reaches
routing evaluation for *any* provider.

## Acceptance criteria

- Both middlewares exported from the package's public entry point
  (`import { redactMiddleware, samplingMiddleware } from "typetrack"`).
- `redactMiddleware`: configured fields are replaced (not left intact) in
  the event delivered to providers; unconfigured fields pass through
  unchanged; a missing configured field path does not throw.
- `samplingMiddleware`: dropped/kept decision is deterministic for a
  fixed `(anonymousId, rate)` pair across repeated calls; `rate: 0`
  always drops, `rate: 1` always keeps; uses the exact same hash function
  as `src/routing.ts`'s `isSampledIn` (assert cross-consistency: same
  `anonymousId` and `rate` produce the same in/out decision whether
  evaluated via `samplingMiddleware` or directly via
  `ProviderEntry.sampling`, since both call the identical underlying
  function).
- Neither middleware auto-registers itself anywhere in `createAnalytics()`
  — both require an explicit `.use()` call by the app.
- Doc comments on both explain the "why" (redaction replace-vs-remove
  default; sampling's two-layer distinction from `ProviderEntry
  .sampling`) clearly enough that `examples/middleware/` (issue 006) can
  link to/paraphrase them.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (`src/middleware/redact.test.ts`,
`src/middleware/sampling.test.ts`):

- `redactMiddleware`: configured field replaced with default/custom
  replacement; unconfigured fields untouched; missing field path is a
  no-op (no throw); (if implemented) nested dotted-path redaction.
- `samplingMiddleware`: deterministic same-input-same-output; `rate: 0`
  → always dropped (test ~50 distinct anonymousIds, all dropped); `rate:
  1` → always kept; a fixed `(anonymousId, rate)` pair matches the
  in/out decision independently computed via `isSampledIn` directly
  (cross-check, not a coincidence of implementation).

**Integration tests**
(`src/middleware/builtins.integration.test.ts` or split per middleware):
construct `createAnalytics({ provider: [...] })`, `.use(redactMiddleware
({...}))` and/or `.use(samplingMiddleware({...}))`, drive realistic
`track()` calls with PII-shaped payloads and varying `anonymousId`s
(via multiple `createAnalytics()` instances, since `anonymousId` isn't
settable post-construction — mirrors Phase 7's example-testing pattern),
assert the provider stub's received events reflect redaction and that
the sampled-out instance's provider never receives calls while the
sampled-in instance's does, consistently across repeated calls.

## Out of scope

- `loggingMiddleware`, `enrichmentMiddleware`, `versionMiddleware`,
  `timingMiddleware`/tracing — issue 005.
- `examples/middleware/` — issue 006.
- Any change to `src/routing.ts`'s existing `ProviderEntry.sampling`
  behavior — untouched by this phase.
