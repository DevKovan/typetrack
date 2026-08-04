# anonymous-and-cookieless-tracking

Demonstrates a privacy-first "no consent banner needed" architecture:
`anonymousMode`, `cookieless` + `autoUTM()`'s cookieless-aware behavior,
composed on a single realistic scenario -- an EU site that avoids needing a
cookie/consent banner at all by never processing personal data or persisting
anything client-side.

> **Not legal advice.** The "no consent banner needed" framing in this
> recipe's name and narrative is an *architectural illustration* of what
> `anonymousMode: true` + `cookieless: true` mean technically inside
> `typetrack` -- it is not a legal conclusion, and it is not legal advice.
> Whether a given site actually needs a consent banner under GDPR/ePrivacy/
> CCPA or any other regime depends on jurisdiction, on what that site's
> *other* code does (server-side logging, third-party scripts, cookies set
> by anything unrelated to this SDK, etc.), and on facts entirely outside
> `typetrack`'s control. Consult qualified counsel for an actual compliance
> determination.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/recipes/anonymous-and-cookieless-tracking
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/recipes/anonymous-and-cookieless-tracking/index.ts
```

## Source

`index.ts`'s `runAnonymousAndCookielessFlow()` constructs the primary
instance:

```ts
const analytics = createAnalytics({
  anonymousMode: true,
  cookieless: true,
  plugins: [autoUTM()],
  provider,
});
```

Since none of `window`/`navigator`/`location`/`sessionStorage` exist in a
plain Bun script, `installStubPage()` stubs them directly on `globalThis`
before each simulated page load -- reusing the exact
`Object.defineProperty(globalThis, ...)` technique established by
`src/context.test.ts` and every Phase 10 plugin's own integration test. A
hand-written `createPrivacyFirstProvider()` (never a real
`packages/provider-*` adapter) records every `track()`/`identify()` call it
receives; a `sessionStorage.setItem` spy (`setItemCalls`) confirms
`cookieless: true` never writes anything.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal,
exactly-reproducible output of `bun run index.ts` (nothing in this example
depends on any random value), or the "Explanation" section below for the
annotated version.

## Explanation

### Step 1-2 -- arriving via a campaign link: the landing event fires, nothing is persisted

The stubbed first page load's `location.search` carries
`?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale`.
`autoUTM()`'s one-shot `"Campaign Landing"` event still fires exactly as it
would without `cookieless` -- `cookieless: true` only changes *persistence*
behavior, never whether the landing event itself fires. What it does change:
`autoUTM()` never calls `sessionStorage.setItem` at all, verified here with a
real spy on the stubbed `sessionStorage.setItem` (not just an assumption).

### Step 3 -- `identify()` from a generic auth hook: a silent no-op

Application code calls `identify("user-42", { email: "jane.doe@example.com" })`
-- representing, e.g., a shared auth hook the app author didn't want to
special-case for this one privacy-first surface. Under `anonymousMode: true`,
this is a complete no-op beyond a one-time `console.warn`: the provider's own
`identify()` is never called, and core's internally-held `userId` is never
set. A subsequent `track("Pricing Page Viewed", { plan: "pro" })` call's
delivered event still carries `userId: undefined` as a direct, observable
consequence.

### Step 4 -- a second page load, no UTM params: the attribution trade-off

A second, independently-constructed `createAnalytics()` instance simulates a
second full page load in the same browser session, this time with no UTM
params in `location.search`. Because `cookieless: true` meant nothing was
ever persisted in Step 1-2, this second load has no first-touch value to
fall back on -- no further `"Campaign Landing"` event fires. **This is the
intentional cost of `cookieless` mode**, not a bug: cookieless tracking loses
cross-page-load campaign-attribution dedup entirely, in exchange for never
writing anything to the browser at all. A site that needs multi-page-load
campaign attribution to survive cannot combine `cookieless: true` with that
requirement -- it must choose one or the other.

### Step 5 -- `destroy()`

Both instances tear down normally, confirming the full lifecycle completes
cleanly under this configuration.

## Production notes

- **`anonymousMode`/`cookieless` are construction-time-only** -- neither has
  a runtime toggle. An app that needs to switch between anonymous/identified
  or cookieless/persisted tracking at runtime must construct a new
  `Analytics` instance (this example's Step 4 does exactly that, to simulate
  a second page load -- a real page reload would do the same implicitly, by
  re-running the app's analytics setup from scratch).
- **typetrack never persists consent decisions itself** (not directly
  exercised by this recipe -- see
  [`../consent-gated-tracking`](../consent-gated-tracking) for the full
  `consent` surface): no cookie, no `localStorage`, no `sessionStorage`
  write for consent state, ever. This recipe sidesteps needing a consent
  decision at all by never collecting anything that would require one in the
  first place -- a different strategy from `consent-gated-tracking`'s
  banner-driven grant/deny flow, not a replacement for it. An app can use
  either strategy, or compose both (e.g. `cookieless: true` for anonymous
  visitors, with a `consent`-gated escalation path once a visitor identifies
  themselves).
- **Provider-aware consent gating requires wrapping providers in
  `ProviderEntry` objects** (not exercised by this recipe, since nothing here
  is consent-gated at all -- see
  [`../consent-gated-tracking`](../consent-gated-tracking) for that surface):
  a bare single `AnalyticsProvider`, as used here, has no way to express
  `requiresConsent`.
- **The cross-page-load campaign-attribution trade-off is inherent to
  `cookieless: true`, not a defect.** See Step 4's explanation above --
  choosing `cookieless: true` is choosing to lose that dedup, in exchange for
  writing nothing to the browser at all.
