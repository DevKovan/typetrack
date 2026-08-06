# 004 -- `schemaVersion` tag: instance-level tracking-plan version stamp

## Context

Independent of issues 001-003. Implements BRIEF.md Design decision 3
exactly -- a single instance-level tag, not a multi-version resolver.

Read `src/index.ts`'s `track()` `CanonicalEvent` construction (~line
1136-1145, specifically the `metadata: trackOptions?.metadata` line) and
`src/schema.ts`'s `CanonicalEvent`/`TrackOptions` interfaces in full
before starting.

## Scope of this issue

1. `CreateAnalyticsOptions` gains:
   ```ts
   // Phase 15 issue 004: an instance-level tracking-plan version tag,
   // stamped onto `metadata.schemaVersion` for every `track()` call.
   // Omitted entirely (the default) is zero behavior change from
   // pre-Phase-15: `metadata` stays exactly `trackOptions?.metadata`, no
   // `schemaVersion` key added. A caller's own explicit
   // `trackOptions.metadata.schemaVersion` always wins over this
   // instance-level default (same "call-site value beats instance
   // default" precedent as every other per-call override in this file --
   // e.g. `trackOptions?.priority ?? 0`).
   //
   // This is a single flat tag, not a per-event multi-version schema
   // resolver -- see `plan/phase-15-validation-hardening/BRIEF.md` Design
   // decision 3 for why, and for the additive-vs-breaking schema-evolution
   // discipline this tag is meant to support (bump this value when the
   // tracking plan as a whole cuts a new version; use Zod's own
   // `.optional()`/union primitives for additive field changes *within* a
   // version; use `deprecatedEvents` -- issues 001/002 -- for renames/
   // removals, never mutate what an existing field means in place).
   schemaVersion?: string | number;
   ```
2. Inside `createAnalytics()`, alongside `const schemas = options.schemas;`,
   add `const schemaVersion = options.schemaVersion;`.
3. In `track()`, replace the existing
   `metadata: trackOptions?.metadata,` line in the `CanonicalEvent`
   construction with:
   ```ts
   metadata:
     schemaVersion === undefined
       ? trackOptions?.metadata
       : { schemaVersion, ...trackOptions?.metadata },
   ```
   The `schemaVersion === undefined` branch preserves the exact
   pre-Phase-15 value (`trackOptions?.metadata`, including `undefined`
   when the caller passed neither) byte-for-byte when the option is
   unused -- no new object is ever allocated in that case. When
   `schemaVersion` is set, the spread order (`{ schemaVersion,
   ...trackOptions?.metadata }`) means an explicit
   `trackOptions.metadata.schemaVersion` from the caller overwrites the
   instance default, per the doc comment above.

## Non-goals / explicit exclusions

- No change to `page()`/`screen()` -- BRIEF.md scopes this to `track()`
  only, matching this phase's existing scope boundary for
  validation-related features (`page`/`screen` build a fixed internal
  event name, not an app-defined one; `schemaVersion` is meaningless for
  them the same way `schemas`-based validation already is).
- No new type for "schema version" beyond `string | number` -- no enum,
  no semver-parsing/comparison logic anywhere in `src/`. This tag is
  opaque to core; only the app/downstream consumers interpret it.

## Testing

Unit tests (`src/index.schemaVersion.test.ts`) covering: `schemaVersion`
omitted (default, `metadata` unchanged from pre-Phase-15 behavior,
including the `undefined`-when-nothing-passed case); `schemaVersion` set,
no `trackOptions.metadata` passed (`metadata` becomes `{ schemaVersion
}`); `schemaVersion` set, `trackOptions.metadata` passed with no
`schemaVersion` key of its own (merged, both keys present); `schemaVersion`
set, `trackOptions.metadata.schemaVersion` also explicitly passed (the
call-site value wins, per the doc comment).

No integration test needed beyond the unit coverage above -- this is a
single, local object-construction change with no cross-module
interaction (the resulting `CanonicalEvent` flows through the exact same
already-tested middleware/provider-dispatch path every other `track()`
call does).

## Out of scope

Any per-event or multi-version schema resolution (BRIEF.md Design
decision 3). Any change to `src/schema.ts`'s types.
