# consent-gated-tracking

Demonstrates `typetrack`'s Phase 11 consent surface through a single,
realistic SaaS-app cookie-consent-banner flow: `consent` construction option
(`categories`/`defaultState`/`respectBrowserSignals`/`requiredCategories`),
`analytics.consent.grant`/`.deny`, per-provider `ProviderEntry.requiresConsent`
gating between a first-party product-analytics provider and a third-party
marketing pixel, `enable()`/`disable()`, and `piiFilterMiddleware` composed
alongside.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/recipes/consent-gated-tracking
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/recipes/consent-gated-tracking/index.ts
```

## Source

`index.ts`'s `runConsentGatedTrackingFlow()` constructs the primary instance
with two consent-gated providers and a global gate:

```ts
const analytics = createAnalytics({
  provider: [
    { provider: analyticsStub, requiresConsent: ["analytics"] },
    { provider: marketingStub, requiresConsent: ["marketing"] },
  ],
  consent: {
    categories: ["analytics", "marketing"],
    defaultState: "denied",
    requiredCategories: ["analytics"],
  },
});
analytics.use(piiFilterMiddleware());
```

then walks 6 scenarios against it (plus a second, independent instance for
scenario 5) -- see `index.ts`'s own comments for the full narrative. A
hand-written `createConsentAwareProvider()` (never a real
`packages/provider-*` adapter) stands in for both the first-party
product-analytics tool and the third-party marketing pixel, recording every
`track()` call it receives.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal,
exactly-reproducible output of `bun run index.ts` (nothing in this example
depends on any random value), or the "Explanation" section below for the
annotated version.

## Explanation

### Step 1-2 -- construction, and a pre-consent visit is fully blocked

The visitor hasn't answered the consent banner yet: `consentState` starts
empty, so every category resolves against `defaultState: "denied"`. Firing
`track("Product Viewed", { sku, email })` at this point is blocked by the
*global* `requiredCategories: ["analytics"]` gate (issue 002) before routing
or provider dispatch is even evaluated -- neither `product-analytics` nor
`marketing-pixel` receives anything.

### Step 3 -- granting "analytics" only: provider-aware gating + redaction

`analytics.consent.grant("analytics")` satisfies the global gate, so the
re-fired event now reaches per-provider routing (issue 005). Each provider
was wrapped in a `ProviderEntry` carrying its own `requiresConsent`:
`product-analytics`'s `["analytics"]` requirement is now satisfied,
`marketing-pixel`'s `["marketing"]` requirement is not -- so only
`product-analytics` receives the event, and only after `piiFilterMiddleware()`
(registered via `.use()`) has redacted `email` in what it delivers.

### Step 4 -- also granting "marketing": both providers reached

`analytics.consent.grant("marketing")` satisfies `marketing-pixel`'s own
requirement too. `track("Newsletter Subscribed", { email })` now reaches
both providers, each still redacted by the same shared
`piiFilterMiddleware`.

### Step 5 -- a second instance fails closed on a Global Privacy Control signal

A second, independent `createAnalytics()` instance is constructed with
`respectBrowserSignals: true` and no `initialState`, while a stubbed
`navigator.globalPrivacyControl === true` signal is present. Per
`resolveDefaultState()` (`src/consent.ts`), this forces that instance's
`defaultState` to `"denied"` -- `consent.hasConsent("analytics")` already
reads `false` immediately after construction, before any `grant()`/`deny()`
call is ever made, and a `track()` call against it is blocked accordingly.

### Step 6 -- `disable()`/`enable()`: consent and the kill switch are independent

`analytics.disable()` blocks a further `track()` call on the *first*
instance even though `"analytics"`/`"marketing"` consent are both still
granted -- `enabled` and consent state are evaluated with logical AND, never
conflated. `analytics.enable()` restores normal delivery immediately.

## Production notes

- **Consent state and the `enable()`/`disable()` kill switch are two
  independent gates, always AND'd together, never conflated.** This is a
  locked Phase 11 design decision: `disable()` never touches `consentState`,
  granting/denying a category never flips `enabled`, and neither is reset by
  `reset()` (identity/session reset is not a privacy-state reset -- e.g. a
  logout should not silently re-enable tracking that was explicitly disabled,
  nor erase a consent decision the visitor already made this browser
  session). Step 6 above demonstrates this directly: a `disable()`'d instance
  stays blocked even with every relevant category still granted.
- **Fail-closed by default, and `respectBrowserSignals` maps to two distinct
  legal postures via the same primitive.** Whenever `consent` is supplied at
  all, `defaultState` defaults to `"denied"` -- a category never explicitly
  granted/denied is treated as not consented, the GDPR-correct opt-in
  posture (this example's primary instance uses exactly this). An app
  targeting CCPA/CPRA's opt-out model instead sets `defaultState: "granted"`
  explicitly and pairs it with `respectBrowserSignals: true`, so a detected
  Global Privacy Control signal (or legacy Do Not Track) forces that
  instance's default back to `"denied"` -- honoring an opt-out signal without
  requiring an opt-in banner at all. Step 5 above demonstrates the opt-in
  posture's fail-closed construction-time behavior; either posture is
  reachable from the same `ConsentOptions` shape, never two different APIs.
- **`piiFilterMiddleware` is complementary to, not a replacement for,
  `redactMiddleware`.** `redactMiddleware` redacts exact (possibly dotted)
  field *paths* an app enumerates in advance and does not descend into
  arrays; `piiFilterMiddleware` instead walks every plain object/array
  recursively and redacts any key whose *name* matches a pattern, catching
  PII in shapes the app didn't know to enumerate up front. Both may be (and
  often should be) registered together via `.use()` -- see
  [`examples/middleware`](../../middleware) for `redactMiddleware`'s own
  dedicated coverage rather than re-explaining it here.
- **`anonymousMode`/`cookieless` are construction-time-only** (not exercised
  by this recipe -- see
  [`../anonymous-and-cookieless-tracking`](../anonymous-and-cookieless-tracking)):
  there is no runtime toggle for either; an app that needs to change them
  must construct a new `Analytics` instance.
- **typetrack never persists consent decisions itself.** No cookie, no
  `localStorage`, no `sessionStorage` write for consent state, ever. An app
  that wants a visitor's consent choice to survive a page reload must persist
  `analytics.consent.get()`'s snapshot itself (e.g. to its own cookie/CMP
  storage) and pass it back in as `consent.initialState` on the next
  `createAnalytics()` call -- this example always starts from an empty
  `initialState`, simulating a visitor's very first visit.
- **Provider-aware consent gating requires wrapping providers in
  `ProviderEntry` objects.** A bare single `AnalyticsProvider` (the
  Phase-6 passthrough fast path) has no way to express `requiresConsent` --
  exactly like `include`/`exclude`/`sampling`/`priority` already require the
  same `ProviderEntry` wrapping (or an array of them) to use. This example's
  `provider: [{ provider: ..., requiresConsent: [...] }, ...]` array is the
  minimum shape needed for per-provider gating.
