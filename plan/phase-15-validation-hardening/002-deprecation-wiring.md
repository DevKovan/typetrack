# 002 -- wire `deprecatedEvents` into `createAnalytics()`/`track()`

## Context

Depends on issue 001 (`src/deprecation.ts`) existing. This issue wires
that pure module into `src/index.ts`, following the exact precedent of
`warnedCapabilities`/`warnedAnonymousMode`: a `Set<string>` closure
variable owned by `createAnalytics()`, keyed so each distinct warning
fires at most once per instance lifetime.

Read `src/index.ts`'s `track()` implementation (~line 1092-1194) and the
`warnedAnonymousMode`/`warnedCapabilities` declarations/usage in full
before starting.

## Scope of this issue

1. `CreateAnalyticsOptions` (in `src/index.ts`) gains:
   ```ts
   // Phase 15 issue 002: opt-in deprecated-event handling for track().
   // Omitted entirely (the default) is zero behavior change from
   // pre-Phase-15: every event name is forwarded as given, no warning, no
   // redirect. See `src/deprecation.ts`'s `DeprecatedEventsMap` and
   // `plan/phase-15-validation-hardening/BRIEF.md` Design decision 2 for
   // the redirect-on-`replacement` behavior.
   deprecatedEvents?: DeprecatedEventsMap;
   ```
   Import `DeprecatedEventsMap`, `resolveDeprecatedEvent`,
   `formatDeprecationWarning` from `./deprecation`. Re-export
   `DeprecatedEventInfo`, `DeprecatedEventsMap` (types) from
   `src/index.ts`'s existing type re-export block (alongside
   `CanonicalEvent`/`EventMap`/etc., ~line 41).
2. Inside `createAnalytics()`, alongside the existing
   `warnedCapabilities`/`warnedAnonymousMode` closure declarations, add:
   ```ts
   const deprecatedEvents = options.deprecatedEvents;
   const warnedDeprecatedEvents = new Set<string>();
   ```
3. Inside `track()`, the resolution must happen **before** the dev-server
   mirror `fetch()` call and before the `schemas?.[event]` lookup (~line
   1102-1119) -- both the mirrored payload and the schema lookup must use
   the *resolved* name, per BRIEF.md Design decision 2. Concretely, insert
   immediately after the consent gate (`if (!isTrackingAllowed()) return
   undefined;`) and before the existing `const [rawPayload, trackOptions]
   = args ...` line stays where it is, but the resolution itself reads:
   ```ts
   const resolved = resolveDeprecatedEvent(event as string, deprecatedEvents);
   if (resolved.deprecated && !warnedDeprecatedEvents.has(event as string)) {
     warnedDeprecatedEvents.add(event as string);
     console.warn(formatDeprecationWarning(event as string, resolved.info!));
   }
   const resolvedEvent = resolved.name;
   ```
   The warn-once key is the **original** `event` name (not the resolved
   one) -- two different deprecated names that happen to redirect to the
   same replacement must each warn independently.
4. Every subsequent use of `event` inside `track()` that determines
   *what's actually sent* (the dev-server mirror's `body: JSON.stringify({
   event, ... })`, the `schemas?.[event]` lookup, and
   `canonicalEvent.name`) switches to `resolvedEvent`. The `event` value
   itself (the original, as typed by the caller) is not reassigned --
   introduce `resolvedEvent` as a new `const`, don't mutate `event` (which
   is a destructured function parameter here and reassigning parameters is
   already avoided elsewhere in this file).
5. `EventValidationError` thrown on a failed `schemas[resolvedEvent]`
   validation carries `resolvedEvent` as its `event` field (not the
   original pre-redirect name) -- the error is about the payload that was
   actually validated, which is keyed to the resolved schema.

## Non-goals / explicit exclusions

- `page()`/`screen()`/`identify()`/`group()`/`alias()` are unaffected --
  `deprecatedEvents` only applies to `track()`'s event-name parameter
  (`page`/`screen` use a fixed, non-app-defined event name internally;
  see `src/schema.ts`'s existing schema-validation scope, which is also
  `track()`-only).
- No change to `EventMap`/`SchemaMap`/`TrackArgs` typing -- this is
  runtime-only wiring; `deprecatedEvents`' keys are intentionally
  unconstrained by `Events` (issue 001, Design decision 1), so no generic
  parameter threading is needed here either.

## Testing

Unit tests (`src/index.deprecatedEvents.test.ts`, matching the existing
`src/index.schema.test.ts`/`src/index.onValidationError.test.ts` naming
convention) covering: no `deprecatedEvents` configured (zero behavior
change, no warning ever); a deprecated event with no `replacement` (warns
once across 2 calls with the same name, event still dispatched to the
provider under its original name, still validated against
`schemas[originalName]` if present); a deprecated event with a
`replacement` (warns once, provider receives the event under the
replacement name, `CanonicalEvent.name === replacement`, validated
against `schemas[replacement]` if present, *not* against
`schemas[originalName]` even if both exist); two distinct deprecated
names redirecting to the same replacement each warn independently (once
each, not deduped against each other).

Integration test (`src/index.deprecatedEvents.integration.test.ts`,
matching `src/index.schema.integration.test.ts`'s realism convention --
real `Events` map, real payloads, no internal-implementation reaching-in)
covering one realistic rename scenario end-to-end (e.g. `"checkout_started"`
deprecated in favor of `"Checkout Started"`, a stub provider recording
calls, assert the stub only ever sees `"Checkout Started"`).

## Out of scope

`validate` (issue 003) and `schemaVersion` (issue 004) -- independent
options, no interaction assumed between them and this issue's wiring
beyond both reading/writing the same `track()` function body (sequenced
by dependency order in BRIEF.md, not by any actual coupling).
