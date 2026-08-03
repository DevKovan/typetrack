# pipeline-basics

Demonstrates `typetrack`'s middleware pipeline (`.use()`, `Middleware`'s
`before`/`after`/`onError` hooks) through a single, realistic checkout-app
flow: basic usage of one built-in, composing several together where
registration order changes the outcome, the literal before(all)->dispatch->
after(all) execution order, and both middleware- and provider-sourced error
handling.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/middleware/pipeline-basics
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/middleware/pipeline-basics/index.ts
```

## Source

`index.ts`'s `registerPipeline()` builds a 7-middleware chain (registration
order matters throughout this example):

```ts
analytics.use(loggingMiddleware({ log: makeLog(sink) }));
analytics.use(tracerMiddleware("trace:start", sink));
analytics.use(orderValueGuardMiddleware());
analytics.use(versionMiddleware({ appVersion: "2.4.0", buildId: "b9137" }));
// enrichmentMiddleware + redactMiddleware, in either order (see Scenario 2):
analytics.use(enrichment);
analytics.use(redact);
analytics.use(tracerMiddleware("trace:end", sink));
```

`runPipelineBasicsFlow()` then runs 4 scenarios against 2 `createAnalytics()`
instances (a "good" production-shaped pipeline, and a deliberately
misordered contrast pipeline for Scenario 2 only), all against
`createCheckoutWarehouseProvider()` -- a hand-written stub provider that
records every call it receives and can be configured to reject `track()` for
specific event names (simulating a downstream outage).

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal,
exactly-reproducible output of `bun run index.ts` (nothing in this example
depends on any random value), or the "Explanation" section below for the
annotated version.

## Explanation

### Scenario 1 -- basic usage, composition, and execution order (`"Checkout Started"`)

- **Basic usage**: `versionMiddleware({ appVersion: "2.4.0", buildId: "b9137" })`
  injects those two fields into `event.metadata` for every event -- visible
  in the provider's received `metadata: {"appVersion":"2.4.0","buildId":"b9137"}`.
- **Composition, order-dependent**: `enrichmentMiddleware` is registered
  *before* `redactMiddleware`. Enrichment's `properties` function computes
  `emailDomain` from `event.properties.email` (`"jane.doe@example.com"` ->
  `"example.com"`) while `email` is still intact; redaction then replaces
  `email`'s value with `"[REDACTED]"` afterward. The provider receives both
  the correct `emailDomain` *and* a redacted `email` -- the order that keeps
  both correct.
- **Execution order**: `loggingMiddleware` and the two purpose-built
  `tracerMiddleware("trace:start"/"trace:end", ...)` instances (registered
  first and last respectively) make the before(all)->dispatch->after(all)
  sequence literally visible: every `[before]`/`typetrack: [before]` line
  precedes the provider's `[provider] ... received` line, which precedes
  every `[after]`/`typetrack: [after]` line. `order-value-guard`,
  `versionMiddleware`, `enrichmentMiddleware`, and `redactMiddleware` don't
  log themselves (they're pure transforms by design), so the two tracers are
  what bracket them and prove they all ran between `trace:start` and
  `trace:end`, strictly before dispatch.

### Scenario 2 -- composition order matters (contrast)

The *exact same event* is tracked through a second pipeline that differs
only in registering `redactMiddleware` *before* `enrichmentMiddleware`. By
the time enrichment's function runs, `email` is already `"[REDACTED]"` (no
`@`), so `emailDomain` falls back to the literal string `"unknown"` instead
of the correct `"example.com"` -- a purely order-caused difference in
delivered data, with no change to the input event or any middleware's own
configuration. This is why Scenario 1 registers `enrichmentMiddleware`
*before* `redactMiddleware`: any middleware that *derives* a value from a
field another middleware later redacts must run first.

### Scenario 3 -- a middleware's `before()` throws (`onError`, `source: "middleware"`)

`"Purchase Completed"` is tracked with an invalid `value` (`-50`).
`orderValueGuardMiddleware`'s `before()` throws synchronously. Per
`typetrack`'s locked fan-out rule, only middlewares that already ran are
notified -- here, `loggingMiddleware` and `trace:start` (registered before
the guard) and the guard itself (which has no `onError`) -- so
`loggingMiddleware`'s `onError` fires with `{ source: "middleware" }` (no
`providerName`). The event is dropped exactly like a deliberate drop: no
dispatch, no `after()` for *any* middleware (not even `trace:start`, whose
`before()` already ran but whose `after()` never gets the chance to).

### Scenario 4 -- a provider's dispatch rejects (`onError`, `source: "provider"`)

`"Payment Method Charged"` has a valid `value`, so it passes every
`before()` unmodified in substance and reaches dispatch. This pipeline's
provider is configured to reject `track()` for this exact event name
(simulating a downstream API returning a 500). Core's own `console.warn`
fires first, then `loggingMiddleware`'s `onError` fires with
`{ source: "provider", providerName: "checkout-events-warehouse" }`. Unlike
Scenario 3, the `after()` chain still runs to completion afterward -- a
provider rejection is caught and swallowed *inside* dispatch, so by the time
`runThroughMiddleware` checks in, dispatch itself "succeeded" (resolved) and
the after-chain proceeds normally.

## Production notes

- **Built-in middlewares are opt-in only, never auto-enabled.** Every one of
  `versionMiddleware`/`enrichmentMiddleware`/`redactMiddleware`/
  `loggingMiddleware`/`samplingMiddleware`/`timingMiddleware` must be
  explicitly `.use()`d -- `createAnalytics()` never registers any of them on
  its own.
- **Middleware order is significant and must be chosen deliberately.**
  Scenario 2 above is not a contrived edge case -- any pipeline combining a
  middleware that *derives* a value from a field and a middleware that
  *redacts*/mutates that same field needs the derivation to run first. More
  generally: register validation/guards early (fail fast, before wasting
  work on transforms), derivations before anything that consumes/destroys
  their inputs, and observability (`loggingMiddleware`, or a tracer like
  this example's) as early as possible so it can observe -- and be notified
  of failures from -- everything registered after it.
- **A dropped event is silent by design.** Neither `samplingMiddleware` nor
  a conditional custom `before()` that returns `undefined`/`null` logs
  anything on its own -- the call simply resolves as if it had never
  happened. Apps that need visibility into drops should register a
  `loggingMiddleware` (as this example does) or a custom `before()` observer
  that logs before returning the event unchanged.
- **`onError` handlers must never throw.** If one does, `typetrack` catches
  it, emits a `console.warn` naming the offending middleware, and continues
  notifying every other registered `onError` -- a broken `onError` handler
  can never crash the calling `track()`/`page()`/`screen()`, and never
  prevents other middlewares from being notified of the same failure.
- **Performance**: every registered middleware's `before()`/`after()` runs
  synchronously in the hot path of every `track()`/`page()`/`screen()` call
  -- cost is linear in the number of registered middlewares, and this
  example's 7-middleware chain runs on literally every one of its 4 calls.
  Any `async` `before()`/`after()` (this example's are all synchronous) adds
  real latency to the call's returned `Promise`, since `runBeforeChain`/
  `runAfterChain` `await` each one in registration order before moving to
  the next. Apps with strict latency budgets should keep `before()` cheap
  and synchronous where possible, and push expensive work (real logging I/O,
  network calls, etc.) into `after()` -- or genuinely fire-and-forget it --
  once dispatch has already happened, rather than blocking dispatch on it.
