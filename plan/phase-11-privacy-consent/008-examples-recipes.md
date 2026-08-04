# 008 — `examples/recipes/`

## Context

Depends on issues 001-007 (full privacy/consent surface implemented and
passing QA: `consent` construction option + `analytics.consent`,
`enable()`/`disable()`, `anonymousMode`, `ProviderEntry.requiresConsent`,
`cookieless` + `autoUTM` interplay, `piiFilterMiddleware`). Per
`plan/VISION.md`'s Examples policy — every feature ships its `examples/`
entries in the same phase that built it — this closes out Phase 11. This
is also the first `examples/recipes/` directory in the repo (doesn't exist
yet) — the ROADMAP's Phase 11 line names this exact directory and example
("consent-gated tracking").

Read `examples/middleware/README.md` and `examples/plugins/README.md` in
full first — both faced a "many small, composable features" shape and
resolved it with a small number of realistic, composed-usage example
directories rather than one-feature-per-directory. Follow that precedent:
**two** composed recipes, not seven single-feature toy directories.

Since real `window`/`navigator`/`document`/`location`/`sessionStorage`
globals don't exist in a plain Bun script, both examples must simulate a
"real page" by stubbing those globals before calling into `typetrack` —
reuse the exact stubbing technique already established by
`src/context.test.ts` (Phase 9) and extended by later plugin tests.

## Scope of this issue

Two new subdirectories under `examples/recipes/`, plus an
`examples/recipes/README.md` index (mirroring `examples/middleware/README.md`'s
structure: intro paragraph, examples-policy paragraph, "not part of any
published package" paragraph, per-example bullet list, closing
testing-conventions paragraph).

### `examples/recipes/consent-gated-tracking/`

A realistic SaaS-app cookie-consent-banner flow. Composes: `consent`
categories + `defaultState` + `respectBrowserSignals`,
`analytics.consent.grant`/`.deny`, `requiredCategories` global gate,
`ProviderEntry.requiresConsent` per-provider gating (two stub providers:
one representing a first-party product-analytics tool needing only
`"analytics"` consent, one representing a third-party marketing pixel
needing `"marketing"` consent), `enable()`/`disable()`, and
`piiFilterMiddleware` composed alongside. Flow:

1. Construct `createAnalytics({ provider: [{ provider: analyticsStub,
   requiresConsent: ["analytics"] }, { provider: marketingStub,
   requiresConsent: ["marketing"] }], consent: { categories: ["analytics",
   "marketing"], defaultState: "denied", requiredCategories: ["analytics"]
   }, ... })` with `piiFilterMiddleware()` registered via `.use()`.
2. Simulate a visitor arriving before answering the consent banner — fire
   a realistic `track("Product Viewed", { sku, email })` — show it's
   fully blocked (neither provider called, per the global
   `requiredCategories: ["analytics"]` gate from issue 002), and that even
   once `"analytics"` alone is later granted, the marketing-requiring
   provider still doesn't receive it (provider-aware gating from issue
   005).
3. Simulate the visitor accepting the banner's "Analytics" toggle only —
   `analytics.consent.grant("analytics")` — re-fire the same event, show
   it now reaches only the analytics-stub provider, with `email` redacted
   by `piiFilterMiddleware` in what that provider receives.
4. Simulate the visitor later also accepting "Marketing" —
   `analytics.consent.grant("marketing")` — fire a realistic
   `track("Newsletter Subscribed", { email })`, show it now reaches both
   providers (each still redacted by the shared `piiFilterMiddleware`).
5. Simulate a stubbed Global Privacy Control signal being present at a
   *second*, separately-constructed instance (`respectBrowserSignals:
   true`, no `initialState`) — show the fail-closed default applies
   immediately at construction, before any explicit `grant`/`deny` call.
6. Call `analytics.disable()` on the first instance — show a further
   `track()` call is fully blocked even though `"analytics"` consent is
   still granted (the two gates are independent, per issue 003) — then
   `analytics.enable()` restores normal behavior.

### `examples/recipes/anonymous-and-cookieless-tracking/`

A privacy-first "no consent banner needed" architecture recipe — an EU
site that avoids needing a cookie/consent banner at all by never
processing personal data or persisting anything client-side. Composes:
`anonymousMode`, `cookieless` + `autoUTM()`'s cookieless-aware behavior,
and a brief note on why this combination can legitimately avoid a consent
requirement (informational only — this example is not legal advice, and
the README must say so explicitly). Flow:

1. Construct `createAnalytics({ anonymousMode: true, cookieless: true,
   plugins: [autoUTM()], provider: stubProvider })`.
2. Simulate arriving via a campaign link (`location.search` carrying UTM
   params) — show `autoUTM()`'s "Campaign Landing" event still fires, and
   that `sessionStorage.setItem` (a stub spy) is never called.
3. Simulate application code calling `identify("user-42", { email:
   "...@example.com" })` (e.g. from a generic shared auth hook the app
   author didn't want to special-case) — show it's a no-op (no provider
   call), and a subsequent `track()`'s properties still carry no `userId`.
4. Simulate a second page load in the same "session" with no UTM params —
   show no further "Campaign Landing" event fires (no persisted
   first-touch value to fall back on, per `cookieless`'s documented
   trade-off from issue 006) — call out this trade-off explicitly in the
   README (cookieless mode loses cross-page-load campaign attribution
   dedup; this is the intentional cost of never persisting anything).
5. Call `.destroy()` — show teardown completes normally.

## Acceptance criteria

- `examples/recipes/README.md` exists, follows the established index
  structure (see `examples/middleware/README.md`), links both
  subdirectories with a one-paragraph description each.
- Both subdirectories follow the established example shape: `package.json`
  (`file:../../..` dependency), `index.ts` (exported flow function(s)), an
  integration test running the real flow end-to-end against hand-written
  stub `AnalyticsProvider`s (never a real `packages/provider-*` adapter), a
  unit test for any non-trivial pure logic the example itself defines (do
  not manufacture one if there's nothing non-trivial), `expected-output.txt`
  (literal captured output), and a `README.md` with Prerequisites/How to
  run/Source/Expected output/Explanation/Production notes sections.
- Every feature from issues 001-007 is exercised by at least one of the
  two flows: `consent` categories/`defaultState`/`respectBrowserSignals`,
  `analytics.consent.grant`/`.deny`, global `requiredCategories` gate,
  per-provider `requiresConsent`, `enable()`/`disable()`, `anonymousMode`,
  `cookieless`, `autoUTM`'s cookieless-aware behavior, `piiFilterMiddleware`.
- Realistic event/property names only (`"Product Viewed"`, `"Newsletter
  Subscribed"`, `"Campaign Landing"`, etc.) — no `test`/`foo`/`bar`
  placeholders anywhere in either example.
- `consent-gated-tracking/`'s README explicitly documents: the
  consent/enabled independence (design decision 1), the fail-closed
  default posture and how `respectBrowserSignals` maps to a CCPA/GPC
  opt-out posture vs. the GDPR opt-in posture, and that
  `piiFilterMiddleware` is complementary to (not a replacement for) the
  existing `redactMiddleware` (link to `examples/middleware/`'s coverage
  of the latter rather than re-explaining it).
- `anonymous-and-cookieless-tracking/`'s README includes an explicit
  disclaimer that the "no consent banner needed" framing is an
  architectural illustration, not legal advice, and documents the
  cross-page-load campaign-attribution trade-off from cookieless mode.
- Both examples' Production notes sections cover: `anonymousMode`/
  `cookieless` are construction-time-only (no runtime toggle); typetrack
  never persists consent decisions itself (the app owns persistence via
  `consent.initialState`/`analytics.consent.get()`); provider-aware
  consent gating requires wrapping providers in `ProviderEntry` objects
  (a bare single provider can't express `requiresConsent`).

## Test requirements

- Integration test required for both example directories — run the real
  flow(s), assert the stub providers' recorded events (name + properties,
  including confirming PII redaction and confirming a blocked provider
  received nothing) match hand-computed expectations at each step.
- A unit test is required only where non-trivial pure logic exists inside
  the example's own code (e.g. scenario-driving helper functions) — do not
  manufacture one otherwise; state explicitly in the commit notes if
  omitted and why.

## Out of scope

- Any change to `src/` or `packages/*` — this issue is examples-only.
- Live vendor infrastructure — providers in both examples are
  hand-written stubs.
- A real cookie-banner UI component — both examples simulate the
  visitor's banner interaction via direct `analytics.consent.grant()`/
  `.deny()` calls, not a rendered UI.
- A third example, or splitting either composed example apart into
  one-feature-per-directory — explicitly rejected in favor of the two
  composed flows above, per this issue's Context section.
