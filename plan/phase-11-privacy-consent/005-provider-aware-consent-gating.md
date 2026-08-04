# 005 — Provider-aware consent gating: `ProviderEntry.requiresConsent`

## Context

Depends on issue 001 (`isConsentedForProvider`) and issue 002
(`analytics.consent.hasConsent`, and the fact that consent state exists
and is queryable independent of a global `requiredCategories` gate). This
is the ROADMAP's "provider-aware consent gating" line: even when the
global gate (issue 002) passes or isn't configured, an individual provider
can require its own specific categories — e.g. an "analytics" provider
that only needs `"analytics"` consent, alongside a "marketing" pixel
provider in the same fan-out list that needs `"marketing"` consent, so
denying one doesn't block the other.

Read `src/routing.ts` in full before starting. Phase 7 deliberately scoped
`shouldRouteToProvider` (include/exclude/predicate/sampling) to `track`/
`page`/`screen` only — `identify`/`group`/`alias` always fan out
unconditionally to every provider, with no routing evaluation at all. This
issue **partially revisits that Phase 7 decision**, for consent reasons
specifically: `identify`/`group`/`alias` calls can carry a `userId`/traits
that are exactly the kind of data a legal consent requirement is meant to
gate, so this issue adds a **consent-only** (not full routing) check to
those three verbs' per-provider dispatch, while leaving Phase 7's
"identify/group/alias always fan out, no include/exclude/predicate/
sampling routing" decision otherwise intact. Do not add full routing
support to identify/group/alias here — only consent.

## Scope of this issue

- Add `requiresConsent?: ConsentCategory[]` to `ProviderEntry` in
  `src/routing.ts`. `undefined`/`[]` means the provider has no consent
  requirement (vacuously always consented, per issue 001's
  `isConsentedForProvider`).
- Extend `shouldRouteToProvider(entry, event)`'s signature to
  `shouldRouteToProvider(entry, event, hasConsentFn: (category: ConsentCategory) => boolean): boolean`,
  adding an `isConsentedForProvider(entry.requiresConsent, hasConsentFn)`
  check, AND'd with the existing include/exclude/predicate/sampling checks
  (short-circuits like the existing checks — evaluate consent first, since
  it's the cheapest and most likely to fail-fast in a denied-by-default
  configuration, before the string-matching/predicate/sampling work).
  `shouldRouteToProvider` is an internal (non-barrel-exported) function
  consumed only by `src/index.ts` and its own unit tests — update its
  existing unit tests (`src/routing.test.ts`) for the new required
  parameter; this is not a public API break.
- In `src/index.ts`, update every call site of `shouldRouteToProvider`
  (the `track`/`page`/`screen` fan-out paths) to pass
  `(category) => analytics.consent.hasConsent(category)` (or an
  equivalently-scoped closure over the same `consentState`/`defaultState`
  issue 002 already maintains — implementor's choice of exact closure
  shape, but it must read live state, not a snapshot captured once).
- Add the same consent-only gate to `identify`/`group`/`alias`'s
  per-provider dispatch (both the single-provider and multi-provider fan-out
  branches), evaluated **before** the existing `isCapabilitySupported`
  check for that entry — a provider denied by consent should never also
  trigger a capability warning, since the call was never going to be
  attempted regardless of capability. Use `isConsentedForProvider` directly
  (no need to route through `shouldRouteToProvider`, which also does
  include/exclude/predicate/sampling that Phase 7 deliberately excluded
  these three verbs from).

## Design decisions made in this issue

- **Consent-only, not full routing, for identify/group/alias.** Adding
  `include`/`exclude`/`predicate`/`sampling` evaluation to these three
  verbs would be a much larger change to Phase 7's locked design and isn't
  what "provider-aware consent gating" asks for — scoped narrowly to
  consent only, explicitly.
- **Check order for identify/group/alias: consent first, then
  capability.** A provider that would be blocked by consent shouldn't also
  emit (and permanently record into `warnedCapabilities`) a capability
  warning it will never actually need to re-emit once consent is later
  granted — capability warnings are about developer misconfiguration
  (calling an unsupported verb), consent denial is not a misconfiguration.
- **Live consent state, not a snapshot.** `hasConsentFn` must read
  `analytics.consent`'s current state at call time (not the state at
  provider-list-construction time), since `analytics.consent.grant()`/
  `.deny()` can be called at any point in the instance's lifetime and must
  immediately affect the next dispatch.

## Acceptance criteria

- `ProviderEntry.requiresConsent?: ConsentCategory[]` present and
  documented in `src/routing.ts`.
- `shouldRouteToProvider`'s new 3rd parameter is required (not optional
  with a default) — every call site must be updated, no silent
  behind-the-scenes default.
- Multi-provider `track()`/`page()`/`screen()`: a provider entry with
  `requiresConsent: ["marketing"]` in a list alongside a provider with no
  `requiresConsent` at all — before any consent is granted, only the
  unrestricted provider receives the event; after
  `analytics.consent.grant("marketing")`, both receive it.
- Multi-provider `identify()`/`group()`/`alias()`: same per-provider gating
  behavior, verified independently of the (Phase-7-locked) fact that these
  three verbs still ignore `include`/`exclude`/`predicate`/`sampling`
  entirely (a provider with `include: [...]` set but no `requiresConsent`
  still receives every `identify()` call regardless of `include`,
  confirming routing itself remains untouched for these three verbs).
- A consent-denied provider entry never triggers a capability warning for
  `identify`/`group`/`alias`, even if that provider also doesn't implement
  the capability at all (verified via a stub provider missing the method
  entirely, combined with denied consent — zero `console.warn` calls).
- Single-provider (non-fan-out) path: `requiresConsent` on the sole
  provider entry is honored identically to the multi-provider path (the
  Phase-6 "single bare provider" fast path does not accept a
  `ProviderEntry`-with-`requiresConsent` shape at all today — confirm and
  document that a caller must wrap a single provider in a `ProviderEntry`
  or an array to use `requiresConsent`, consistent with how `include`/
  `exclude`/`sampling`/`priority` already require the same wrapping per
  Phase 7).
- No `requiresConsent` on any entry: zero behavior change from
  pre-issue-005 (regression-tested for both track/page/screen routing and
  identify/group/alias fan-out).

## Test requirements

Both unit and integration tests are required.

**Unit tests** (`src/routing.test.ts`, extending existing file):

- `shouldRouteToProvider` with `requiresConsent` set/unset, crossed with
  `hasConsentFn` returning `true`/`false` for the relevant category(ies),
  and crossed with an existing `include`/`exclude` rule to confirm AND
  composition (consent-denied always wins regardless of a passing
  `include` match).

**Integration tests** (`src/index.test.ts`, new `describe` block):

- The multi-provider track/page/screen scenario above (two providers,
  differing `requiresConsent`).
- The multi-provider identify/group/alias scenario above, including the
  "routing fields are still ignored for these three verbs" confirmation.
- The capability-warning-suppression-on-consent-denial assertion.
- The single-provider-must-be-wrapped documentation check (a bare
  `AnalyticsProvider` with no way to express `requiresConsent` — this can
  be a comment-level/type-level acceptance point rather than a runtime
  test if there's nothing runtime-observable to assert; implementor's call,
  document the reasoning if a test is omitted here).

## Out of scope

- Full routing (`include`/`exclude`/`predicate`/`sampling`) for
  identify/group/alias — explicitly rejected, see Design decisions.
- Consent state persistence — issue 002 already covers this (out of
  scope for typetrack entirely).
- Vendor-specific consent-mode forwarding into adapters — see BRIEF.md's
  phase-wide "Out of scope".
