# TypeTrack — architecture vision

Source of truth for where typetrack is headed. Written 2026-08, supersedes
nothing in CLAUDE.md except where CLAUDE.md explicitly says so (provider
plurality — see CLAUDE.md).

## Tagline

Typed, zero-runtime-cost analytics SDK for JS/TS with compile-time event
schemas, provider adapters, and modern runtime support.

Long-term goal: "Prisma for Analytics" — one API, many providers, complete
type safety, no vendor lock-in.

## The Golden Rule

The application must never depend on an analytics vendor. Applications
depend only on `typetrack`. Providers are implementation details. Switching
providers should require changing one file only — no application code,
event names, payloads, components, hooks, or business logic changes. This
is the primary USP. If a design violates this, reconsider the design.

## Engineering principles

Strict TypeScript, zero `any`, excellent inference, ESM-first,
tree-shakeable, side-effect free, tiny bundle size, framework agnostic,
runtime agnostic, performance first, excellent DX, minimal dependencies,
SOLID where practical, composition over inheritance, functional style
preferred, strong testing, clean documentation.

## Core architecture pipeline (target)

```
Application → Canonical Event → Validation → Middleware → Context →
Enrichment → Filtering → Sampling → Routing → Provider Mapping →
Provider Adapter → Analytics Provider
```

Application code never sees provider-specific APIs.

## Universal Event Model (target)

Canonical event: `name`, `properties`, `timestamp`, `anonymousId`,
`userId`, `sessionId`, `context` (page, screen, url, path, title, referrer,
locale, timezone, browser, os, device, viewport, campaign, featureFlags),
`metadata`. Providers convert *from* this model; never expose
provider-specific shapes to applications.

## Provider independence

Providers are plugins: GA4, PostHog, Segment, Mixpanel, Amplitude,
Plausible, Umami, Console, custom. Applications only ever call: `track()`,
`identify()`, `page()`, `screen()`, `group()`, `alias()`, `flush()`,
`reset()`, `enable()`, `disable()`, `destroy()`.

## Provider plurality (resolved — see CLAUDE.md)

`provider?: AnalyticsProvider | AnalyticsProvider[]`. Single stays the
ergonomic default (majority of real usage); an array opts into fan-out.
This differs from the vision doc's original `providers: [...]`-only
example — resolved in favor of a friendlier default with an escape hatch,
not a hard array requirement.

## Provider routing (target)

Per-provider include/exclude/wildcard/regex/predicate-function rules,
priorities, sampling. Example:
```
ga4({ events: { include: ["purchase", "page_view"] } })
posthog({ events: { include: ["*"] } })
segment({ events: { exclude: ["debug.*"] } })
```

## Event & property mapping (target)

Applications use canonical names (`"Purchase Completed"`); each adapter
maps to its own vendor event name (GA4 → `purchase`, Segment → `Order
Completed`, Mixpanel → `Purchase Completed`) and vendor property names
(canonical `orderId/total/currency` → GA4 `transaction_id/value/currency`,
Segment `order_id/revenue/currency`, PostHog as-is). Mapping lives only
inside adapters — never leaks into application code.

## Provider capabilities (target)

Every provider declares capabilities: identify, group, alias, page,
screen, batching, offline, featureFlags, sessionReplay, heatmaps.
Unsupported calls never crash — ignore/warning/fallback, a defined policy,
not silent no-ops.

## Middleware (target)

`analytics.use(...)` — redact PII, sampling, logging, filtering,
enrichment, version injection, build metadata, timing, tracing.
before/after/error hooks, provider-specific middleware.

## Plugins (target)

`autoPage()`, `autoClicks()`, `autoErrors()`, `autoWebVitals()`,
`autoPerformance()`, `autoScroll()`, `autoVisibility()`, `autoUTM()`.
Compose cleanly.

## Context system (target)

Automatic capture: browser, device, OS, locale, timezone, viewport,
campaign, referrer, session, feature flags, user traits, custom providers.

## Validation (partially built)

Compile-time schemas, runtime validation (optional), production stripping,
schema evolution, deprecated events, versioning, type inference,
autocomplete.

## Privacy (target)

Consent API, GDPR, CCPA, anonymous mode, cookie-less mode, PII filtering,
redaction, provider-aware consent.

## Reliability (target)

Offline queue (IndexedDB, localStorage fallback, memory queue),
`sendBeacon`, retries, backoff, batching, priority queue, flush on unload,
graceful failures.

## Performance (target)

Benchmark bundle size, cold start, memory, throughput, tree shaking.
Compare against PostHog, Segment, RudderStack.

## Framework integrations (target)

React, Next.js, Vue, Nuxt, Svelte, Solid, Astro, Remix, Angular (optional).

## Runtime support (target)

Browser, Node, Cloudflare Workers, Vercel Edge, Bun, Deno, SSR-safe.

## Tooling (target)

CLI, live validation server, schema generator, VSCode extension, event
inspector, documentation generator, debug overlay.

## Testing (target)

Unit, integration, contract tests, type tests, Playwright, snapshot,
performance, bundle size. Every provider passes identical contract tests.

## Documentation (target)

Every public API documented: architecture guide, cookbook, migration
guide, provider guides, plugin guide, middleware guide, performance guide,
comparison pages, FAQ.

## Examples — mandatory, per-phase (policy)

Every feature ships its `examples/` entries as part of the same phase that
built it — never deferred to a catch-up phase, so examples never drift
from what's actually shipped. Directory shape:
`examples/{core,providers,plugins,middleware,frameworks,runtimes,
validation,recipes,advanced,playground}/`. Realistic event names only
("User Signed Up", "Checkout Started", "Purchase Completed" — never
`test`/`foo`/`bar`). Every provider example: init, track, identify, page,
screen, group, alias, flush, reset, shutdown, error handling, custom
properties, provider-specific options. Every plugin example: install,
config, usage, customization, limitations. Every middleware example: basic
usage, composition, execution order, error handling, performance notes.
Every framework example: install, SSR, CSR, hydration, production. Every
runtime example: browser, node, bun, deno, cloudflare workers. Every
example: README, source, expected output, explanation, production notes.

## Future investigation (not yet scoped into any phase)

Feature flags, experiments, remote config, warehouse adapters, webhook
providers, session replay adapters, heatmaps, funnels, commerce helpers,
OpenTelemetry exporter, edge analytics, AI event analysis.

## Evaluation questions for every architectural decision

1. Does this reduce vendor lock-in?
2. Can users switch providers by editing one config file?
3. Is the API provider-agnostic?
4. Is it fully typed?
5. Tree-shakeable?
6. Runtime-agnostic?
7. Easy to understand?
8. Improves DX?
9. Maintains backward compatibility?
10. Would this scale to 30+ providers?

If any answer is "no," revisit the design before implementing.
