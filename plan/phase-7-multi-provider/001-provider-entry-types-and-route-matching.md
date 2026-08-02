# 001 — `RouteMatcher`/`ProviderEntry` types, route matching, and deterministic sampling hash (`src/routing.ts`)

## Context

New `src/routing.ts` module — the Phase 7 analog of `src/schema.ts` for
Phase 6: a dedicated, standalone module for this phase's own vocabulary.
Depends on Phase 6's `CanonicalEvent` (`src/schema.ts`) and
`AnalyticsProvider` (`src/providers/index.ts`); does not depend on, and is
not consumed by, `src/index.ts` yet — this issue is purely additive and
pure-functional. `createAnalytics()`'s actual runtime behavior, and
`CreateAnalyticsOptions.provider`'s type, are **unchanged** until issue 003.

This issue implements the locked design from this phase's grill-me
interview exactly — do not relitigate:

- `ProviderEntry = { provider: AnalyticsProvider; include?: RouteMatcher[];
  exclude?: RouteMatcher[]; predicate?: (event: CanonicalEvent) => boolean;
  sampling?: number; priority?: number }`.
- `RouteMatcher = string | RegExp`. A plain string (no `*`) is an exact
  match against `event.name`; a string containing `*` is a glob, anchored
  at both ends, where `*` → `.*` and every other regex-special character
  is escaped literally; a `RegExp` instance is used as-is.
- Construction-time validation: an entry with both `include` and `exclude`
  defined (present at all, regardless of array length — even `[]`) is
  invalid and must throw synchronously.

## Design decisions made in this issue (narrow implementation gaps, not open architecture questions)

- **Bare-provider vs. wrapper discriminant**: at runtime, a value is treated
  as a `ProviderEntry` iff it has a `provider` property; otherwise it's a
  bare `AnalyticsProvider`. `AnalyticsProvider` never has a field named
  `provider`, so this discriminant is unambiguous.
- **Construction error type**: a synchronous, plain `Error` (not a new
  custom error class) — callers don't need structured programmatic fields
  here, just a clear message naming the offending provider (via
  `entry.provider.name`) and mentioning both "include" and "exclude".
- **`normalizeProviders` does not accept `undefined`** and does not own the
  `noopProvider` default — `createAnalytics()` (issue 003) keeps doing
  `options.provider ?? noopProvider` itself, exactly as today, before
  calling into this module.
- **Empty array (`provider: []`) is valid input**, not a construction
  error — normalizes to zero entries (`isMulti: true, entries: []`). A
  later issue's fan-out over zero entries is simply a no-op.
- **`NormalizedProviders.isMulti`** is a reusable pure predicate so issue
  003 doesn't reimplement "which mode" branching logic ad hoc.

## Acceptance criteria

`src/routing.ts` exports:

```ts
export type RouteMatcher = string | RegExp;

export interface ProviderEntry {
  provider: AnalyticsProvider;
  include?: RouteMatcher[];
  exclude?: RouteMatcher[];
  predicate?: (event: CanonicalEvent) => boolean;
  sampling?: number;
  priority?: number;
}

export interface NormalizedProviders {
  entries: ProviderEntry[];
  // true when the original input was an array (any length, including 0
  // or 1) or a lone `ProviderEntry` object; false only when the input was
  // a bare `AnalyticsProvider`. Drives the "single bare provider keeps
  // Phase 6 passthrough behavior" branch in issue 003.
  isMulti: boolean;
}

export function matchRoute(matcher: RouteMatcher, eventName: string): boolean;

export function normalizeProviders(
  provider: AnalyticsProvider | ProviderEntry | (AnalyticsProvider | ProviderEntry)[],
): NormalizedProviders; // throws a plain Error synchronously on an
                          // include+exclude conflict on any entry

// FNV-1a, 32-bit, operating on the UTF-8 bytes of `input`. Offset basis
// 2166136261 (0x811c9dc5), prime 16777619 (0x01000193), XOR-then-multiply
// variant, all arithmetic unsigned 32-bit. Returns a value in [0, 1) by
// dividing the raw 32-bit hash by 2**32.
export function hashToUnitInterval(input: string): number;

// True iff hashToUnitInterval(anonymousId) < samplingRate.
export function isSampledIn(anonymousId: string, samplingRate: number): boolean;
```

- `matchRoute`: exact-string case is a plain `===` comparison (case
  sensitive). Glob case: `*` becomes `.*`; every other regex metacharacter
  in the literal parts (`. + ? ^ $ { } ( ) | [ ] \`) is escaped; the
  resulting pattern is anchored (`^...$`). A bare `"*"` matches every
  event name, including the empty string (`page()`/`screen()` with no
  `name` produce `CanonicalEvent.name === ""` per Phase 6 — a matcher of
  `"*"` must still match that). `RegExp` instances are used exactly as
  given, including any flags the caller set.
- `normalizeProviders`: for each array element (or the single non-array
  value), determine bare-provider vs. wrapper per the discriminant above;
  wrap bare providers as `{ provider }`; leave `priority`/`include`/
  `exclude`/`predicate`/`sampling` exactly as given (do not default
  `priority` here — that's issue 002's job). Throw synchronously if both
  `include !== undefined` and `exclude !== undefined` on the same entry.
- `RouteMatcher`, `ProviderEntry` are exported types re-exported from
  `src/index.ts`'s public barrel (alongside the existing `CanonicalEvent`/
  `TrackOptions`/etc. re-exports). `NormalizedProviders`, `matchRoute`,
  `normalizeProviders`, `hashToUnitInterval`, `isSampledIn` stay internal
  (imported directly from `./routing`, not re-exported from the package's
  public entry point).

## Test requirements

Both unit and integration tests are required.

**Unit tests** (`src/routing.test.ts`, or split by concern):

- `matchRoute`: exact string match; glob prefix (`"checkout.*"` — literal
  `.` must be escaped, so `"checkoutXstarted"` must NOT match); glob
  suffix (`"*.completed"`); glob middle (`"order.*.completed"`); bare
  `"*"` matches everything including `""`; a `RegExp` with `/i` matches
  differently-cased names; a non-matching matcher returns `false`.
- `normalizeProviders`: bare `AnalyticsProvider` → `{ entries: [{
  provider }], isMulti: false }`; lone `ProviderEntry` → `{ entries:
  [thatEntry], isMulti: true }`; array of length 1 → `isMulti: true`;
  mixed bare/wrapper array normalizes each element correctly; `[]` → `{
  entries: [], isMulti: true }`; an entry with both `include` and
  `exclude` (including both `[]`) throws synchronously with a message
  containing the provider's `name` and the words "include"/"exclude"; an
  entry with only one of the two, or neither, does not throw.
- `hashToUnitInterval`: deterministic (same input → same output across
  repeated calls); always in `[0, 1)` across varied inputs; cross-check
  your implementation against an independently-computed FNV-1a-32 value
  for at least one fixed test string.
- `isSampledIn`: `isSampledIn(id, 0)` always `false`, `isSampledIn(id, 1)`
  always `true`, for any `id`; deterministic for a fixed `(id, rate)`
  pair; across ~1000 distinct UUID-shaped `anonymousId` values with
  `samplingRate = 0.5`, the fraction landing `true` falls within a loose
  tolerance band (e.g. 35%-65%).

**Integration tests** (`src/routing.integration.test.ts`): build a
realistic mixed `provider` input (2-3 hand-written stub
`AnalyticsProvider`s — one bare, one wrapped with `include: ["User Signed
Up", "check*"]`, one wrapped with `exclude: [/^debug\./]`), run it through
`normalizeProviders`, then for a handful of realistic event names (`"User
Signed Up"`, `"Checkout Started"`, `"debug.internal"`) manually combine
`matchRoute` over each entry's `include`/`exclude` and assert the combined
pass/fail outcome matches hand-computed expectations.

## Out of scope

- Any change to `src/index.ts` or `CreateAnalyticsOptions.provider`'s
  type — that's issue 003.
- Combining `include`/`exclude`/`predicate`/`sampling` into a single
  pass/fail decision function, and priority-based sorting — issue 002.
- Any runtime validation that `sampling` is within `[0, 1]` — out of
  range values are undefined behavior here, not tested.
- Adapter changes (GA4/PostHog/Segment) — none required or expected this
  phase.
