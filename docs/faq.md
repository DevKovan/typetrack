# FAQ

Fast answers. Most of these link to a deeper guide — this page rarely is
the deepest source of truth on any one topic.

**Do I need a provider to use typetrack?**
No. `provider` is optional and defaults to `noopProvider`, which accepts
every call and does nothing — useful for local development or testing
before you've wired up a real vendor. See `createAnalytics()`'s default in
`src/index.ts`.

**What happens if I call `identify()`/`group()`/`alias()`/`page()`/
`screen()` against a provider that doesn't support it?**
A one-time `console.warn`, and the call is otherwise a no-op — never a
thrown error, never a silent call into `undefined`. See
[`docs/architecture.md`](./architecture.md#provider-independence).

**Can I send the same event to multiple providers with different
payloads?**
Not directly — `provider: [...]` fans the *same* `CanonicalEvent` out to
every listed provider (each adapter does its own event/property
translation internally). If one provider genuinely needs different data,
reach for `enrichmentMiddleware`/a custom `before()`, or
`redactMiddleware`/`piiFilterMiddleware` if it needs *less*. See
[`docs/middleware.md`](./middleware.md).

**Why does `track()` sometimes return `void` and sometimes a `Promise`?**
The zero-middleware, single-provider fast path returns whatever the
provider's own `track()` returns (often synchronous `void`); registering
middleware or using a multi-provider array always returns a `Promise`. See
[`docs/performance.md`](./performance.md#whats-opt-in-cost).

**Is validation required?**
No. `schemas` is optional per event — an event with no `schemas[event]`
entry is forwarded unvalidated. `validate: false` disables validation
instance-wide (e.g. for production bundle stripping). See
[`docs/cookbook.md`](./cookbook.md#validate-event-payloads-at-runtime-with-zod).

**What toolchain does typetrack need?**
Bun (install + test runner), `tsgo` (`@typescript/native-preview`) for fast
typechecking, TypeScript 6.x (`tsc`) as the emit/source-of-truth compiler.
`zod` is an **optional** peer dependency — only needed if you use
`schemas` (see root `package.json`'s `peerDependenciesMeta.zod.optional`).

**Does typetrack work in Cloudflare Workers / Vercel Edge / Bun / Deno?**
Depends on the adapter — core itself is runtime-agnostic. Each provider
adapter declares its own verified `capabilities.runtimes`: GA4 runs
everywhere (`["node","browser","edge","bun","deno"]`, pure `fetch`,
no SDK); PostHog's SDK variant is `["node","edge","bun","deno"]` (no
browser — its fallback build unconditionally requires `node:fs`); Segment's
SDK variant is `["node","bun","deno"]` only (no browser/edge — an
unverified transitive dependency). Both PostHog and Segment ship a
zero-dependency `fetch()`-based variant that runs everywhere, including
browsers. See the [provider guides](./providers/ga4.md) for the full
per-adapter detail.

**How do I test my analytics code without hitting a real vendor?**
`noopProvider` for "accept everything, do nothing"; a hand-written fake
`AnalyticsProvider` object for asserting on calls in tests; `typetrack dev`
(local dev server + CLI, `bunx typetrack dev`) for a real local endpoint
that validates against your real schemas and shows events live as they
arrive. See [`docs/cookbook.md`](./cookbook.md#run-typetrack-dev-to-inspect-events-locally).

**Is typetrack published to npm yet?**
No — as of this writing (`plan/ROADMAP.md`'s Phase 21, "npm publish CI +
SEO pass", has not landed), typetrack is source-only. Building from source
is the only way to use it today; see the root [`README.md`](../README.md)'s
"Building from source" section.

**Where do I report a bug or ask a question not covered here?**
This repository has no `CONTRIBUTING.md` or issue template as of this
writing — open a GitHub issue on this repository directly.
