# examples/recipes

Runnable, self-contained demonstrations of `typetrack`'s Phase 11 privacy and
consent surface: the `consent` construction option (`categories`/
`defaultState`/`respectBrowserSignals`/`requiredCategories`), the always-present
`analytics.consent` runtime (`grant`/`deny`/`hasConsent`/`get`), the coarse
`enable()`/`disable()` operational kill switch, `anonymousMode`, `cookieless`
(and `autoUTM()`'s cookieless-aware behavior), per-provider
`ProviderEntry.requiresConsent` gating, and `piiFilterMiddleware` -- composed
together the way a real app would actually use them, not exercised one
feature at a time.

Per `plan/VISION.md`'s Examples policy, every feature ships its `examples/`
entries in the same phase that built it, so these never drift out of sync
with what's actually shipped -- each example's integration test imports and
runs the example's own real entry point/app logic (never a re-implemented
copy of it) against the real `typetrack` API, so a future change to the
consent/privacy surface that breaks an example's assumptions fails that
example's tests, not just its prose.

None of `examples/` is part of any published npm package: it's excluded from
every package's `files`/`exports` and from `bun run build:all`/`tsup`'s
build steps -- this is documentation/demo code for people reading the repo
or running it locally, not shipped library code.

## Examples

- **[`consent-gated-tracking/`](./consent-gated-tracking)** -- a realistic
  SaaS-app cookie-consent-banner flow: a visitor arrives before answering
  the banner (fully blocked by the global `requiredCategories` gate), grants
  only an "Analytics" toggle (reaching only the provider that requires that
  category, redacted by `piiFilterMiddleware`), later also grants
  "Marketing" (now reaching both consent-gated providers), a second instance
  demonstrating `respectBrowserSignals`' fail-closed Global-Privacy-Control
  default applying immediately at construction, and `disable()`/`enable()`
  demonstrating that the coarse kill switch and consent state are
  independent gates.
- **[`anonymous-and-cookieless-tracking/`](./anonymous-and-cookieless-tracking)**
  -- a privacy-first "no consent banner needed" architecture recipe: an EU
  site combining `anonymousMode` and `cookieless` with `autoUTM()`, showing a
  campaign-link landing event still firing without any `sessionStorage`
  write, a generic `identify()` call from a shared auth hook silently
  becoming a no-op, and the cross-page-load campaign-attribution trade-off
  that comes with never persisting anything client-side.

Two composed, realistic example directories rather than several
one-feature-per-directory toy directories -- following the same precedent
[`examples/middleware`](../middleware) and [`examples/plugins`](../plugins)
established for their own "many small, composable features" shape.

Every example includes a `README.md` with source excerpts, the literal
expected output, an explanation of why the output looks the way it does, and
production notes -- and both an integration test (running the example's real
entry point end to end against hand-written stub providers, never live
vendor infrastructure or a real `packages/provider-*` adapter) and, where the
example itself defines any non-trivial pure logic worth isolating, a unit
test for it (neither example here defines any -- see each `index.ts`'s own
header comment for why).
