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

**Bundle size.** Root `.size-limit.json` tracks gzip size of every built
artifact, checked in CI via `bun run size` (`size-limit`'s `@size-limit/
file` plugin, no re-bundling — it checks already-built `dist/` output):

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

**Comparative numbers against PostHog/Segment/RudderStack's own SDK
bundle sizes, cold start, memory, and throughput are not published here** —
that's Phase 19 ("Performance benchmarking", `plan/ROADMAP.md`)'s job, not
yet landed as of this guide. See [`docs/comparison.md`](./comparison.md)
for the qualitative (non-numeric) comparison that exists today.

## What's free when unused (tree-shaking)

Every middleware and plugin is a separate named export (`export {
redactMiddleware } from "./middleware/redact"`, `export { autoPage } from
"./plugins/autoPage"`, and so on through `src/index.ts`'s full export
list). An app that never imports/registers a given built-in never pays for
its code in a tree-shaking bundler.

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
  before it reaches a provider — see [`docs/middleware.md`](./middleware.md#samplingmiddlewarerate)
  for the two-layer distinction.
- If a provider declares `capabilities.batch: true` and implements
  `trackBatch`, `reliability`'s `batch` option coalesces multiple queued
  events into one request instead of one-at-a-time — see
  `ReliabilityOptions.batch`'s doc comment in `src/index.ts`.
- Call `flush()`/`destroy()` before process exit in short-lived
  environments (serverless functions, CLI scripts) so any queued or
  client-buffered events aren't lost when the process terminates.
