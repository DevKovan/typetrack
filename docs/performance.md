# Performance

## What's measured today, and where

**Dispatch overhead.** `src/index.performance.test.ts` is a regression
*smoke test* (not comparative benchmarking — see below), asserting that
`createAnalytics()` construction and `track()` dispatch each stay under a
generous 0.1ms/call budget against a `noopProvider` with no middleware/
routing/reliability/context/schemas enabled. Its own comments record what
was observed on one development machine (Apple Silicon, `bun test`,
10 repeated runs): ~0.0008ms/call for construction, ~0.00035ms/call for
`track()` dispatch. Treat these as an illustrative order of magnitude, not
a portable guarantee — your hardware/runtime will differ.

**Comparative-across-config numbers.** `benchmarks/internal.bench.ts`
(`mitata`, Bun-native — see [`benchmarks/results/internal.md`](../benchmarks/results/internal.md)
for the full run, raw output, and per-config methodology) measures the same
dispatch path across four opt-in configurations, isolating what each
feature actually costs:

| Config | Cold start (`createAnalytics()`) avg |
|---|---|
| (a) `noopProvider` only (baseline) | 209.61 ns |
| (b) `context: true` + 3 middleware | 30,490 ns (30.49 µs) |
| (c) `reliability: true` | 1,370 ns (1.37 µs) |

| Config | `track()` avg |
|---|---|
| (a) `noopProvider` only (baseline) | 109.03 ns |
| (b) `context: true` + 3 middleware | 545.92 ns |
| (c) `reliability: true` | 116.37 ns |
| (d) multi-provider fan-out (2x `noopProvider`) | 573.39 ns |

Heap growth over 10,000 `track()` calls (forced `Bun.gc(true)` before/after)
measured 0 B of retained growth for both the baseline and `reliability: true`
configs — expected, since neither config retains a reference to a
dispatched event once `track()` resolves (`noopProvider` always succeeds
synchronously, so `reliability`'s queue is never populated). See
`benchmarks/results/internal.md` for the reasoning behind each number
(e.g. why `(b)`'s construction cost is ~145x the baseline, and why `(c)`'s
per-call cost is nearly free relative to its one-time construction cost).

**Bundle size.** Root `.size-limit.json` tracks gzip size of every built
artifact, checked in CI via `bun run size` (`size-limit`'s `@size-limit/
file` plugin, no re-bundling — it checks already-built `dist/` output). The
table below is the enforced CI **budget**, a ceiling that fails the build if
crossed — not the same thing as the actually-measured size today (next
table):

| Package | Artifact | Budget (gzip) |
|---|---|---|
| `typetrack` (ESM) | `dist/index.js` | 18 KB |
| `typetrack` (IIFE/CDN) | `dist/index.global.js` | 12.5 KB |
| `@typetrack/react` | `dist/index.js` | 480 B |
| `@typetrack/next` | `dist/index.js` | 650 B |
| `@typetrack/vue` | `dist/index.js` | 480 B |
| `@typetrack/nuxt` | `dist/index.js` | 950 B |
| `@typetrack/svelte` | `dist/index.js` | 650 B |
| `@typetrack/solid` | `dist/index.js` | 440 B |
| `@typetrack/astro` | `dist/index.js` | 800 B |
| `@typetrack/remix` | `dist/index.js` | 550 B |

**Actually measured**, from a real `bun run build` of this repo's root
`typetrack` package, gzip'd in-process (see
[`benchmarks/results/bundle-size.md`](../benchmarks/results/bundle-size.md)
for the full comparison, sourcing, and fetch date):

| Artifact | Minified (raw) | Minified+gzip |
|---|---|---|
| `typetrack` (ESM — `dist/index.js`) | 68,744 B | 15,810 B |
| `typetrack` (IIFE/CDN — `dist/index.global.js`) | 30,985 B | 11,008 B |

Both are comfortably under their respective CI budgets above.

## Comparative benchmarks vs. PostHog/Segment/RudderStack

Real, measured numbers against the three vendor SDKs this repo has adapters
or documented comparisons for — each table below is a summary; the linked
results file carries the full methodology and fairness caveats (not
duplicated here). All cross-library numbers were measured in a real browser
(Playwright/Chromium) against a local stub ingestion endpoint, never live
vendor infrastructure, with each vendor SDK's heaviest optional init-time
features (autocapture, session recording, feature-flag polling, etc.)
explicitly disabled — see each linked file for exactly what that means and
why it isn't each vendor's out-of-the-box default configuration.

**Bundle size** ([full results](../benchmarks/results/bundle-size.md)) —
typetrack's own `dist/` output measured directly; vendor sizes sourced from
bundlephobia's public API, fetched 2026-08-10:

| Package | Minified+gzip | vs. typetrack core ESM |
|---|---|---|
| `typetrack` (ESM) | 15,810 B | 1.0x |
| `typetrack` (IIFE/CDN) | 11,008 B | 0.7x |
| `posthog-js` 1.414.0 | 77,616 B | 4.9x |
| `@segment/analytics-next` 1.84.1 | 28,246 B | 1.8x |
| `@rudderstack/analytics-js` 3.31.6 | 31,123 B | 2.0x |

**Tree-shaking** ([full results](../benchmarks/results/tree-shaking.md)) —
static `package.json sideEffects` inspection for the three vendors
(bundlephobia, same fetch as above); no vendor minimal-import fixture is
built, since these are whole-SDK browser libraries with side-effectful init
by design:

| Package | `hasSideEffects` |
|---|---|
| `posthog-js` | `true` — unused exports not guaranteed tree-shaken |
| `@segment/analytics-next` | `false` — declares itself side-effect-free |
| `@rudderstack/analytics-js` | `true` — unused exports not guaranteed tree-shaken |

**Cold start & memory** ([full results](../benchmarks/results/cold-start-memory.md))
— median of 5 fresh-browser-context runs per library, cold-start ms via each
library's own real ready signal, heap via `performance.memory.usedJSHeapSize`:

| Library | Median cold-start | Median heap |
|---|---|---|
| typetrack | 7.50 ms | 2,102,300 B |
| posthog | 19.70 ms | 3,256,095 B |
| segment | 12.50 ms | 2,621,096 B |
| rudderstack | 23.80 ms | 3,269,820 B |

**Throughput** ([full results](../benchmarks/results/throughput.md)) —
median of 5 runs, each library's own real tracking-call method invoked `n`
times; **these four numbers measure different kinds of work** (typetrack's
is synchronous dispatch-only against `noopProvider`, Segment's includes a
real network round trip against the local stub, PostHog's/RudderStack's are
synchronous enqueue-only) — see the full results file before drawing a
conclusion from this table alone:

| Library | n | Median elapsed | Median calls/sec |
|---|---|---|---|
| typetrack | 1000 | 0.70 ms | 1,428,571 |
| posthog | 1000 | 6.80 ms | 147,059 |
| segment | 1000 | 518.70 ms | 1,928 |
| rudderstack | 1000 | 2474.90 ms | 404 |

See [`docs/comparison.md`](./comparison.md) for the qualitative
(capability-focused) comparison against the same three vendors, and
[`benchmarks/README.md`](../benchmarks/README.md) to reproduce every number
on this page yourself.

## What's free when unused (tree-shaking)

Every middleware and plugin is a separate named export (`export {
redactMiddleware } from "./middleware/redact"`, `export { autoPage } from
"./plugins/autoPage"`, and so on through `src/index.ts`'s full export
list). An app that never imports/registers a given built-in never pays for
its code in a tree-shaking bundler. Measured, not just asserted: a real
minimal-import fixture (`createAnalytics` + `noopProvider` only, built and
gzip'd the same way as the bundle-size numbers above) produces a bundle
**57.9% smaller**, gzipped, than importing everything typetrack exports —
see [`benchmarks/results/tree-shaking.md`](../benchmarks/results/tree-shaking.md)
for the full fixture, build command, and byte counts.

## What's opt-in cost

- **`context: true`** — `Intl`/UA-parsing work happens once, at
  construction (`captureStaticContext()`), plus a small amount of work per
  `track`/`page`/`screen` call (`captureDynamicContext()`) — only when
  enabled. `staticContext === undefined` is the single "off" signal every
  call site checks first; with `context` omitted, none of this runs at
  all.
- **`reliability: true`** — adds a `setInterval` drain-loop tick every 5s
  (`DRAIN_INTERVAL_MS`), plus (in a browser) `online`/`pagehide`
  listeners. All dead code when omitted — `queueEngine` stays `undefined`
  and every call site that reads it short-circuits immediately.
- **Zero-middleware fast path** — with no middleware registered,
  `runThroughMiddleware()` calls `dispatch()` directly, with no `before`/
  `after` chain wrapping at all — `track()`'s return value passes through
  completely unwrapped (no extra microtask tick added).
- **Single-provider fast path** — `provider: aSingleProvider` (a bare
  provider, not an array/`ProviderEntry`) skips `Promise.allSettled`
  fan-out wrapping and routing evaluation entirely, calling the provider
  directly.
- **Plugins** — every built-in `auto*` plugin no-ops immediately (attaches
  no listener) outside a browser environment via `isBrowserEnvironment()`.
- **Validation (`schemas`)** — only events with a matching `schemas[event]`
  entry pay the `schema.safeParse()` cost; everything else forwards raw.
  `validate: false` disables validation entirely, instance-wide — see
  [`docs/cookbook.md`](./cookbook.md#strip-validation-from-a-production-bundle)
  for stripping it from a production bundle.

## Practical guidance

- Use `samplingMiddleware`/`ProviderEntry.sampling` to cut event volume
  before it reaches a provider — see [`docs/middleware.md`](./middleware.md#samplingmiddleware-rate-)
  for the two-layer distinction.
- If a provider declares `capabilities.batch: true` and implements
  `trackBatch`, `reliability`'s `batch` option coalesces multiple queued
  events into one request instead of one-at-a-time — see
  `ReliabilityOptions.batch`'s doc comment in `src/index.ts`.
- Call `flush()`/`destroy()` before process exit in short-lived
  environments (serverless functions, CLI scripts) so any queued or
  client-buffered events aren't lost when the process terminates.
