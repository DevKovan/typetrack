# Architecture

How an event actually flows from `analytics.track()` to a real analytics
provider, and why the pieces are split the way they are.

## The Golden Rule

Your application depends only on `typetrack`, never on a vendor SDK
directly. Providers (`AnalyticsProvider` implementations) are swappable
implementation details. Switching providers means changing the one file
that constructs `createAnalytics({ provider })` — never application code,
event names, or payloads. See `plan/VISION.md` for the full rationale.

## The real event pipeline

`plan/VISION.md`'s "Core architecture pipeline (target)" section sketches
an aspirational diagram:

```
Application → Canonical Event → Validation → Middleware → Context →
Enrichment → Filtering → Sampling → Routing → Provider Mapping →
Provider Adapter → Analytics Provider
```

**This is not the order the shipped code actually runs in.** The real order
— read directly from `src/index.ts`'s `track()` implementation — is:

1. **Consent gate** (`isTrackingAllowed()`) — the very first check. If
   tracking is disabled (`enable()`/`disable()`) or a required consent
   category isn't granted, `track()` returns immediately: no dev-server
   mirror, no validation, no middleware, no provider call.
2. **Deprecated-event resolution** (`resolveDeprecatedEvent()`, from `src/
   deprecation.ts`) — a call using a name configured in `deprecatedEvents`
   is redirected to its `replacement` (if any) and a one-time warning is
   logged. Every downstream step sees the *resolved* name.
3. **Dev-server mirror** — if `devServer` is configured, a fire-and-forget
   `fetch()` posts the raw, unvalidated payload to a locally running
   `typetrack dev` server. This happens regardless of whether validation
   below succeeds or fails.
4. **Schema validation** (`schema.safeParse()`, from `src/schema.ts`) —
   only for events with a matching `schemas[event]` entry, and only when
   `validate` (default `true`) hasn't been turned off. A failure either
   calls `onValidationError` or throws `EventValidationError` — the
   provider is never called.
5. **Canonical-event construction** — `name`, `properties`, `timestamp`,
   `anonymousId`, `userId`, `sessionId` are assembled into one
   `CanonicalEvent`. **This is also where context capture happens** (`src/
   index.ts`'s `resolveEventContext()`, delegating to `src/context.ts`'s
   `captureDynamicContext()`), not as a separate post-validation pipeline
   stage — it's folded directly into building the event.
6. **Middleware `before` chain** (`runThroughMiddleware()`, `src/
   middleware.ts`'s `runBeforeChain()`) — every registered middleware's
   `before()` runs in registration order, each one able to transform or
   drop the event.
7. **Dispatch** — for a single bare provider, a direct call
   (`callSingleProvider()`); for multiple providers (an array, or a
   `ProviderEntry`), a fan-out (`dispatchToProviders()`) where **routing,
   sampling, capability-gating, and offline-queue decisions all happen
   per-provider, inside dispatch** (`shouldRouteToProvider()` in `src/
   routing.ts`) — not as one shared "Routing" stage that runs once before
   "Provider Mapping".
8. **Provider adapter** — the adapter's own `track()`/`page()`/`screen()`
   runs. Event-name and property-name mapping (e.g. GA4's `"Purchase
   Completed"` → `"purchase"`) is **adapter-internal** — core has no
   separate "Provider Mapping" stage of its own; each adapter owns its own
   translation table (see the [provider guides](./providers/ga4.md)).
9. **Middleware `after` chain** (`runAfterChain()`) — every registered
   middleware's `after()` runs in registration order, observing (never
   transforming) the dispatched event.

`page()`/`screen()` follow the same shape minus steps 2 and 4 (no
deprecated-event resolution or schema validation for those verbs).
`identify()`/`group()`/`alias()`/`reset()` have no `CanonicalEvent` and
never touch the middleware chain at all.

"Enrichment", "Filtering", and "Sampling" in the vision diagram above are
not fixed pipeline stages — they're **middleware** (`enrichmentMiddleware`,
any `before()` that returns `null`/`undefined` to drop an event) and
**per-provider routing config** (`ProviderEntry.sampling`), both opt-in and
composable, not a mandatory linear stage every event passes through
regardless of configuration.

## The canonical event model

Every `track()`/`page()`/`screen()` call is normalized into one
`CanonicalEvent` (`src/schema.ts`) before it reaches any provider:

```ts
export interface CanonicalEvent {
  name: string;
  properties: Record<string, unknown>;
  timestamp: number;
  anonymousId: string;
  userId?: string;
  sessionId: string;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
```

`anonymousId`/`sessionId` are generated once, in-memory, at
`createAnalytics()` construction time (`crypto.randomUUID()`); `userId` is
set by `identify()`. This identity/session state lives in core — provider
adapters no longer generate or cache any of it themselves, they simply read
it off the `CanonicalEvent` they're given. `context` is populated only when
`context` auto-capture is enabled; `metadata` comes from `TrackOptions
.metadata` and/or the instance-level `schemaVersion` tag.

## Provider independence

Every provider implements one shared interface (`src/providers/index.ts`):

```ts
export interface AnalyticsProvider {
  name: string;
  capabilities: ProviderCapabilities;
  init?(config: Record<string, unknown>): void | Promise<void>;
  track(event: CanonicalEvent): void | Promise<void>;
  identify?(userId: string, traits: Record<string, unknown> | undefined, anonymousId: string): void | Promise<void>;
  group?(groupId: string, traits: Record<string, unknown> | undefined, identity: { userId?: string; anonymousId: string }): void | Promise<void>;
  alias?(newUserId: string, previousUserId: string | undefined, anonymousId: string): void | Promise<void>;
  page?(event: CanonicalEvent): void | Promise<void>;
  screen?(event: CanonicalEvent): void | Promise<void>;
  flush?(): Promise<void>;
  reset?(): void | Promise<void>;
  destroy?(): Promise<void>;
  trackBatch?(events: CanonicalEvent[]): void | Promise<void>;
}
```

Only `name`, `capabilities`, and `track` are required — everything else is
optional. `ProviderCapabilities` declares which optional verbs/features a
given provider actually supports (`identify`, `group`, `alias`, `page`,
`screen`, `batching`, `offline`, `featureFlags`, `sessionReplay`,
`heatmaps`, plus the newer optional `batch`/`runtimes` flags). Core reads
this to decide whether to call an optional method at all
(`isCapabilitySupported()` in `src/index.ts`): a capability declared
`false` (or an optional method that's simply absent) produces a one-time
`console.warn` and the call is skipped — never a thrown error, and never a
silent call into `undefined`.

## Single vs. multi-provider

```ts
provider?: AnalyticsProvider | ProviderEntry | (AnalyticsProvider | ProviderEntry)[];
```

A single bare `AnalyticsProvider` keeps the simplest, fastest path — no
routing evaluation, no `Promise.allSettled` fan-out wrapping
(`normalizeProviders()` in `src/routing.ts` sets `isMulti: false`). Wrapping
it in a `ProviderEntry`, or supplying an array (of any length, including 0
or 1), opts into the multi-provider fan-out path, unlocking per-provider
`include`/`exclude`/`predicate`/`sampling`/`priority`/`requiresConsent`:

```ts
export interface ProviderEntry {
  provider: AnalyticsProvider;
  include?: RouteMatcher[];
  exclude?: RouteMatcher[];
  predicate?: (event: CanonicalEvent) => boolean;
  sampling?: number;
  priority?: number;
  requiresConsent?: ConsentCategory[];
}
```

See the [cookbook](./cookbook.md) for a routing example, and
`examples/providers/multi-provider-routing` for a full runnable one.

## Extension points

- **Middleware** (`.use()`) — transforms/observes events already in flight.
  See [`docs/middleware.md`](./middleware.md).
- **Plugins** (`options.plugins`) — originate their own `track()`/`page()`
  calls (e.g. automatic click/scroll/error tracking). See
  [`docs/plugins.md`](./plugins.md).
- **Consent** (`options.consent`, `analytics.consent`) — gates the six
  data-carrying verbs behind granted/denied categories.
- **Reliability** (`options.reliability`, `analytics.queue`) — an opt-in
  offline queue with retry/backoff and a fallback storage chain
  (IndexedDB → localStorage → memory).
- **Context auto-capture** (`options.context`) — browser/device/session
  context merged onto every event's `context` field.

## Why this shape

Two of `plan/VISION.md`'s "Evaluation questions for every architectural
decision" grounded in this repo's real, shipped code:

**"Can users switch providers by editing one config file?"** Yes — see
`examples/core/provider-switch/app.ts`, a single provider-agnostic checkout
flow (`identify`/`track`/`flush`/`destroy` calls) reused unmodified across
multiple entry points that each construct a different `AnalyticsProvider`
(`noopProvider`, a local GA4 stub, a real `createGA4Provider`). The business
logic file never changes.

**"Is it tree-shakeable?"** Yes — every middleware and plugin is a separate
named export from `src/index.ts` (e.g. `export { redactMiddleware } from
"./middleware/redact"`, `export { autoPage } from "./plugins/autoPage"`).
An application that imports only `createAnalytics` and never registers
`redactMiddleware` never pulls that middleware's code into its bundle. See
[`docs/performance.md`](./performance.md) for the full "what's free, what's
opt-in cost" breakdown.
