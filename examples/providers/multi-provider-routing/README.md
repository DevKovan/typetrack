# multi-provider-routing

Demonstrates `typetrack`'s multi-provider fan-out and per-provider routing:
supplying `provider` as an array of `ProviderEntry`s to `createAnalytics()`,
where each entry can carry its own `include`, `exclude`, `predicate`,
`sampling`, and `priority`. Four hand-written stub providers, each
demonstrating a different routing mechanism, run through a realistic mix of
commerce/debug/pageview events.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/providers/multi-provider-routing
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/providers/multi-provider-routing/index.ts
```

## Source

`index.ts`'s `createProviderSet()` builds 4 hand-written stub providers and
their `ProviderEntry` routing config:

```ts
const entries: ProviderEntry[] = [
  {
    provider: analyticsWarehouseProvider,
    include: ["Purchase Completed", "Checkout Started"],
    priority: 30,
  },
  {
    provider: marketingPixelProvider,
    exclude: [/^debug\./],
    priority: 10,
  },
  {
    provider: debugConsoleProvider,
    predicate: (event) => event.context?.environment === "development",
    priority: 20,
  },
  {
    provider: fullFeaturedProvider,
    sampling: 0.5,
    priority: 0,
  },
];
```

`runRoutingFlow(entries)` then constructs `createAnalytics({ provider: entries })`
and runs a realistic sequence: 4 `track()` calls (2 commerce events, one
internal debug-namespaced event, one plain pageview -- mixing `context` to
hit `include`/`exclude`/`predicate` differently), an `identify()` call, and a
`flush()`. It's exported (rather than only run inline) so
`index.integration.test.ts` can run the exact same call sequence against its
own `createProviderSet()` output.

Because `anonymousId` isn't settable after `createAnalytics()` is called, the
example simulates two distinct users by constructing two separate instances
(`createProviderSet("user-A")` / `createProviderSet("user-B")`, each with its
own fresh stub providers and `callLog`) and running `runRoutingFlow` through
each -- see the `if (import.meta.main)` block at the bottom of `index.ts`.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal
output (with a note on which parts are illustrative/random vs. exactly
reproducible), or the "Explanation" section below for the annotated version.

## Explanation

Each provider's `ProviderEntry` and why it did/didn't receive each event:

### `analyticsWarehouseProvider` (`include: ["Purchase Completed", "Checkout Started"]`)

Only receives events whose name is *exactly* one of the two listed --
`include` is a strict allowlist. Receives `"Checkout Started"` and
`"Purchase Completed"`; does **not** receive `"debug.cache_miss"` or
`"Page Viewed"` (`include` never wildcard-matches on providers where it's not
set to allow the event -- an event not on the list is dropped for this
provider, regardless of anything else about it).

### `marketingPixelProvider` (`exclude: [/^debug\./]`)

The inverse shape: receives *everything except* events matching one of its
`exclude` matchers. `/^debug\./` matches `"debug.cache_miss"` (excluded);
every other event in this flow (`"Checkout Started"`, `"Purchase Completed"`,
`"Page Viewed"`) is not debug-namespaced, so all 3 pass through. This has to
be a *different* provider than `analyticsWarehouseProvider` -- a single
`ProviderEntry` specifying both `include` and `exclude` throws synchronously
at `createAnalytics()` construction time.

### `debugConsoleProvider` (`predicate: (event) => event.context?.environment === "development"`)

Only receives events whose `context.environment` is exactly `"development"`
-- an ordinary, application-chosen key inside `TrackOptions.context`, not a
special/reserved core field. `"Checkout Started"` and `"debug.cache_miss"`
both carry `context: { environment: "development" }` in this flow, so both
pass; `"Purchase Completed"` is tagged `"production"` (fails); `"Page Viewed"`
carries no `context` at all, so `event.context?.environment` is `undefined`,
which also fails (`undefined !== "development"`).

Note the deliberate contrast with `marketingPixelProvider`: that provider's
`exclude` cares about the event *name* (anything under the `debug.*`
namespace); this provider's `predicate` cares about the request-scoped
*environment* the event was fired from, which is an orthogonal concern --
`"debug.cache_miss"` happens to satisfy both "is debug-namespaced" and "was
fired from a dev environment" in this flow, but nothing enforces that the two
always coincide in a real app.

### `fullFeaturedProvider` (`sampling: 0.5`)

No `include`/`exclude`/`predicate` at all -- every event is a *candidate*,
but only for whichever ~50% of users (by `anonymousId`) get sampled in.
Sampling is a deterministic function of `anonymousId`, evaluated fresh per
call but always producing the same in/out answer for the same `anonymousId`
-- so within one simulated user's entire flow (one `createAnalytics()`
instance, one `anonymousId` throughout), `fullFeaturedProvider` either
receives *all 4* `track()` calls or *none* of them, never some. That's why
`index.ts` logs "IN (4/4)" or "OUT (0/4)" per simulated user rather than a
per-event breakdown.

### `identify()` and `flush()`: always fan out, unconditionally

`identify()` and `flush()` are not routable -- `include`/`exclude`/
`predicate`/`sampling` only ever apply to `track()`/`page()`/`screen()`. Every
one of the 4 providers logs exactly one `identify` line and one `flush` line
per simulated user, regardless of how many (if any) `track()` calls that
provider received.

### Call order for `"Checkout Started"`: `priority`, not array position

`"Checkout Started"` is the one event in this flow where `analyticsWarehouseProvider`,
`marketingPixelProvider`, and `debugConsoleProvider` are all *guaranteed*
included (only `fullFeaturedProvider`'s presence depends on sampling), which
makes it the clearest event for observing invocation order. The 4 entries
declare priorities `30`/`10`/`20`/`0` respectively (declared in a different
order in the `entries` array above: `analyticsWarehouseProvider` first,
`fullFeaturedProvider` last) -- providers are invoked in ascending `priority`
order (ties broken by declared array position), so the actual call order is
`fullFeaturedProvider` (0, when sampled in) → `marketingPixelProvider` (10) →
`debugConsoleProvider` (20) → `analyticsWarehouseProvider` (30), which is the
*reverse* of their declaration order in `entries` -- demonstrating that
`priority` controls call order, not where a provider happens to sit in the
array.

## Production notes

- **Sampling is per-`anonymousId`, not per-event.** A user's sampling in/out
  decision for a given provider is computed fresh on every call, but is a
  pure function of `(anonymousId, samplingRate)` -- so it stays stable across
  that user's whole session (every `track()`/`page()`/`screen()` call), until
  `reset()` regenerates their `anonymousId`. Don't expect (or design around)
  a single user "flickering" in and out of a sampled provider mid-session.
- **Routing config is evaluated per-call, not cached.** `include`/`exclude`/
  `predicate`/`sampling` are re-evaluated against every single `track()`/
  `page()`/`screen()` call -- there's no setup-time precomputation to
  invalidate. This makes it cheap to declare many providers with different
  routing rules (as here) rather than manually `if`-branching application
  code per destination.
- **`flush()`/`destroy()` on a multi-provider array can throw a real
  `AggregateError`** combining every failed provider's rejection reason.
  Real apps should catch and log it (as `runRoutingFlow` does around its
  `flush()` call) rather than letting it propagate uncaught and potentially
  crash a shutdown path. `destroy()` (not called by this example's flow)
  behaves the same way, and additionally re-flushes every provider
  internally before tearing it down -- calling `flush()` immediately before
  `destroy()` in the same flow would double up every provider's `flush()`
  invocation, which is why this example calls only `flush()`, not both.
- **These 4 providers are teaching tools, not real providers.** Real
  providers live in `packages/provider-*` (or your own adapter) and talk to
  an actual vendor/backend; these stubs exist only to make routing/priority/
  sampling decisions observable without needing any vendor account.
