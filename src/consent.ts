// Phase 11's consent vocabulary: types and pure gating/decision logic, plus
// best-effort browser privacy-signal detection (Do Not Track / Global
// Privacy Control). The Phase 11 analog of `src/routing.ts` (Phase 7),
// `src/middleware.ts` (Phase 8), `src/context.ts` (Phase 9), and
// `src/plugins.ts` (Phase 10): a dedicated, standalone, pure-functional
// module for this phase's own vocabulary. Depends on nothing from
// `src/index.ts`; does not wire into `createAnalytics()` yet -- that's
// issue 002.
//
// Zero vendor deps (per CLAUDE.md's "zero vendor deps in core" rule) -- the
// only import is `isBrowserEnvironment` from `src/context.ts`.
//
// Module boundary: this file owns only the type vocabulary and pure
// decision logic. It owns no mutable state (no `ConsentState` is
// created/mutated here) -- that's core's job (issue 002), mirroring how
// `src/routing.ts` and `src/middleware.ts` are pure/stateless until wired
// into `createAnalytics()`.
import { isBrowserEnvironment } from "./context";

// Freeform, not an enum -- not validated against at runtime. Conventional
// category names an app might use: "necessary", "analytics", "marketing",
// "functional".
export type ConsentCategory = string;

export type ConsentDecision = "granted" | "denied";

// Only contains entries for categories a caller has explicitly
// granted/denied (via `initialState` or `consent.grant()`/`.deny()`) -- a
// category never explicitly set is simply absent as a key, resolved
// against `defaultState` by `hasConsent()`, not defaulted into the map
// itself.
export type ConsentState = Record<ConsentCategory, ConsentDecision>;

// The public shape supplied to `createAnalytics({ consent })` (issue 002
// owns wiring this into `CreateAnalyticsOptions`; this issue only defines
// the type).
export interface ConsentOptions {
  // Documented/known categories for the app's own reference; purely
  // informational, never validated against at runtime (an app may
  // `grant()`/`deny()` a category not listed here without error).
  categories?: ConsentCategory[];
  // The decision applied to any category with no explicit entry in
  // `ConsentState`. Not defaulted by this type itself (that's
  // `resolveDefaultState`'s job) -- `undefined` here is a real, meaningful
  // "caller didn't specify" value.
  defaultState?: ConsentDecision;
  // Pre-seeds the consent state at construction (e.g. an app restoring a
  // previously-recorded choice from its own CMP/storage -- typetrack never
  // persists this itself).
  initialState?: ConsentState;
  // Categories that gate track/page/screen/identify/group/alias globally
  // (issue 002 wires the actual gating; `undefined`/`[]` here means no
  // global gate -- the six verbs are never blocked by consent state alone,
  // matching this phase's opt-in convention).
  requiredCategories?: ConsentCategory[];
  // When `true`, forces `defaultState` to `"denied"` for this instance if a
  // browser privacy opt-out signal (Do Not Track or Global Privacy Control)
  // is detected at construction time -- see `resolveDefaultState`. Never
  // overrides an explicit `initialState` entry for a category -- only
  // affects the *default* used for categories with no explicit prior
  // decision.
  respectBrowserSignals?: boolean;
}

// Pure, synchronous, never throws, never mutates its inputs.
export function hasConsent(
  state: ConsentState,
  category: ConsentCategory,
  defaultState: ConsentDecision,
): boolean {
  return (state[category] ?? defaultState) === "granted";
}

// `true` if `categories` is `undefined`/empty (vacuously satisfied -- no
// categories required means nothing to check), otherwise `true` only if
// every listed category resolves `granted` via `hasConsent`.
export function isConsentedForCategories(
  state: ConsentState,
  categories: ConsentCategory[] | undefined,
  defaultState: ConsentDecision,
): boolean {
  if (!categories || categories.length === 0) {
    return true;
  }
  return categories.every((category) => hasConsent(state, category, defaultState));
}

// Same vacuous-true-when-empty/undefined semantics as
// `isConsentedForCategories`, but takes a predicate function instead of a
// raw state + defaultState pair (issue 005 will call this from both
// `src/routing.ts`'s `shouldRouteToProvider` and `src/index.ts`'s
// identify/group/alias per-provider dispatch, both of which already have a
// closure-captured `hasConsent`-shaped function available -- this avoids
// threading `ConsentState`/`defaultState` across the module boundary a
// second time).
export function isConsentedForProvider(
  requiresConsent: ConsentCategory[] | undefined,
  hasConsentFn: (category: ConsentCategory) => boolean,
): boolean {
  if (!requiresConsent || requiresConsent.length === 0) {
    return true;
  }
  return requiresConsent.every((category) => hasConsentFn(category));
}

// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (core ships with zero DOM/browser-API surface in its own type-checking),
// so `navigator` isn't an ambient type here. Read off `globalThis` with a
// minimal ad-hoc shape, mirroring `src/context.ts`'s exact convention --
// this also happens to be exactly the shape a test needs to stub via
// `Object.defineProperty(globalThis, ...)` without any DOM test-environment
// dependency.
interface MinimalPrivacyNavigator {
  doNotTrack?: string;
  globalPrivacyControl?: boolean;
}

interface MinimalPrivacyGlobal {
  navigator?: MinimalPrivacyNavigator;
}

function privacyGlobal(): MinimalPrivacyGlobal {
  return globalThis as unknown as MinimalPrivacyGlobal;
}

// `true` iff, in a browser environment (reuses `isBrowserEnvironment()`
// from `src/context.ts`), either: `navigator.doNotTrack` is `"1"` or
// `"yes"` (covers the differing legacy DNT string values across browsers),
// or `navigator.globalPrivacyControl === true` (the GPC signal). Returns
// `false` outside a browser environment, and `false` (not throw) if
// reading either property itself throws. Best-effort, mirrors
// `src/context.ts`'s try/catch-never-throw convention exactly.
//
// DNT string handling: this covers `navigator.doNotTrack` only (`"1"`/
// `"yes"`), the two values relevant to currently-shipping browsers; the
// legacy `window`/`navigator.msDoNotTrack` variants are not covered
// (documented, not silently missed -- DNT itself is a soft, largely
// deprecated/unenforced signal; GPC is the actively-relevant one for
// CCPA).
export function detectBrowserPrivacySignal(): boolean {
  try {
    if (!isBrowserEnvironment()) {
      return false;
    }

    const navigator = privacyGlobal().navigator;
    const doNotTrack = navigator?.doNotTrack;
    if (doNotTrack === "1" || doNotTrack === "yes") {
      return true;
    }

    return navigator?.globalPrivacyControl === true;
  } catch {
    return false;
  }
}

// Resolves the single `ConsentDecision` issue 002 caches once at
// construction. Does not read `initialState`: it only resolves the
// *default* used for unlisted categories, never inspects which categories
// are already explicitly set -- that composition (explicit state wins,
// default only fills gaps) is `hasConsent`'s job via
// `state[category] ?? defaultState`, not something this function needs to
// know about.
export function resolveDefaultState(options: ConsentOptions | undefined): ConsentDecision {
  // Moot in practice since issue 002 never calls this when `consent` itself
  // is omitted, but keep the function total, never `undefined`-returning.
  if (!options) {
    return "denied";
  }

  if (options.respectBrowserSignals && detectBrowserPrivacySignal()) {
    return "denied";
  }

  return options.defaultState ?? "denied";
}
