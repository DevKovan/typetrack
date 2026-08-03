# sampling-vs-routing

Clarifies the two-layer sampling distinction between `samplingMiddleware`
(this phase, `src/middleware/sampling.ts`) and `ProviderEntry.sampling`
(Phase 7's per-provider routing, `src/routing.ts`) -- one global, pre-dispatch
gate that can drop an event for every provider at once, and one per-provider
gate that only ever excludes the one provider it's configured on. A
realistic search product tracks a `"Search Query Submitted"` event through
2 providers: an always-on analytics warehouse, and a costlier ML ranking
vendor that only wants a sampled subset.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/middleware/sampling-vs-routing
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/middleware/sampling-vs-routing/index.ts
```

## Source

`index.ts`'s `createSamplingScenario()` builds 2 hand-written stub providers:

```ts
const entries: ProviderEntry[] = [
  { provider: warehouseProvider },                              // no sampling of its own
  { provider: vendorProvider, sampling: VENDOR_SAMPLING_RATE },  // 0.3 -- Phase 7's per-provider gate
];
```

`runOneUserTrial()` then constructs a fresh `createAnalytics({ provider: entries })`
(fresh `anonymousId`), registers `samplingMiddleware({ rate: GLOBAL_SAMPLING_RATE })`
(0.7 -- this phase's global, pre-dispatch gate) via `.use()`, tracks one
`"Search Query Submitted"` event, and reports which of 3 outcomes it landed
in by observing `callLog` (which providers were actually invoked) --
`categorizeOutcome()` is the pure classification logic, unit-tested directly
in `index.test.ts`.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for one literal captured
run (with a note on what's random vs. structurally guaranteed), or the
"Explanation" section below for the underlying math.

## Explanation

Both `samplingMiddleware`'s global gate and `ProviderEntry.sampling`'s
per-provider gate are pure functions of the exact same
`hashToUnitInterval(anonymousId)` value (`src/routing.ts`'s
`isSampledIn(anonymousId, rate)`, imported directly by `samplingMiddleware`,
never reimplemented). Call that value `h` (a fixed number in `[0, 1)` for a
given `anonymousId`, re-derived fresh on every call but always the same for
that `anonymousId`). With `GLOBAL_SAMPLING_RATE = 0.7` and
`VENDOR_SAMPLING_RATE = 0.3`:

- **`h >= 0.7` (~30% of anonymousIds) -- `"globally-dropped"`.**
  `samplingMiddleware`'s `before()` returns `undefined` for this event,
  before `dispatch()` ever begins evaluating either provider's routing.
  Neither `search-analytics-warehouse` nor `ml-ranking-vendor` is called --
  a global middleware drop is unconditional, regardless of any provider's
  own `include`/`exclude`/`predicate`/`sampling`.
- **`0.3 <= h < 0.7` (~40%) -- `"vendor-excluded"`.** The event passes the
  global gate (`h < 0.7`), so dispatch proceeds to per-provider routing.
  `search-analytics-warehouse` has no `ProviderEntry.sampling` of its own,
  so it's always a candidate once dispatch is reached -- it receives the
  event. `ml-ranking-vendor`'s own `sampling: 0.3` gate fails (`h >= 0.3`),
  so it does not.
- **`h < 0.3` (~30%) -- `"delivered-to-both"`.** The event passes both gates
  -- both providers receive it.

The 4th boolean combination (vendor receives it, warehouse doesn't) is
mathematically impossible given `VENDOR_SAMPLING_RATE < GLOBAL_SAMPLING_RATE`:
passing the *stricter* `h < 0.3` check always implies passing the *looser*
`h < 0.7` check, for the same `h`. `categorizeOutcome()` throws rather than
silently mis-categorizing if this ever occurs -- `index.test.ts` asserts
this behavior directly, and `index.integration.test.ts`'s 300-trial test
asserts it's never actually observed against the real `typetrack` package.

## Production notes

- **The two layers are independent and composable, by design.** Use
  `samplingMiddleware` to cut overall event volume before it fans out to
  *any* destination (cheapest -- skips routing evaluation and every
  provider call entirely for dropped events), and `ProviderEntry.sampling`
  to additionally thin out what one specific, possibly expensive/
  rate-limited provider receives from whatever volume survives the global
  gate. Neither one needs to know the other exists.
- **Built-in middlewares are opt-in only, never auto-enabled.**
  `samplingMiddleware` must be explicitly `.use()`d; `createAnalytics()`
  never registers it (or any other built-in) on its own.
- **A dropped event is silent by design, at either layer.** Neither
  `samplingMiddleware`'s drop nor `ProviderEntry.sampling`'s per-provider
  exclusion logs anything on its own -- `typetrack` deliberately does not
  expose *why* a provider was/wasn't called. Apps that need visibility into
  drops should register a `loggingMiddleware` (see `pipeline-basics/`) or a
  custom `before()` observer.
- **Middleware order still matters here too.** `samplingMiddleware` should
  typically be registered *early* in the chain (before any expensive
  transform middleware) precisely because it can drop the event outright --
  a middleware registered after it in the chain never runs at all for a
  globally-dropped event, so ordering it early avoids wasted work.
- **Sampling is per-`anonymousId`, not per-event**, at both layers -- a
  single user's in/out decision for a given rate is stable across their
  whole session (every `track()`/`page()`/`screen()` call), until `reset()`
  regenerates their `anonymousId`. Don't expect a single user to
  "flicker" in and out mid-session.
- **`onError` handlers must never throw.** Not directly exercised by this
  example (neither built-in middleware here has an `onError`), but the same
  swallow-and-warn contract documented in `pipeline-basics/README.md`
  applies identically if a custom `onError` is added alongside these.
- **Performance**: like every middleware, `samplingMiddleware`'s `before()`
  runs synchronously in the hot path of every `track()`/`page()`/`screen()`
  call -- its own cost is a single hash computation over the `anonymousId`
  string, negligible compared to the provider calls it can skip entirely
  for a dropped event. `ProviderEntry.sampling` costs the same single hash
  computation per provider it's configured on, evaluated fresh per call
  (routing config is never cached/precomputed).
