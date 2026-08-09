# 002 -- Architecture guide (`docs/architecture.md`)

## Context

Depends on issue 001 (`docs/README.md` must link here). Read `plan/
phase-17-documentation/BRIEF.md`'s "A stale-vision correction" section
first -- this issue is where that corrected pipeline order is written down
for real, permanently, as the guide's centerpiece diagram/section.

## Scope of this issue

Write `docs/architecture.md` covering, in this order:

1. **The Golden Rule** (one paragraph, from `plan/VISION.md`): applications
   depend only on `typetrack`; providers are swappable implementation
   details behind `AnalyticsProvider`.
2. **The real event pipeline**, for `track()` specifically (call out where
   `page()`/`screen()` differ -- no schema validation/deprecated-event
   step): consent gate → deprecated-event resolution → dev-server mirror →
   schema validation → canonical-event construction (context capture
   happens here) → middleware `before` chain → dispatch (routing/sampling/
   capability-gating/reliability-queue decisions, per provider) → provider
   adapter (event/property mapping is adapter-internal) → middleware
   `after` chain. Cite the real file/function for each step (`src/
   index.ts`'s `isTrackingAllowed()`, `resolveDeprecatedEvent()`,
   `schema.safeParse()`, `buildEvent`/`resolveEventContext()`,
   `runThroughMiddleware()`, `dispatchToProviders()`/
   `callSingleProvider()`, `shouldRouteToProvider()` in `src/routing.ts`).
   Include the explicit, short callout that this differs from `plan/
   VISION.md`'s aspirational pipeline diagram, and how (per BRIEF.md's
   correction) -- readers who already skimmed the vision doc should not be
   confused by the difference.
3. **The canonical event model**: `CanonicalEvent`'s exact fields (`src/
   schema.ts`) -- `name`, `properties`, `timestamp`, `anonymousId`,
   `userId`, `sessionId`, `context`, `metadata` -- and where each is
   populated (identity/session generated once at construction in `src/
   index.ts`, `context` populated by `src/context.ts`'s static+dynamic
   capture when `context` is enabled, `metadata` from `TrackOptions`/
   `schemaVersion`).
4. **Provider independence**: `AnalyticsProvider`'s interface shape (`src/
   providers/index.ts`) -- required `name`/`capabilities`/`track`, optional
   `identify`/`group`/`alias`/`page`/`screen`/`flush`/`reset`/`destroy`/
   `trackBatch` -- and `ProviderCapabilities`' role in gating optional-verb
   calls (`isCapabilitySupported()` in `src/index.ts`: a `false`/absent
   capability produces a one-time `console.warn`, never a thrown error or a
   silent wrong call).
5. **Single vs. multi-provider**: `provider?: AnalyticsProvider |
   ProviderEntry | (AnalyticsProvider | ProviderEntry)[]` (`src/index.ts`'s
   `CreateAnalyticsOptions.provider`) -- the single-bare-provider fast path
   vs. the `ProviderEntry`/array opt-in fan-out path (`normalizeProviders()`
   in `src/routing.ts`), and per-provider `include`/`exclude`/`predicate`/
   `sampling`/`priority`/`requiresConsent` routing knobs.
6. **Extension points, one paragraph each, with a pointer to the dedicated
   guide**: middleware (`.use()`, `docs/middleware.md`), plugins
   (`options.plugins`, `docs/plugins.md`), consent (`options.consent`,
   `analytics.consent`), reliability/offline queue (`options.reliability`,
   `analytics.queue`), context auto-capture (`options.context`).
7. **A short "why this shape" section** answering, in typetrack's own real
   terms (not abstractly), a few of `plan/VISION.md`'s "Evaluation questions
   for every architectural decision" -- specifically #2 ("can users switch
   providers by editing one config file") and #5 ("tree-shakeable"), each
   grounded in a real, cited example (`examples/core/provider-switch`'s
   `app.ts` for #2; `src/index.ts`'s named-export-per-middleware/plugin
   pattern, e.g. `export { redactMiddleware } from "./middleware/redact"`,
   for #5 -- an app importing only `createAnalytics` never pulls in
   `redactMiddleware`'s code).

Every code sample in this guide must satisfy BRIEF.md Design decision 3
(verbatim-with-citation, or clearly-labeled illustrative). Prefer real,
short excerpts from `src/index.ts`/`src/providers/index.ts`/`src/
schema.ts` over invented examples wherever the real source is short enough
to quote directly.

## Testing

Documentation-only. Verify by hand that every cited file/function/line
actually exists as described (re-read the cited source while writing, not
from memory of this issue's own context). Run `bun run lint`, `bun run
typecheck`, `bun test`, `bunx knip` to confirm no regression.

## Out of scope

Provider-specific config/setup detail beyond what's needed to explain
`AnalyticsProvider`/`ProviderCapabilities` generically -- issue 005 owns the
per-adapter guides. Step-by-step task recipes -- issue 003 (cookbook).
