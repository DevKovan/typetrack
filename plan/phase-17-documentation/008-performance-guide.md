# 008 -- Performance guide (`docs/performance.md`)

## Context

Depends on issue 001. Independent of issues 002-007, 009-010. Read `plan/
phase-16-testing-infrastructure/BRIEF.md`'s Design decision 3 first (the
existing performance *smoke test* is a narrow regression guard, not
comparative benchmarking -- Phase 19 owns comparative numbers; this guide
must not claim to be that).

## Scope of this issue

Write `docs/performance.md`:

1. **What's measured today, and where.** Two real, cited sources of truth,
   not invented numbers:
   - `src/index.performance.test.ts` -- a regression smoke test asserting
     `createAnalytics()` construction and `track()` dispatch each stay
     under a generous per-call budget (0.1ms/call) against a `noopProvider`
     with no middleware/routing/reliability/context/schemas enabled --
     quote its own documented observed-locally averages (~0.0008ms/call
     construction, ~0.00035ms/call dispatch) as *illustrative order-of-
     magnitude* numbers, explicitly labeled "observed on one machine, not a
     guaranteed number" -- not asserted as a portable benchmark result.
   - `.size-limit.json` (root) -- the real, current gzip size budgets per
     built artifact, reproduced as a table: `dist/index.js` (ESM) 18 KB,
     `dist/index.global.js` (IIFE/CDN) 12.5 KB, and each framework
     package's own budget (`@typetrack/react` 480 B, `@typetrack/next`
     650 B, `@typetrack/vue` 480 B, `@typetrack/nuxt` 950 B,
     `@typetrack/svelte` 650 B, `@typetrack/solid` 440 B, `@typetrack/astro`
     800 B, `@typetrack/remix` 550 B) -- checked via `bun run size` in CI.
     State plainly that comparative bundle-size/cold-start/memory/
     throughput numbers *against* PostHog/Segment/RudderStack are Phase
     19's job (`plan/ROADMAP.md`), not yet published -- link `docs/
     comparison.md` for the qualitative (non-numeric) comparison that
     exists today.
2. **What's zero-cost when unused (tree-shaking).** Every middleware/plugin
   is a separate named export (`export { redactMiddleware } from
   "./middleware/redact"`, etc.) -- an app that never imports/registers a
   given built-in never pays for its code in a tree-shaking bundler. Cite
   `src/index.ts`'s export list directly.
3. **What's opt-in cost, explained per feature** (a short paragraph each,
   citing the real gating mechanism so a reader can verify the claim):
   - `context: true` -- `Intl`/UA-parsing work happens once at construction
     (`captureStaticContext`) plus a small amount of work per `track`/
     `page`/`screen` call (`captureDynamicContext`) *only* when enabled;
     `staticContext === undefined` is the single "off" signal checked
     before any of that work runs (cite `src/index.ts`'s
     `resolveEventContext`).
   - `reliability: true` -- adds a `setInterval` drain-loop tick every 5s
     (`DRAIN_INTERVAL_MS`) and (outside a browser environment, none) an
     `online`/`pagehide` listener pair -- all dead code when omitted
     (`queueEngine` stays `undefined`, every call site short-circuits).
   - Middleware chain -- the **zero-middleware fast path**: when
     `middlewares.length === 0`, `runThroughMiddleware` calls `dispatch()`
     directly with no `before`/`after` chain wrapping, so a
     zero-middleware `Analytics` instance's `track()` return value passes
     through completely unwrapped (no extra microtask tick) -- cite `src/
     index.ts`'s `runThroughMiddleware` doc comment, which documents this
     exact guarantee.
   - Single-provider fast path -- `provider: aSingleProvider` (not an
     array/`ProviderEntry`) skips `Promise.allSettled` fan-out wrapping and
     routing evaluation entirely (`normalized.isMulti === false`), calling
     the provider directly -- cite `normalizeProviders()`'s doc comment in
     `src/routing.ts`.
   - Plugins -- every built-in `auto*` plugin no-ops immediately (returns
     `undefined`, attaches no listener) outside a browser environment, via
     `isBrowserEnvironment()` -- cite one plugin file's own "Browser-only...
     No-ops... outside a browser environment" comment as representative.
   - Validation (`schemas`) -- only events with a `schemas[event]` entry
     pay the `schema.safeParse()` cost; everything else forwards raw,
     unvalidated (and `validate: false` disables it entirely, for
     production-bundle stripping -- link `docs/cookbook.md`'s stripping
     recipe rather than re-explaining it here).
4. **Practical guidance**: when to reach for `samplingMiddleware`/
   `ProviderEntry.sampling` to cut event volume before it reaches a
   provider (link `docs/middleware.md`), when `reliability`'s `batch`
   option reduces request count for a batch-capable provider (cite
   `ReliabilityOptions.batch`'s doc comment in `src/index.ts`), and that
   `flush()`/`destroy()` should be called before process exit in
   short-lived environments (serverless functions, CLI scripts) so queued/
   client-buffered events aren't lost.

## Testing

Documentation-only. Every number in this guide must be copied from the real
current `.size-limit.json`/`src/index.performance.test.ts` files (re-read
them while writing, not from memory of this issue file's own drafted
numbers, in case either file has changed since this issue was written). Run
`bun run lint`, `bun run typecheck`, `bun test`, `bunx knip`.

## Out of scope

Comparative benchmarking against other vendors -- Phase 19. Bundle-size
tooling internals (`size-limit` config/CI wiring) -- already covered by
`plan/phase-16-testing-infrastructure/`; this guide only reports the
resulting numbers/policy, doesn't re-explain the tool.
