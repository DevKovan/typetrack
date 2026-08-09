# 009 -- Comparison pages (`docs/comparison.md`)

## Context

Depends on issue 001. Read `plan/phase-17-documentation/BRIEF.md`'s Design
decisions 6 and 7 first (no fabricated performance numbers -- Phase 19 owns
those; RudderStack has no adapter in this repo, so its column compares
against direct RudderStack SDK usage, not a typetrack adapter that doesn't
exist). Independent of issues 002-008, 010.

## Scope of this issue

Write `docs/comparison.md`: typetrack vs. direct PostHog/Segment/RudderStack
SDK usage, structured as a capability comparison table followed by short
prose expansions, not a marketing page -- every claim cited against this
repo's own shipped code (a specific file/export), and every limitation
stated honestly (including typetrack's own, e.g. no RudderStack adapter
exists yet).

1. **Opening framing** (2-3 sentences): what problem this page answers --
   "I already know PostHog/Segment/RudderStack; what does typetrack change
   about how I use them?" Not "typetrack is better", but "here's what's
   structurally different".
2. **Comparison table**, rows = capability, columns = typetrack / direct
   PostHog SDK / direct Segment SDK / direct RudderStack SDK:
   - **Vendor lock-in**: typetrack -- swap one `AnalyticsProvider` (cite
     `examples/core/provider-switch`); direct SDKs -- every call site is
     coupled to that vendor's API shape.
   - **Canonical event model**: typetrack -- one `CanonicalEvent` shape
     across every provider (cite `src/schema.ts`); vendor SDKs -- each has
     its own native call shape (`posthog.capture({...})`,
     `analytics.track({...})`, RudderStack's `rudderanalytics.track(...)`).
   - **Compile-time event typing**: typetrack -- `EventMap`/`Events`
     generic on `createAnalytics<Events>()`, optional per-event Zod
     validation (`SchemaMap`); vendor SDKs -- `track(string, object)` with
     no compile-time payload shape checking.
   - **Multi-provider fan-out**: typetrack -- `provider: [...]` sends one
     `track()` call to every listed provider (cite `src/routing.ts`'s
     `normalizeProviders`); vendor SDKs -- calling multiple vendors means
     calling each one's own API separately, once per vendor, at every call
     site (or reaching for a separate CDP like Segment itself, which is a
     different category of tool, not a comparison point here).
   - **Per-provider routing/sampling**: typetrack -- `include`/`exclude`/
     `predicate`/`sampling` per provider (`ProviderEntry`); vendor SDKs --
     no equivalent (each vendor's own SDK only knows about itself).
   - **Offline queue / reliability**: typetrack -- opt-in offline queue
     with IndexedDB→localStorage→memory fallback, retry/backoff,
     dead-lettering (`reliability` option, cite `src/reliability/`);
     PostHog SDK -- has its own internal client-side batching (`flushAt`/
     `flushInterval`) but no offline-aware persistent queue; Segment SDK --
     similar client-side batching, no offline persistence; RudderStack SDK
     -- has its own separate offline/retry story in its own SDK (state this
     as "RudderStack's own SDK has its own answer to this, out of scope to
     fully characterize here" rather than guessing at its internals).
   - **Consent/privacy primitives**: typetrack -- `consent` option,
     `anonymousMode`, `cookieless`, `redactMiddleware`/`piiFilterMiddleware`
     built in and provider-agnostic (cite `src/consent.ts`,
     `src/middleware/{redact,piiFilter}.ts`); vendor SDKs -- each vendor has
     its own separate consent/opt-out mechanism, not shared across vendors.
   - **Framework wrapper coverage**: typetrack -- React, Next.js, Vue,
     Nuxt, Svelte, Solid, Astro, Remix, all provider-agnostic (cite
     `packages/`); vendor SDKs -- typically ship their own framework
     integration (if any), tied to that one vendor.
   - **Bundle size / performance**: link `docs/performance.md`'s size
     numbers for typetrack itself; state plainly that a numeric,
     apples-to-apples comparison against these three vendors' own SDK
     bundle sizes is Phase 19's job (`plan/ROADMAP.md`), not yet published
     here -- do not estimate or guess a number for the vendor SDKs.
3. **"When direct vendor SDK usage might still make sense"** -- one honest
   paragraph: if an app only ever needs exactly one vendor's own advanced,
   vendor-specific features (e.g. PostHog session replay/feature flags
   accessed through `posthog-js` directly, not through typetrack's
   `AnalyticsProvider` surface, which doesn't expose those) and has no
   plausible reason to ever switch/add a provider, the abstraction layer is
   pure overhead. This is a real, honest limitation, not hedging -- keep it
   short and specific rather than vague.

Every table row must cite a real file/export for its typetrack column, per
BRIEF.md Design decision 3's citation policy.

## Testing

Documentation-only. Verify every typetrack-column citation resolves to real,
current source. Run `bun run lint`, `bun run typecheck`, `bun test`, `bunx
knip`.

## Out of scope

Numeric performance/bundle-size comparisons -- Phase 19, see BRIEF.md
Design decision 6. A RudderStack `AnalyticsProvider` adapter -- not this
phase's job (see BRIEF.md Design decision 7); this page compares against
RudderStack's *direct SDK* only.
