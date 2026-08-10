# Comparison: typetrack vs. direct vendor SDK usage

If you already know PostHog, Segment, or RudderStack, this page answers:
"what does typetrack structurally change about how I use them?" It is not
a "typetrack is better" pitch — every claim below cites this repo's own
shipped code, and the last section is an honest look at when the direct
SDK is the right call instead.

## Capability comparison

| Capability | typetrack | Direct PostHog SDK | Direct Segment SDK | Direct RudderStack SDK |
|---|---|---|---|---|
| Vendor lock-in | Swap one `AnalyticsProvider` (`examples/core/provider-switch`); app code never changes | Every call site coupled to PostHog's API shape | Every call site coupled to Segment's API shape | Every call site coupled to RudderStack's API shape |
| Canonical event model | One `CanonicalEvent` shape across every provider (`src/schema.ts`) | Native `posthog.capture({...})` shape | Native `analytics.track({...})` shape | Native `rudderanalytics.track(...)` shape |
| Compile-time event typing | `EventMap`/`Events` generic on `createAnalytics<Events>()`, optional per-event Zod validation (`SchemaMap`) | Untyped `capture(string, object)` | Untyped `track(string, object)` | Untyped `track(string, object)` |
| Multi-provider fan-out | `provider: [...]` sends one `track()` to every listed provider (`src/routing.ts`'s `normalizeProviders`) | N/A — one vendor | N/A — one vendor | N/A — one vendor |
| Per-provider routing/sampling | `include`/`exclude`/`predicate`/`sampling` per provider (`ProviderEntry`) | No equivalent | No equivalent | No equivalent |
| Offline queue / reliability | Opt-in offline queue, IndexedDB→localStorage→memory fallback, retry/backoff, dead-lettering (`reliability` option, `src/reliability/`) | Own internal client-side batching (`flushAt`/`flushInterval`), no offline-aware persistent queue | Similar client-side batching, no offline persistence | Has its own separate offline/retry story in its own SDK — out of scope to fully characterize here |
| Consent/privacy primitives | `consent` option, `anonymousMode`, `cookieless`, `redactMiddleware`/`piiFilterMiddleware`, all provider-agnostic (`src/consent.ts`, `src/middleware/`) | Vendor-specific opt-out mechanism | Vendor-specific opt-out mechanism | Vendor-specific opt-out mechanism |
| Framework wrapper coverage | React, Next.js, Vue, Nuxt, Svelte, Solid, Astro, Remix — all provider-agnostic (`packages/`) | Own framework integration, if any, tied to PostHog only | Own framework integration, if any, tied to Segment only | Own framework integration, if any, tied to RudderStack only |
| Bundle size / performance | typetrack core: 15,810 B gzip (ESM) vs. PostHog 77,616 B, Segment 28,246 B, RudderStack 31,123 B — see [`docs/performance.md`](./performance.md#comparative-benchmarks-vs-posthogsegmentrudderstack) | See [`docs/performance.md`](./performance.md#comparative-benchmarks-vs-posthogsegmentrudderstack) | See [`docs/performance.md`](./performance.md#comparative-benchmarks-vs-posthogsegmentrudderstack) | See [`docs/performance.md`](./performance.md#comparative-benchmarks-vs-posthogsegmentrudderstack) |

A numeric, apples-to-apples bundle-size/cold-start/memory/throughput
comparison against these three vendors' own SDKs now exists — see
[`docs/performance.md`](./performance.md#comparative-benchmarks-vs-posthogsegmentrudderstack)
for the real tables and each result file's full methodology/fairness
caveats. This page stays qualitative and capability-focused; it doesn't
duplicate those numbers.

**RudderStack has no typetrack adapter yet** — the "Direct RudderStack
SDK" column above describes using RudderStack's own SDK directly, not a
`@typetrack/provider-rudderstack` package (none exists in this repo).

## What each row means in practice

**Vendor lock-in.** `examples/core/provider-switch/app.ts` is a single,
provider-agnostic checkout flow (`identify`/`track`/`flush`/`destroy`
calls) reused unmodified across multiple entry points, each constructing a
different real provider. With a direct SDK, every one of those call sites
is written against that one vendor's method names and payload shape —
adding or replacing a vendor means touching every call site, not one
config file.

**Canonical event model.** Whatever provider you plug in, its `track()`
receives the same `CanonicalEvent` (`name`, `properties`, `timestamp`,
`anonymousId`, `userId`, `sessionId`, `context`, `metadata`). Event-name
and property-name translation to each vendor's own convention happens
inside the adapter (see the [provider guides](./providers/ga4.md)) — your
application code only ever speaks typetrack's canonical shape.

**Reliability.** typetrack's `reliability` option is a full offline
queue with a storage fallback chain, priority ordering, exponential
backoff, dead-lettering after `maxAttempts`, and a `pagehide`-driven
best-effort unload flush — see `examples/advanced/offline-resilient-
tracking` for all of it composed in one realistic session. PostHog's and
Segment's own SDKs batch client-side (reducing request count) but don't
persist across an offline gap or a page reload the way this does.

## When direct vendor SDK usage might still make sense

If your app only ever needs exactly one vendor's advanced, vendor-specific
features accessed through that vendor's own SDK surface — for example,
PostHog session replay or feature-flag evaluation via `posthog-js`
directly, which typetrack's `AnalyticsProvider` interface doesn't expose —
and you have no plausible reason to ever add or switch providers, the
abstraction layer here is pure overhead with no offsetting benefit. That's
a real, honest tradeoff: typetrack optimizes for "I might need to change
providers, fan out to several, or add typed validation later", not for
"I need every corner of one vendor's SDK, forever."
