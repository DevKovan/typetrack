# 001 -- `src/deprecation.ts`: deprecated-event types + pure resolution logic

## Context

New `src/deprecation.ts` module -- this phase's analog of `src/consent.ts`
(Phase 11), `src/routing.ts` (Phase 7), `src/middleware.ts` (Phase 8): a
dedicated, standalone, pure-functional module for this phase's own
vocabulary. Depends on nothing from `src/index.ts`; does not wire into
`createAnalytics()` yet -- that's issue 002. Zero vendor deps (per
CLAUDE.md's "zero vendor deps in core" rule).

This issue implements the locked design from
`plan/phase-15-validation-hardening/BRIEF.md`'s "Design decisions locked
for this phase" (decisions 1 and 2) exactly -- do not relitigate.

## Scope of this issue

Pure, standalone module -- no `createAnalytics()`/`src/index.ts` changes.

`src/deprecation.ts` exports:

- `DeprecatedEventInfo` -- the per-event-name config shape:
  ```ts
  export interface DeprecatedEventInfo {
    // The event name calls should be redirected to. When present, every
    // downstream use of the deprecated name (schema lookup,
    // `CanonicalEvent.name`, provider dispatch) uses this name instead --
    // see BRIEF.md Design decision 2. When absent, the event still fires
    // under its original name -- this entry only produces a warning.
    replacement?: string;
    // Freeform extra context appended to the default warning message
    // (e.g. "use userId from identify() instead of a custom property").
    message?: string;
    // Informational only, never enforced/compared against the current
    // date by this module -- purely surfaced in the warning text so a
    // human reading console output knows the retirement timeline.
    sunsetDate?: string;
  }
  ```
- `DeprecatedEventsMap` -- `Record<string, DeprecatedEventInfo>`. **Not**
  constrained by any `Events` generic -- see BRIEF.md Design decision 1
  for why (the map exists specifically to catch names outside an app's
  current, typed `Events` map).
- `ResolvedEventName` -- the return shape of `resolveDeprecatedEvent`:
  ```ts
  export interface ResolvedEventName {
    // The name to actually use downstream (schema lookup, CanonicalEvent,
    // provider dispatch). Equals the input `event` unchanged when the
    // event isn't in `deprecatedEvents` at all, or when it is but has no
    // `replacement`.
    name: string;
    // `true` iff `event` had a `deprecatedEvents` entry (regardless of
    // whether it also had a `replacement`) -- callers use this to decide
    // whether to warn at all.
    deprecated: boolean;
    // The original `DeprecatedEventInfo` entry, when `deprecated` is
    // `true` -- carried through so the caller can format a warning
    // without a second lookup.
    info?: DeprecatedEventInfo;
  }
  ```
- `resolveDeprecatedEvent(event: string, deprecatedEvents: DeprecatedEventsMap | undefined): ResolvedEventName`
  -- pure, never throws, never logs (logging is the wiring issue's job,
  since it owns the warn-once `Set`). `deprecatedEvents` undefined/missing
  the key both resolve to `{ name: event, deprecated: false }`. A matching
  entry with `replacement` resolves to `{ name: replacement, deprecated:
  true, info }`. A matching entry with no `replacement` resolves to
  `{ name: event, deprecated: true, info }`.
- `formatDeprecationWarning(originalEvent: string, info: DeprecatedEventInfo): string`
  -- pure string formatter, no `console` call inside this module (the
  wiring issue owns the actual `console.warn`, matching how
  `src/consent.ts`'s pure functions never log either). Produces a single
  line, e.g.:
  - No `replacement`, no `message`, no `sunsetDate`:
    `typetrack: event "checkout_started" is deprecated.`
  - With `replacement`:
    `typetrack: event "checkout_started" is deprecated -- use "Checkout Started" instead.`
  - With `sunsetDate` (appended regardless of `replacement`):
    `typetrack: event "checkout_started" is deprecated -- use "Checkout Started" instead. Planned removal: 2026-12-01.`
  - With `message` (appended last, regardless of the above):
    `typetrack: event "checkout_started" is deprecated -- use "Checkout Started" instead. Planned removal: 2026-12-01. Also drop the legacy "source" property -- it's unused downstream.`
  Exact separator/wording is the implementor's call as long as every
  supplied field is represented and the string starts with `typetrack:
  event "<name>" is deprecated` (tests should assert on substrings, not
  the exact full string, to avoid over-coupling tests to prose).

## Testing

Unit tests (`src/deprecation.test.ts`) covering: `resolveDeprecatedEvent`
for all 3 cases (not deprecated, deprecated no replacement, deprecated
with replacement) including `deprecatedEvents === undefined`;
`formatDeprecationWarning` for all field-combination cases above (absent
message/sunsetDate/replacement in every combination, not just the two
extremes). No integration test needed for this issue -- nothing wires
into `createAnalytics()` yet (issue 002 owns that, and its own
integration tests).

## Out of scope

Wiring into `src/index.ts`/`createAnalytics()` (issue 002). Any
`console.warn` call (issue 002 owns the warn-once `Set` and the actual
logging).
