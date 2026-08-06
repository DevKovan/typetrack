// Phase 15's deprecated-event vocabulary: types and pure resolution/
// formatting logic. The Phase 15 analog of `src/consent.ts` (Phase 11),
// `src/routing.ts` (Phase 7), `src/middleware.ts` (Phase 8): a dedicated,
// standalone, pure-functional module for this phase's own vocabulary.
// Depends on nothing from `src/index.ts`; does not wire into
// `createAnalytics()` yet -- that's issue 002.
//
// Zero vendor deps (per CLAUDE.md's "zero vendor deps in core" rule).
//
// Module boundary: this file owns only the type vocabulary and pure
// resolution/formatting logic. It never logs (no `console` call anywhere in
// this module) and never mutates its inputs -- the wiring issue (002) owns
// the warn-once `Set<string>` and the actual `console.warn` call, mirroring
// how `src/consent.ts`'s pure functions never log either.

// The per-event-name config shape supplied via `createAnalytics({
// deprecatedEvents })` (issue 002 owns wiring this option into
// `CreateAnalyticsOptions`; this issue only defines the type).
export interface DeprecatedEventInfo {
  // The event name calls should be redirected to. When present, every
  // downstream use of the deprecated name (schema lookup,
  // `CanonicalEvent.name`, provider dispatch) uses this name instead -- see
  // BRIEF.md Design decision 2. When absent, the event still fires under
  // its original name -- this entry only produces a warning.
  replacement?: string;
  // Freeform extra context appended to the default warning message (e.g.
  // "use userId from identify() instead of a custom property").
  message?: string;
  // Informational only, never enforced/compared against the current date by
  // this module -- purely surfaced in the warning text so a human reading
  // console output knows the retirement timeline.
  sunsetDate?: string;
}

// Not constrained by any `Events` generic -- see BRIEF.md Design decision 1
// for why: the whole point of this map is to catch calls using a name that
// has already been removed from an app's current, typed `Events` map (or a
// raw JS caller with no compile-time check at all) -- constraining its keys
// to `keyof Events` would make it impossible to name the exact strings it
// exists to catch.
export type DeprecatedEventsMap = Record<string, DeprecatedEventInfo>;

// The return shape of `resolveDeprecatedEvent`.
export interface ResolvedEventName {
  // The name to actually use downstream (schema lookup, `CanonicalEvent`,
  // provider dispatch). Equals the input `event` unchanged when the event
  // isn't in `deprecatedEvents` at all, or when it is but has no
  // `replacement`.
  name: string;
  // `true` iff `event` had a `deprecatedEvents` entry (regardless of
  // whether it also had a `replacement`) -- callers use this to decide
  // whether to warn at all.
  deprecated: boolean;
  // The original `DeprecatedEventInfo` entry, when `deprecated` is `true` --
  // carried through so the caller can format a warning without a second
  // lookup.
  info?: DeprecatedEventInfo;
}

// Pure, never throws, never logs. `deprecatedEvents` undefined, or missing
// the `event` key, both resolve to `{ name: event, deprecated: false }`. A
// matching entry with `replacement` resolves to `{ name: replacement,
// deprecated: true, info }`. A matching entry with no `replacement`
// resolves to `{ name: event, deprecated: true, info }`.
export function resolveDeprecatedEvent(
  event: string,
  deprecatedEvents: DeprecatedEventsMap | undefined,
): ResolvedEventName {
  const info = deprecatedEvents?.[event];

  if (!info) {
    return { name: event, deprecated: false };
  }

  return {
    name: info.replacement ?? event,
    deprecated: true,
    info,
  };
}

// Pure string formatter, no `console` call inside this module (the wiring
// issue owns the actual `console.warn`, matching how `src/consent.ts`'s
// pure functions never log either). Produces a single line always starting
// with `typetrack: event "<originalEvent>" is deprecated`, followed by
// `-- use "<replacement>" instead` when `info.replacement` is present, then
// `Planned removal: <sunsetDate>.` when `info.sunsetDate` is present, then
// `info.message` appended last, when present.
export function formatDeprecationWarning(
  originalEvent: string,
  info: DeprecatedEventInfo,
): string {
  let message = `typetrack: event "${originalEvent}" is deprecated`;

  if (info.replacement) {
    message += ` -- use "${info.replacement}" instead`;
  }

  message += ".";

  if (info.sunsetDate) {
    message += ` Planned removal: ${info.sunsetDate}.`;
  }

  if (info.message) {
    message += ` ${info.message}`;
  }

  return message;
}
