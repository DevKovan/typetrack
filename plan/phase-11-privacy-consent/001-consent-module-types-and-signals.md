# 001 — `src/consent.ts`: consent types, pure gating logic, browser privacy-signal detection

## Context

New `src/consent.ts` module — the Phase 11 analog of `src/routing.ts`
(Phase 7), `src/middleware.ts` (Phase 8), `src/context.ts` (Phase 9), and
`src/plugins.ts` (Phase 10): a dedicated, standalone, pure-functional
module for this phase's own vocabulary. Depends on nothing from
`src/index.ts`; does not wire into `createAnalytics()` yet — that's issue
002. Zero vendor deps (per CLAUDE.md's "zero vendor deps in core" rule).

This issue implements the locked design from `plan/phase-11-privacy-consent/BRIEF.md`'s
"Design decisions locked for this phase" exactly — do not relitigate.

## Scope of this issue

Pure, standalone module — no `createAnalytics()`/`src/index.ts` changes,
no `src/routing.ts` changes (issue 005 owns that).

`src/consent.ts` exports:

- `ConsentCategory` — a type alias for `string`. Freeform, not an enum;
  document (as a comment, not enforced by the type) the conventional
  category names an app might use: `"necessary"`, `"analytics"`,
  `"marketing"`, `"functional"`.
- `ConsentDecision` — `"granted" | "denied"`.
- `ConsentState` — `Record<ConsentCategory, ConsentDecision>`. Only
  contains entries for categories a caller has explicitly granted/denied
  (via `initialState` or `consent.grant()`/`.deny()`) — a category never
  explicitly set is simply absent as a key, resolved against
  `defaultState` by `hasConsent()`, not defaulted into the map itself.
- `ConsentOptions` — the public shape supplied to
  `createAnalytics({ consent })` (issue 002 owns wiring this into
  `CreateAnalyticsOptions`; this issue only defines the type):
  - `categories?: ConsentCategory[]` — documented/known categories for the
    app's own reference; purely informational, never validated against at
    runtime (an app may `grant()`/`deny()` a category not listed here
    without error).
  - `defaultState?: ConsentDecision` — the decision applied to any
    category with no explicit entry in `ConsentState`. Not defaulted by
    this type itself (that's `resolveDefaultState`'s job, see below) —
    `undefined` here is a real, meaningful "caller didn't specify" value.
  - `initialState?: ConsentState` — pre-seeds the consent state at
    construction (e.g. an app restoring a previously-recorded choice from
    its own CMP/storage — typetrack never persists this itself, see
    design decision 5 in BRIEF.md).
  - `requiredCategories?: ConsentCategory[]` — categories that gate
    `track`/`page`/`screen`/`identify`/`group`/`alias` globally (issue
    002 wires the actual gating; `undefined`/`[]` here means no global
    gate — the six verbs are never blocked by consent state alone,
    matching this phase's opt-in convention).
  - `respectBrowserSignals?: boolean` — when `true`, forces
    `defaultState` to `"denied"` for this instance if a browser privacy
    opt-out signal (Do Not Track or Global Privacy Control) is detected at
    construction time — see `resolveDefaultState` below. Never overrides
    an explicit `initialState` entry for a category — only affects the
    *default* used for categories with no explicit prior decision.
- `hasConsent(state: ConsentState, category: ConsentCategory, defaultState: ConsentDecision): boolean`
  — `(state[category] ?? defaultState) === "granted"`. Pure, never throws.
- `isConsentedForCategories(state: ConsentState, categories: ConsentCategory[] | undefined, defaultState: ConsentDecision): boolean`
  — `true` if `categories` is `undefined`/empty (vacuously satisfied — no
  categories required means nothing to check), otherwise `true` only if
  every listed category resolves `granted` via `hasConsent`.
- `isConsentedForProvider(requiresConsent: ConsentCategory[] | undefined, hasConsentFn: (category: ConsentCategory) => boolean): boolean`
  — same vacuous-true-when-empty/undefined semantics as
  `isConsentedForCategories`, but takes a predicate function instead of a
  raw state + defaultState pair (issue 005 will call this from both
  `src/routing.ts`'s `shouldRouteToProvider` and `src/index.ts`'s
  identify/group/alias per-provider dispatch, both of which already have
  a closure-captured `hasConsent`-shaped function available — this avoids
  threading `ConsentState`/`defaultState` across the module boundary a
  second time).
- `detectBrowserPrivacySignal(): boolean` — `true` iff, in a browser
  environment (reuse `isBrowserEnvironment()` from `src/context.ts` — do
  not reimplement the check), either: `navigator.doNotTrack` is `"1"` or
  `"yes"` (covers the differing legacy DNT string values across
  browsers), or `navigator.globalPrivacyControl === true` (the GPC
  signal). Returns `false` outside a browser environment, and `false` (not
  throw) if reading either property itself throws. Best-effort, mirrors
  `src/context.ts`'s try/catch-never-throw convention exactly.
- `resolveDefaultState(options: ConsentOptions | undefined): ConsentDecision`
  — resolves the single `ConsentDecision` issue 002 caches once at
  construction: if `options` is `undefined`, returns `"denied"` (moot in
  practice since issue 002 never calls this when `consent` itself is
  omitted, but keep the function total, never `undefined`-returning). If
  `options.respectBrowserSignals` is `true` and `detectBrowserPrivacySignal()`
  is `true`, returns `"denied"` unconditionally (overrides any configured
  `options.defaultState`). Otherwise returns `options.defaultState ?? "denied"`.

## Design decisions made in this issue (narrow implementation gaps, not open architecture questions)

- **Module boundary**: `src/consent.ts` owns only the type vocabulary and
  pure decision logic. It owns no mutable state (no `ConsentState` is
  created/mutated here) — that's core's job (issue 002), mirroring how
  `src/routing.ts` and `src/middleware.ts` are pure/stateless until wired
  into `createAnalytics()`.
- **DNT string handling**: `navigator.doNotTrack` has historically been
  `"1"`, `"yes"`, or (rarely, old IE-style) exposed on `window.doNotTrack`/
  `navigator.msDoNotTrack` instead — this issue covers `navigator.doNotTrack`
  only (`"1"`/`"yes"`), the two values relevant to currently-shipping
  browsers; the legacy `window`/`msDoNotTrack` variants are not covered
  (documented, not silently missed — DNT itself is a soft, largely
  deprecated/unenforced signal; GPC is the actively-relevant one for CCPA).
- **`resolveDefaultState` does not read `initialState`**: it only resolves
  the *default* used for unlisted categories, never inspects which
  categories are already explicitly set — that composition (explicit state
  wins, default only fills gaps) is `hasConsent`'s job via `state[category] ?? defaultState`,
  not something `resolveDefaultState` needs to know about.

## Acceptance criteria

- `src/consent.ts` exists, exports exactly the surface described above,
  zero runtime dependencies beyond `src/context.ts`'s `isBrowserEnvironment`.
- `hasConsent`/`isConsentedForCategories`/`isConsentedForProvider` are pure,
  synchronous, never throw, and never mutate their inputs.
- `isConsentedForCategories(state, undefined, "denied")` and
  `isConsentedForCategories(state, [], "denied")` both return `true`
  regardless of `state`'s contents (vacuous case).
- `isConsentedForProvider(undefined, fn)` and `isConsentedForProvider([], fn)`
  both return `true` without ever invoking `fn`.
- `detectBrowserPrivacySignal()` returns `false` in the default (non-DOM)
  Bun test environment; returns `true` when a stubbed `navigator.doNotTrack`
  is `"1"` or `"yes"`; returns `true` when a stubbed
  `navigator.globalPrivacyControl` is `true`; returns `false` when neither
  is set; never throws when `navigator` itself is stubbed to throw on
  property access.
- `resolveDefaultState(undefined)` returns `"denied"`.
- `resolveDefaultState({})` returns `"denied"`.
- `resolveDefaultState({ defaultState: "granted" })` returns `"granted"`.
- `resolveDefaultState({ defaultState: "granted", respectBrowserSignals: true })`
  returns `"denied"` when a browser privacy signal is stubbed present, and
  `"granted"` when absent.

## Test requirements

Unit tests only (`src/consent.test.ts`) — this module has no I/O beyond
reading browser globals, nothing meaningful to integration-test in
isolation (issue 002's integration tests cover the wired-in behavior).

- `hasConsent`/`isConsentedForCategories`/`isConsentedForProvider` — every
  branch described in Acceptance criteria, plus a multi-category case
  where one of several required categories is denied (expect `false`).
- `detectBrowserPrivacySignal` — all branches listed above, via stubbed
  `globalThis.window`/`navigator` (reuse the exact stubbing technique
  `src/context.test.ts` already established).
- `resolveDefaultState` — all four combinations of `defaultState` set/unset
  crossed with `respectBrowserSignals` true/false (with the signal itself
  stubbed present/absent).

## Out of scope

- Any change to `src/index.ts`, `CreateAnalyticsOptions`, or the
  `Analytics` interface — issues 002/003.
- Mutable consent state, `analytics.consent`'s grant/deny/get runtime API —
  issue 002.
- `ProviderEntry.requiresConsent`, wiring into `src/routing.ts` — issue 005.
- `enable()`/`disable()` — issue 003.
- `examples/` — issue 008.
