# Roadmap (revised 2026-08)

Continues the repo's existing phase numbering — does not restart it.
Landed so far: Phase 0 (foundations), Phase 1 (core factory), Phase 2
(providers), Phase 3 (dev server + CLI), Phase 4 (React/Next wrappers),
Phase 5 (build system correctness). This roadmap defines Phase 6 onward,
reordered and expanded based on `plan/VISION.md` and `plan/GAP-ANALYSIS.md`.

## Policy changes from here on

- **Issue files are kept, not deleted.** Phases 0-4 deleted their
  `plan/phase-N-*/` issue files once merged; those were restored from git
  history. Going forward, `plan/phase-N-*/` stays in the repo permanently
  as the historical record — do not delete on merge.
- **Examples ship with the phase that builds the feature**, not a separate
  catch-up phase — see VISION.md's "Examples" section.
- **Provider plurality resolved**: `provider?: AnalyticsProvider |
  AnalyticsProvider[]` — single stays the default, array opts into fan-out.

## Phase 6 onward

**Phase 6 — Canonical event model + provider rework (breaking).** Highest
priority — everything below assumes this exists. Scope:
- Canonical event shape (`name`, `properties`, `timestamp`,
  `anonymousId`, `userId`, `sessionId`, `context`, `metadata`) replacing
  today's bare `EventMeta`.
- `AnalyticsProvider.track()`/`.page()` signatures updated to receive
  the canonical event; identity/session state moves into core, adapters
  stop reinventing it.
- Canonical→vendor event-name and property-name mapping tables added to
  each of the 3 existing adapters (GA4, PostHog, Segment) — replaces
  today's raw passthrough.
- `capabilities` field added to `AnalyticsProvider`; backfill on all 3
  adapters; defined ignore/warn/fallback policy for unsupported calls.
- Resolve the `flush()` terminal-vs-non-terminal disagreement between
  PostHog and Segment adapters into one documented lifecycle contract;
  add `reset()`/`destroy()`.
- Examples: `examples/core/` showing the canonical event shape and a
  provider-switch demo (same app code, swap one config line).

**Phase 7 — Multi-provider + routing.** `provider` accepts an array (per
the resolved decision), fan-out to all listed providers. Per-provider
include/exclude/wildcard/regex/predicate routing, priority, sampling.
Examples: `examples/providers/` multi-provider config with routing.

**Phase 8 — Middleware.** `analytics.use()`, before/after/error hooks.
Ship built-ins: redact PII, sampling, logging, enrichment, version/build
metadata injection, timing/tracing. Examples: `examples/middleware/`.

**Phase 9 — Context auto-capture.** Browser/device/OS/locale/timezone/
viewport/campaign/referrer/session/feature-flag capture, browser runtime.
Examples folded into `examples/core/` or a new `examples/frameworks/`
entry showing automatic context in a real page load.

**Phase 10 — Plugins.** `autoPage`, `autoClicks`, `autoErrors`,
`autoWebVitals`, `autoPerformance`, `autoScroll`, `autoVisibility`,
`autoUTM`. Generalize `@typetrack/next`'s `AnalyticsPageView` into the
generic `autoPage()` plugin (Next's version can become a thin wrapper over
it). Examples: `examples/plugins/`.

**Phase 11 — Privacy & consent.** Consent API, GDPR/CCPA support,
anonymous mode, cookie-less mode, PII filtering/redaction, provider-aware
consent gating. Examples: `examples/recipes/` (e.g. "consent-gated
tracking").

**Phase 12 — Reliability.** Offline queue (IndexedDB → localStorage →
memory fallback chain), `sendBeacon`, retries/backoff, batching, priority
queue, flush-on-unload. Examples: `examples/advanced/`.

**Phase 13 — Runtime-agnostic adapters.** PostHog/Segment adapters gain
browser/fetch-based variants (GA4 needs no change — already
runtime-agnostic). Cloudflare Workers/Vercel Edge/Bun/Deno explicit
support + SSR-safety verification. Examples: `examples/runtimes/`.

**Phase 14 — Remaining framework wrappers.** Vue, Nuxt, Svelte, Solid,
Astro, Remix (Angular optional/last). React/Next already shipped.
Examples: `examples/frameworks/` per framework.

**Phase 15 — Validation hardening.** Production stripping of runtime
validation, schema evolution/versioning, deprecated-event handling.
Examples folded into `examples/validation/`.

**Phase 16 — Testing infrastructure.** Shared contract test suite run
identically against every provider adapter, Playwright/e2e, snapshot
tests, bundle-size/performance tests.

**Phase 17 — Documentation.** Architecture guide, cookbook, migration
guide, provider guides, plugin guide, middleware guide, performance guide,
comparison pages, FAQ. (Per-feature examples already exist by this point
from phases 6-15 — this phase is prose/guides, not examples.)

**Phase 18 — Tooling extras.** Schema generator beyond the raw `/schema`
dump, VSCode extension, event inspector UI, documentation generator, debug
overlay.

**Phase 19 — Performance benchmarking.** Bundle size, cold start, memory,
throughput, tree-shaking; comparison against PostHog/Segment/RudderStack.

**Phase 20 — CI hardening.** Branch protection on `main`, required-checks
config, flaky-test triage. (Carried over from the original plan,
resequenced here since it's independent of the architecture work and
low-risk to defer.)

**Phase 21 — npm publish CI + SEO pass.** `release.yml`, `npm publish
--provenance`, keywords/README/badges. (Carried over from the original
plan — makes most sense once the public API from phases 6-7 has settled,
so the first published version reflects the real shape.)

## Explicitly out of scope for now (VISION.md "Future investigation")

Feature flags, experiments, remote config, warehouse adapters, webhook
providers, session replay adapters, heatmaps, funnels, commerce helpers,
OpenTelemetry exporter, edge analytics, AI event analysis. Revisit after
the above lands.
