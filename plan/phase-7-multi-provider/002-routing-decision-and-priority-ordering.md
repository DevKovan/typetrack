# 002 — routing decision (`shouldRouteToProvider`) and priority ordering (`sortByPriority`)

## Context

Depends on issue 001 (`ProviderEntry`, `matchRoute`, `isSampledIn` in
`src/routing.ts`). Adds the two pure functions issue 003 wires into
`createAnalytics()`: one combining `include`/`exclude`/`predicate`/
`sampling` into a single per-event, per-provider pass/fail decision, and
one sorting entries by `priority` for call-initiation order. Still no
change to `src/index.ts` — purely additive to `src/routing.ts`.

Locked design this issue implements:

- Routing (`include`/`exclude`/`predicate`/`sampling`) only ever applies
  to `track`/`page`/`screen` (the three verbs that build a
  `CanonicalEvent`) — `shouldRouteToProvider` takes a `CanonicalEvent` and
  is only ever called by issue 003 from those three verbs' dispatch paths.
- `include`/`exclude` are mutually exclusive per entry (already enforced
  at construction by issue 001) — at most one of the two is ever present
  on a given entry by the time this function runs.
- `predicate` and `sampling` both being set on the same entry combine with
  logical AND (both must pass for the provider to receive the event).
- `priority` is ordering-only, not exclusive: `sortByPriority` never drops
  entries, only reorders them. Default priority `0` when unset, lower
  runs first, ties broken by original array position (stable sort).

## Acceptance criteria

`src/routing.ts` gains:

```ts
// Combines include/exclude/predicate/sampling into one pass/fail
// decision for whether `entry.provider` should receive `event`.
export function shouldRouteToProvider(entry: ProviderEntry, event: CanonicalEvent): boolean;

// Stable sort of `entries` by `priority` ascending (default 0), ties
// broken by original array position. Does not mutate the input array.
export function sortByPriority(entries: ProviderEntry[]): ProviderEntry[];
```

- `shouldRouteToProvider` logic, in order:
  1. If `entry.include` is set: the event is routed only if `event.name`
     matches at least one matcher in `include` (OR across the array).
     Otherwise (no `include`) this step passes through.
  2. If `entry.exclude` is set: the event is routed only if `event.name`
     matches **none** of the matchers in `exclude`. Otherwise passes
     through. (Never both set — issue 001 already guarantees this at
     construction, but do not add a redundant runtime re-check here;
     trust the invariant.)
  3. If `entry.predicate` is set: `entry.predicate(event)` must return
     `true`.
  4. If `entry.sampling` is set: `isSampledIn(event.anonymousId,
     entry.sampling)` must return `true`.
  5. If none of `include`/`exclude`/`predicate`/`sampling` are set, the
     entry always routes (`true`) — a bare provider, or a wrapper with no
     routing config, receives every event.
  All applicable checks must pass (logical AND); the function short-
  circuits on the first failing check for efficiency but this must not be
  observable (no check has side effects).
- `sortByPriority`: `entries.map((e, i) => [e, e.priority ?? 0, i])`-style
  stable sort ascending on the resolved priority, ties resolved by the
  original index `i`. Returns a new array; input is untouched (verify via
  a test asserting the input array's element order is unchanged after the
  call).

## Test requirements

Both unit and integration tests are required.

**Unit tests** (`src/routing.decision.test.ts`, `src/routing.priority.test.ts`,
or extend the existing per-concern split from issue 001):

- `shouldRouteToProvider`:
  - No routing config → always `true`, for any event name/anonymousId.
  - `include: ["A", "B"]`, event name `"A"` → `true`; event name `"C"` →
    `false`.
  - `include: ["check*"]`, event name `"checkout_started"` → `true`;
    `"other"` → `false`.
  - `exclude: [/^debug\./]`, event name `"debug.internal"` → `false`;
    `"real_event"` → `true`.
  - `predicate` returning `false` blocks routing even with no
    `include`/`exclude`/`sampling` set; `predicate` returning `true` with
    no other config → `true`.
  - `predicate: () => true` combined with `sampling: 0` → `false` (AND
    semantics — predicate alone isn't sufficient).
  - `sampling: 1` combined with `predicate: () => false` → `false`.
  - `include` matching plus `sampling: 0` → `false` (include passing does
    not bypass sampling).
  - Verify `entry.predicate` receives the exact `CanonicalEvent` object
    passed in (assert via a predicate spy capturing its argument and
    comparing fields, or reference equality if issue 003's call site is
    expected to pass the same object — document whichever your
    implementation guarantees).
- `sortByPriority`:
  - Entries with priorities `[3, 1, 2]` sort to `[1, 2, 3]` order.
  - Entries with no `priority` set are treated as `0` and sort before
    entries with a positive priority.
  - Entries with equal/tied priority (including multiple entries all
    lacking `priority`) preserve their original relative array order.
  - The input array is not mutated (same element order before/after the
    call, checked by reference on the original array).

**Integration tests** (`src/routing.integration.test.ts`, extending issue
001's file or a new one): build a realistic multi-entry `ProviderEntry[]`
(3-4 entries mixing `include`, `exclude`, `predicate`, `sampling`,
`priority`, and one entry with no routing config at all), run several
realistic `CanonicalEvent`s (varying `name` and `anonymousId`) through
`sortByPriority` then `shouldRouteToProvider` for each sorted entry, and
assert both the resulting call order and the routed/skipped outcome per
provider match hand-computed expectations — this is the exact sequence
issue 003 will perform inside `track()`/`page()`/`screen()`.

## Out of scope

- Wiring these functions into `createAnalytics()` — issue 003.
- Any change to `src/index.ts`.
- Concurrent execution / `Promise.allSettled` — issue 003.
