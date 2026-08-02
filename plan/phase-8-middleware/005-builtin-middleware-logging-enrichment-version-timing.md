# 005 — built-in `loggingMiddleware`, `enrichmentMiddleware`, `versionMiddleware`, `timingMiddleware`

## Context

Depends on issues 001-003 (full pipeline). Independent of issue 004 (no
shared code beyond the common `Middleware` type) — can be implemented in
parallel with or after issue 004; sequenced after here only for file
organization. Ships the remaining opt-in built-ins from `plan/VISION.md`'s
list as named exports from the package, following the same
never-auto-enabled convention as issue 004.

New files under `src/middleware/` (e.g. `logging.ts`, `enrichment.ts`,
`version.ts`, `timing.ts` — one file per middleware, or grouped if the
implementor judges a shared file simpler; match whatever organizational
choice issue 004 made).

### `loggingMiddleware`

Observability middleware — logs `before`/`after`/`onError` activity.

- Uses `before`, `after`, and `onError` hooks (this is the middleware most
  exercising all three hook types — good coverage for the examples issue
  to reference).
- Default sink is `console` (e.g. `console.log`/`console.warn` as
  appropriate); must accept a caller-supplied sink override (e.g. a `log:
  (message: string, data: unknown) => void` option) so apps can redirect
  to their own logger.
- Logs at minimum: event name + properties on `before` (pre-dispatch),
  a completion marker on `after` (post-dispatch), and the error + `ctx`
  on `onError`.
- Does not transform/drop the event — `before()` always returns the
  event unchanged (a pure observer).

```ts
export interface LoggingOptions {
  log?: (message: string, data?: unknown) => void;
}

export function loggingMiddleware(options?: LoggingOptions): Middleware;
```

### `enrichmentMiddleware`

Merges additional properties/context into the event.

- Accepts either a static object to merge, or a function computing values
  per-event (e.g. `(event) => Record<string, unknown>`), applied in
  `before()`.
- Configurable target: merge into `properties` (default) and/or
  `context`/`metadata` — same `targets` convention as issue 004's
  `redactMiddleware` for consistency, if reasonable.
- Must not clobber existing keys silently in a surprising way — document
  precedence (recommended: enrichment values fill in only if the key is
  absent, OR always override — pick one, document clearly, and be
  consistent; recommend "enrichment overrides" since that matches typical
  enrichment semantics of "always attach this computed context", but
  either is acceptable if documented).

```ts
export interface EnrichmentOptions {
  properties?: Record<string, unknown> | ((event: CanonicalEvent) => Record<string, unknown>);
  context?: Record<string, unknown> | ((event: CanonicalEvent) => Record<string, unknown>);
}

export function enrichmentMiddleware(options: EnrichmentOptions): Middleware;
```

### `versionMiddleware`

Injects app version/build metadata into every event — a specialized,
narrower case of enrichment worth its own named export per the brief's
explicit "version/build metadata injection" line item from
`plan/VISION.md`.

- Injects into `event.metadata` (not `properties`) — e.g. `{ appVersion,
  buildId }` — since this is infrastructure metadata, not
  application-domain event data.
- Static config only is sufficient (no need for a function form, unlike
  general enrichment) — version/build info is typically known at
  `createAnalytics()`-construction time.

```ts
export interface VersionOptions {
  appVersion?: string;
  buildId?: string;
}

export function versionMiddleware(options: VersionOptions): Middleware;
```

### `timingMiddleware`

Measures wall-clock time from `before` to `after` for each event.

- Must be meaningfully testable — use an injectable clock (e.g. an
  optional `now: () => number` option defaulting to `Date.now`), not a
  hard dependency on real wall-clock time, so tests can assert exact
  durations deterministically.
- Records the elapsed time somewhere observable: writing into
  `event.metadata.durationMs` on `after()` is one reasonable approach,
  but `after()`'s contract is `void` (no event-mutation return) per this
  phase's locked `Middleware` shape — so timing data cannot be written
  back into the dispatched event via `after()` (dispatch already
  happened before `after()` runs). Instead, expose the timing via a
  caller-supplied callback (e.g. `onTiming: (event, durationMs) => void`)
  invoked from `after()` — this is the correct shape given the locked
  `before`/`after`/`onError` contract; do not attempt to mutate the
  already-dispatched event.
- Must correctly pair each event's `before` timestamp with its own
  `after()` call, even under concurrent/interleaved `track()` calls (a
  closure keyed by event identity, not a single shared "last start time"
  variable — verify this doesn't break under concurrent calls in tests).

```ts
export interface TimingOptions {
  onTiming: (event: CanonicalEvent, durationMs: number) => void;
  now?: () => number;
}

export function timingMiddleware(options: TimingOptions): Middleware;
```

## Acceptance criteria

- All four middlewares exported from the package's public entry point.
- `loggingMiddleware`: default sink logs to `console`; custom `log`
  override is used instead when supplied; fires on `before`/`after`/
  `onError` with reasonable, documented message content; never
  transforms or drops the event.
- `enrichmentMiddleware`: static and function forms both work; merge
  precedence is documented and tested exactly as documented.
- `versionMiddleware`: injects configured fields into `event.metadata`
  without clobbering other existing `metadata` keys the app or an
  earlier middleware already set.
- `timingMiddleware`: `onTiming` callback receives the correct elapsed
  duration (deterministic given an injected `now`), correctly attributed
  per-event even when multiple `track()` calls overlap concurrently.
- None of the four auto-registers itself — every one requires an
  explicit `.use()` call.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (one file per middleware under `src/middleware/`):

- `loggingMiddleware`: default `console` sink invoked appropriately;
  custom `log` override receives the calls instead; `onError` path logs
  the error + `ctx`; event passes through unchanged.
- `enrichmentMiddleware`: static merge; function-form merge (assert the
  function receives the actual event); documented precedence behavior
  (whichever you chose) verified against a pre-existing conflicting key.
- `versionMiddleware`: fields land in `event.metadata`; existing
  `metadata` keys (set by the app or an earlier-registered middleware)
  survive alongside the injected ones.
- `timingMiddleware`: injected `now()` returning controlled values (e.g.
  `1000` at `before`, `1250` at `after`) yields `onTiming` called with
  `durationMs === 250`; two concurrent/interleaved `track()` calls each
  get their own correctly-paired duration (not cross-contaminated).

**Integration tests**
(`src/middleware/builtins2.integration.test.ts` or split per middleware):
construct `createAnalytics({ provider: [...] })`, `.use()` a realistic
combination (e.g. `versionMiddleware` + `enrichmentMiddleware` +
`timingMiddleware` + `loggingMiddleware` together), drive a realistic
`track()`/`page()` sequence, assert the provider stub's received events
carry the expected merged/injected fields and that `onTiming`/logging
side effects fired as expected across the sequence.

## Out of scope

- `redactMiddleware`, `samplingMiddleware` — issue 004.
- `examples/middleware/` — issue 006.
