// Phase 7's routing vocabulary: which provider(s) a given `CanonicalEvent`
// should be sent to, and how to deterministically sample a fraction of
// events per provider. Depends on Phase 6's `CanonicalEvent` (`./schema`)
// and `AnalyticsProvider` (`./providers`), but is not consumed by
// `./index.ts` yet -- this module is purely additive and pure-functional
// until issue 003 wires it into `createAnalytics()`.
import type { CanonicalEvent } from "./schema";
import type { AnalyticsProvider } from "./providers";
import { isConsentedForProvider } from "./consent";
import type { ConsentCategory } from "./consent";

// A single routing matcher against `CanonicalEvent.name`. A plain string
// with no `*` is an exact (case-sensitive) match; a string containing `*`
// is a glob anchored at both ends; a `RegExp` instance is used as-is,
// including any flags the caller set.
export type RouteMatcher = string | RegExp;

// A provider plus optional per-provider routing/sampling knobs. Construction
// (via `normalizeProviders`) rejects an entry with both `include` and
// `exclude` defined (present at all, regardless of array length).
export interface ProviderEntry {
  provider: AnalyticsProvider;
  include?: RouteMatcher[];
  exclude?: RouteMatcher[];
  predicate?: (event: CanonicalEvent) => boolean;
  sampling?: number;
  priority?: number;
  // Phase 11 issue 005: categories this specific provider requires consent
  // for, independent of any global `requiredCategories` gate (issue 002).
  // `undefined`/`[]` means the provider has no consent requirement of its
  // own (vacuously always consented, per `isConsentedForProvider`). Only
  // expressible via the `ProviderEntry` shape -- a bare `AnalyticsProvider`
  // (the Phase-6 single-provider fast path) has no way to set this, exactly
  // like `include`/`exclude`/`sampling`/`priority` already require the same
  // `ProviderEntry` wrapping (or an array) to use.
  requiresConsent?: ConsentCategory[];
}

export interface NormalizedProviders {
  entries: ProviderEntry[];
  // true when the original input was an array (any length, including 0 or
  // 1) or a lone `ProviderEntry` object; false only when the input was a
  // bare `AnalyticsProvider`. Drives the "single bare provider keeps
  // Phase 6 passthrough behavior" branch in issue 003.
  isMulti: boolean;
}

// Regex metacharacters that must be escaped in the literal (non-`*`)
// portions of a glob `RouteMatcher` before being compiled into a `RegExp`.
const REGEX_SPECIAL_CHARS = /[.+?^${}()|[\]\\]/g;

function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .split("*")
    .map((part) => part.replace(REGEX_SPECIAL_CHARS, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`);
}

export function matchRoute(matcher: RouteMatcher, eventName: string): boolean {
  if (matcher instanceof RegExp) {
    return matcher.test(eventName);
  }
  if (matcher.includes("*")) {
    return globToRegExp(matcher).test(eventName);
  }
  return matcher === eventName;
}

// Discriminant: a value is a `ProviderEntry` iff it has a `provider`
// property; otherwise it's treated as a bare `AnalyticsProvider`.
// `AnalyticsProvider` never has a field named `provider`, so this is
// unambiguous.
function isProviderEntry(value: AnalyticsProvider | ProviderEntry): value is ProviderEntry {
  return "provider" in value;
}

function toProviderEntry(value: AnalyticsProvider | ProviderEntry): ProviderEntry {
  return isProviderEntry(value) ? value : { provider: value };
}

function assertNoIncludeExcludeConflict(entry: ProviderEntry): void {
  if (entry.include !== undefined && entry.exclude !== undefined) {
    throw new Error(
      `Provider "${entry.provider.name}" cannot specify both "include" and "exclude" -- use only one.`,
    );
  }
}

export function normalizeProviders(
  provider: AnalyticsProvider | ProviderEntry | (AnalyticsProvider | ProviderEntry)[],
): NormalizedProviders {
  if (Array.isArray(provider)) {
    const entries = provider.map(toProviderEntry);
    for (const entry of entries) {
      assertNoIncludeExcludeConflict(entry);
    }
    return { entries, isMulti: true };
  }

  if (isProviderEntry(provider)) {
    assertNoIncludeExcludeConflict(provider);
    return { entries: [provider], isMulti: true };
  }

  return { entries: [{ provider }], isMulti: false };
}

// FNV-1a, 32-bit, operating on the UTF-8 bytes of `input`. Offset basis
// 2166136261 (0x811c9dc5), prime 16777619 (0x01000193), XOR-then-multiply
// variant, all arithmetic unsigned 32-bit. Returns a value in [0, 1) by
// dividing the raw 32-bit hash by 2**32.
export function hashToUnitInterval(input: string): number {
  const bytes = new TextEncoder().encode(input);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 2 ** 32;
}

// True iff hashToUnitInterval(anonymousId) < samplingRate.
export function isSampledIn(anonymousId: string, samplingRate: number): boolean {
  return hashToUnitInterval(anonymousId) < samplingRate;
}

// Combines consent/include/exclude/predicate/sampling into one pass/fail
// decision for whether `entry.provider` should receive `event`. `include`
// and `exclude` are mutually exclusive by construction (enforced by
// `normalizeProviders`), so no redundant runtime check is done here. All
// applicable checks must pass (logical AND); short-circuits on the first
// failing check, which is unobservable since no check has side effects.
// Consent is checked first -- it's the cheapest check (a handful of map
// lookups via `hasConsentFn`) and the most likely to fail-fast in a
// denied-by-default configuration, so it's worth evaluating before the
// string-matching/predicate/sampling work below. `hasConsentFn` is a
// required (not optional/defaulted) parameter -- every caller must supply a
// closure that reads live consent state (e.g.
// `(category) => analytics.consent.hasConsent(category)`), never a
// snapshot, since consent can be granted/denied at any point in an
// instance's lifetime.
export function shouldRouteToProvider(
  entry: ProviderEntry,
  event: CanonicalEvent,
  hasConsentFn: (category: ConsentCategory) => boolean,
): boolean {
  if (!isConsentedForProvider(entry.requiresConsent, hasConsentFn)) {
    return false;
  }

  if (entry.include !== undefined) {
    if (!entry.include.some((matcher) => matchRoute(matcher, event.name))) {
      return false;
    }
  }

  if (entry.exclude !== undefined) {
    if (entry.exclude.some((matcher) => matchRoute(matcher, event.name))) {
      return false;
    }
  }

  if (entry.predicate !== undefined) {
    if (!entry.predicate(event)) {
      return false;
    }
  }

  if (entry.sampling !== undefined) {
    if (!isSampledIn(event.anonymousId, entry.sampling)) {
      return false;
    }
  }

  return true;
}

// Stable sort of `entries` by `priority` ascending (default 0), ties broken
// by original array position. Returns a new array; does not mutate `entries`.
export function sortByPriority(entries: ProviderEntry[]): ProviderEntry[] {
  return entries
    .map((entry, index) => ({ entry, priority: entry.priority ?? 0, index }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ entry }) => entry);
}
