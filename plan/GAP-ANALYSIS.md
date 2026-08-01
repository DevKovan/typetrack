# Gap analysis: current state vs. VISION.md (2026-08)

Produced by auditing `src/`, `packages/*/src/`, tests, and CI as they stood
on `main` after Phase 4 (React/Next wrappers), before the build-system
phase and before any of the rework phases below started. Cite file paths
when acting on this — code may have moved since.

## 1. Current architecture summary (as of the audit)

**Core (`src/index.ts`)**: `createAnalytics<Events>()` → `track/identify/
page/flush` only (no `screen/group/alias/reset/enable/disable/destroy`).
`provider?: AnalyticsProvider` was singular at audit time (now revised —
see CLAUDE.md and VISION.md "Provider plurality"). Optional per-event Zod
schemas via `z.infer`, configurable `onValidationError`. `EventMeta` =
`{ timestamp }` only — no `anonymousId`/`userId`/`sessionId`/`context`.

**Provider interface (`src/providers/index.ts`)**: `name`, `init?`,
`track`, `identify?`, `page?`, `flush?`. No capabilities field, no routing
config.

**Adapters (`packages/provider-{ga4,posthog,segment}`)**: all three are
1:1 passthrough — the app's own event string/payload forwarded verbatim to
the vendor SDK/API, no canonical→vendor name or property translation.
Each independently reinvents anonymous/identified-user state. All
server-side only (Node SDKs or server-side fetch), `private: true`.

**Dev server + CLI, React/Next wrappers**: solid, scoped correctly, not
implicated in the gaps below.

**Missing entirely, confirmed by grep**: middleware, plugins, context
capture, consent/privacy, offline/reliability, routing, capabilities
declaration, canonical event model, `examples/` directory.

## 2. Conflicts found against the vision doc (at audit time)

- Single-provider vs. array — **resolved**, see CLAUDE.md ("Single
  provider by default, array to opt into multi-provider fan-out").
- Adapters do raw passthrough, not canonical→vendor translation — vision
  doc assumes translation lives in the adapter; today there's no canonical
  model to translate *from*.
- No capabilities declaration — unsupported provider methods just silently
  no-op via `provider.identify?.(...)`, no ignore/warn/fallback contract.
- `EventMeta` carries none of the canonical event model's fields.
- No `.use()` middleware pipeline exists anywhere.
- Only 4 of the 11 target verbs implemented (`track/identify/page/flush`).
- No routing config accepted by any provider factory.

## 3. Gaps by vision-doc section (● = exists, ◐ = partial, ○ = missing)

- ○ Universal Event Model
- ◐ Provider Independence (seam exists via `AnalyticsProvider`, undermined
  by passthrough mapping — see risk below)
- ● Provider plurality (resolved: single default + array opt-in)
- ○ Provider Routing
- ○ Event / Property Mapping
- ○ Provider Capabilities
- ○ Middleware
- ○ Plugins (Next's `AnalyticsPageView` is a hand-rolled one-off analog of
  `autoPage()`, not a generic composable plugin)
- ○ Context System
- ◐ Validation (per-event Zod schemas, `z.infer`, `onValidationError`,
  live `/schema` endpoint, hot-reload — missing: production stripping,
  schema evolution/versioning, deprecated-event handling)
- ○ Privacy
- ○ Reliability (offline queue, sendBeacon, retries/backoff, batching,
  flush-on-unload)
- ○ Performance benchmarking
- ◐ Framework Integrations (React + Next/App-Router only; missing Vue,
  Nuxt, Svelte, Solid, Astro, Remix, Angular)
- ◐ Runtime Support (core is runtime-light; dev server is Bun-specific;
  PostHog/Segment adapters are Node-SDK-only, not edge/browser-capable;
  GA4 adapter is already runtime-agnostic via plain fetch)
- ◐ Tooling (CLI + dev/validation server mature; missing schema generator
  beyond raw JSON-Schema dump, VSCode extension, event inspector,
  doc generator, debug overlay)
- ◐ Testing (good unit/integration/type-test coverage per feature; missing
  cross-provider contract tests, Playwright/e2e, snapshot, perf/bundle-size
  tests)
- ○ Documentation (README is a 33-line quickstart, CLAUDE.md is a decisions
  log — no architecture guide/cookbook/migration guide/provider guides/
  plugin guide/middleware guide/performance guide/comparison pages/FAQ)
- ○ Examples (`examples/` directory doesn't exist)

## 4. Technical debt / inconsistencies found

- `file:`-protocol cross-package hardlink fragility (tsup's `clean: true`
  detaches Bun's hardlinks) — being fixed on a dedicated build-system phase
  in parallel with this analysis; don't re-diagnose, just build on top of
  whatever that phase lands.
- **Divergent `flush()` semantics** across adapters: PostHog's is
  non-terminal/reusable, Segment's is terminal (`closeAndFlush()`, adapter
  unusable after). The `AnalyticsProvider.flush?()` contract doesn't
  specify which is correct — the two shipped adapters already disagree.
  Must be resolved as part of the lifecycle rework (with `reset()`/
  `destroy()`).
- **Duplicated identity-management logic**: each adapter reinvents
  anonymous-ID generation and identify-then-promote state independently,
  three different shapes, no shared model in core.
- No capability-based degrade path — unsupported methods silently no-op.
- No TODO/FIXME markers anywhere — existing code is deliberately complete
  for its scope; the gaps above are scope gaps, not sloppy implementation.

## 5. Risk assessment for closing the gaps

- **Canonical event model + adapter translation + identity/session in
  core**: NOT additive. Changes `AnalyticsProvider.track()`'s signature —
  breaking to all three existing adapters. Must land before middleware,
  routing, or plugins, since those all assume a richer event object than
  today's `(event: string, payload: Record<string, unknown>)`. This is
  the single highest-leverage, highest-risk piece of remaining work —
  do it first, while the adapter surface is still small (3 adapters).
- **Multi-provider + routing**: routing is meaningless until multiple
  providers can be configured — hard dependency on the (now-resolved)
  provider-plurality decision, and should land after the canonical model
  since routing decisions may want to inspect canonical event fields.
- **Capabilities declaration**: low risk, purely additive.
- **Runtime-agnostic adapters**: GA4 needs no rework (already fetch-based).
  PostHog/Segment depend on Node-only vendor SDKs — edge/browser support
  means swapping to browser/fetch-based SDKs or hand-rolled HTTP, real
  adapter-by-adapter rework.
- **New framework wrappers, privacy, reliability, tooling, docs**: additive
  scope, no conflict with existing code — safe to sequence after the
  foundational rework without redoing anything.

See `plan/ROADMAP.md` for how this translates into phases and ordering.
