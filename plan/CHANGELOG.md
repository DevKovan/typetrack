# Plan changelog

One-liner per phase once its issue/brief files are removed — code and tests
are the record, this is just a trail of what happened when.

- Phase 0 (foundations): repo scaffold, Bun workspace toolchain (tsgo/tsc,
  oxlint, knip, tsup), CI, subagents, git-discipline + grill-me skills.
- Phase 1 (core): `createAnalytics<Events>()` generic factory, optional
  per-event Zod schemas via `z.infer`, configurable `onValidationError`.
- Phase 2 (providers): server-side `AnalyticsProvider` adapters for
  PostHog, Segment, and GA4 (Measurement Protocol) under `packages/`.
- Phase 3 (dev server + CLI): `npx typetrack dev` (`src/cli/`) starts a
  local Bun.serve() dev server (`src/devServer/`) with auto port discovery
  from 4318, `.typetrack/port`, `POST/GET /events`, `GET /events/stream`
  (SSE), `GET /schema`, `GET /health`, `typetrack.config.*` loading with
  chokidar hot-reload, and an opt-in `devServer` option on
  `createAnalytics()` that fire-and-forget POSTs tracked events to it.
- Phase 4 (React + Next.js wrappers): `@typetrack/react` (`AnalyticsProvider`
  context + `useAnalytics()` hook, React 19) and `@typetrack/next` (a
  `"use client"`-boundary `AnalyticsProvider` for the App Router plus
  `AnalyticsPageView` for automatic pageview tracking on route change),
  both under `packages/`. Also fixed a clean-install CI gap: Bun hardlinks
  `file:`-protocol sibling packages at install time, so `dist/` rebuilds
  need a re-`bun install` in between to stay unstale.
- Phase 5 (build system correctness): root `typetrack` package gains a
  minified IIFE global build (`dist/index.global.js`, `globalName:
  "Typetrack"`) plus `unpkg`/`jsdelivr` package.json fields so
  `<script src="https://unpkg.com/typetrack">` works with zero config,
  and a `default` fallback condition on `exports["."]`. Also fixed the
  clean-install fragility for real: true sibling `packages/*` deps (e.g.
  `@typetrack/next`'s dep on `@typetrack/react`) now use the
  `workspace:*` protocol (resolves to a live symlink, survives `dist/`
  recreation); deps on the monorepo root `typetrack` package stay
  `file:../..` since Bun only resolves `workspace:*` for true
  `workspaces`-glob members. A new root `bun run build:all` script builds
  every package in dependency order (root, then `packages/react`, then
  `packages/next`) with one internal re-`bun install` to refresh the
  root's `file:` snapshot; `qa.yml`'s Build step is now just `bun install`
  + `bun run build:all`, replacing the old hand-rolled interleaved
  install/build sequence.
- Phase 6 (canonical event model + provider rework, breaking): replaced
  bare `EventMeta` with a full `CanonicalEvent` (`name`, `properties`,
  `timestamp`, `anonymousId`, `userId`, `sessionId`, `context`,
  `metadata`); identity/session state moved into core (`createAnalytics`
  now owns `anonymousId`/`sessionId`/`userId`, adapters no longer generate
  their own); `Analytics`/`AnalyticsProvider` gained `group`/`alias`/
  `screen`/`reset`/`destroy`; every adapter (GA4, PostHog, Segment) gained
  a `capabilities` declaration plus canonical→vendor event-name/
  property-name mapping tables (defaults + app overrides); unsupported
  capability calls now warn-once-and-no-op instead of silently no-oping;
  resolved the `flush()` terminal-vs-non-terminal disagreement (`flush()`
  is always non-terminal, `destroy()` is the new terminal
  flush-then-teardown op — Segment's adapter changed from
  `closeAndFlush()`-on-`flush()` to a genuinely non-terminal `flush()`).
  Shipped `examples/core/` (canonical event shape + provider-switch demo).
  Per the new policy (see "Policy changes" in `plan/ROADMAP.md`), this
  phase's issue files stay in `plan/phase-6-canonical/` permanently.
- Phase 7 (multi-provider + routing): `CreateAnalyticsOptions.provider`
  accepts `AnalyticsProvider | ProviderEntry | (AnalyticsProvider |
  ProviderEntry)[]` (`ProviderEntry = { provider, include?, exclude?,
  predicate?, sampling?, priority? }`); a single bare provider keeps exact
  Phase 6 passthrough behavior, an array opts into fan-out. Routing
  (`include`/`exclude`/exact-or-glob-string-or-`RegExp` matchers,
  `predicate(event)`, deterministic `sampling` hashed on `anonymousId`)
  gates only `track`/`page`/`screen`; `identify`/`group`/`alias`/`reset`
  always fan out to every provider unconditionally. `priority` is
  ordering-only (never exclusive) — fan-out still happens, priority just
  controls call-initiation order (stable sort, ties by array position).
  Capability gating (from Phase 6) is now per-provider in a fan-out list.
  Fan-out error isolation: `track`/`page`/`screen`/`identify`/`group`/
  `alias`/`reset` swallow-and-warn per-provider rejections via
  `Promise.allSettled`, never throwing; `flush`/`destroy` also run every
  provider via `Promise.allSettled` but throw a combined `AggregateError`
  if any provider rejected (destroy's flush-then-destroy phases both run
  in full regardless of flush-phase rejections). Shipped
  `examples/providers/` (multi-provider routing demo). Per policy, this
  phase's issue files stay in `plan/phase-7-multi-provider/` permanently.
- Phase 8 (middleware): `analytics.use(middleware)` registers an object
  with `before?`/`after?`/`onError?` hooks (`src/middleware.ts`), run
  once globally per `track`/`page`/`screen` call, immediately after the
  canonical event is built and before Phase 7's routing/fan-out —
  `identify`/`group`/`alias`/`reset`/`flush`/`destroy` are unaffected.
  Chain is linear (registration order for both `before` and `after`); a
  `before()` returning `null`/`undefined` drops the event immediately
  (no later `before`s, no dispatch, no `after`s at all, no error). A
  thrown/rejected `before()`/`after()`, or a provider dispatch rejection,
  invokes `onError(error, event, ctx)` on every middleware whose
  `before()` ran for that call, with `ctx.source: "middleware" |
  "provider"` (plus `providerName` for the latter); broken `onError`
  handlers are swallowed-and-warned, never crash the call; existing
  per-provider `console.warn` reporting is unchanged, `onError` is
  additive. Shipped six opt-in built-ins (never auto-enabled):
  `redactMiddleware`, `samplingMiddleware` (global pre-dispatch drop via
  `src/routing.ts`'s existing `isSampledIn` — distinct from and
  composable with Phase 7's per-provider `ProviderEntry.sampling`),
  `loggingMiddleware`, `enrichmentMiddleware`, `versionMiddleware`,
  `timingMiddleware`. Shipped `examples/middleware/` (pipeline
  composition/ordering/error-handling demo + a sampling-layers demo).
  Per policy, this phase's issue files stay in
  `plan/phase-8-middleware/` permanently.
- Phase 9 (context auto-capture): `createAnalytics({ context })` (`src/context.ts`
  + wiring in `src/index.ts`) — opt-in only (`context` omitted/`false` is
  byte-for-byte unchanged from pre-Phase-9; `context: true` shorthand for
  `{ autoCapture: true }`). On `track`/`page`/`screen`, merges auto-captured
  fields into `CanonicalEvent.context` via a shallow merge where
  caller-supplied `TrackOptions.context` always wins per-key on collision.
  Static fields (`locale`, `timezone` via `Intl`; `browser`/`os`/`device` via
  a small hand-rolled, zero-dependency UA parser) are captured once at
  construction; dynamic fields (`viewport`, `referrer`, UTM-derived
  `campaign`, an app-supplied `featureFlags` getter mirrored verbatim — no
  flag evaluation of typetrack's own) are captured fresh per call.
  `typeof window !== "undefined" && typeof navigator !== "undefined"` gates
  every browser-only field; outside a browser those keys are omitted
  entirely (never `undefined`), while `locale`/`timezone` still populate
  everywhere (Node/Bun/edge included) — core never throws server-side.
  Additive `context.session` (`startedAt`/`eventCount`/`durationMs`, core
  bookkeeping reinitialized by `reset()`) is distinct from and does not
  duplicate the existing top-level `sessionId`. Shipped
  `examples/core/context-capture/` (stubbed browser page-load demo +
  Node-side safe-no-op fallback). Per policy, this phase's issue files stay
  in `plan/phase-9-context/` permanently.
- Phase 10 (plugins): `createAnalytics({ plugins })` (`src/plugins.ts` +
  wiring in `src/index.ts`) — a `Plugin` is a bare setup function,
  `(analytics) => (() => void) | void`, invoked once per array entry at
  construction with the live instance; an optional returned teardown is
  collected and run by `destroy()` (registration order, swallow-and-warn
  on throw) before the existing provider flush/destroy logic, so plugins
  stop originating events before providers start tearing down. Deliberate
  separate surface from Phase 8's `.use()`: middleware transforms events
  already in flight, plugins originate new `track()`/`page()` calls from
  browser events the app never explicitly fired. `isBrowserEnvironment`
  (Phase 9) is now exported from the public barrel for plugin authors.
  Shipped eight built-ins, all browser-only/safe-no-op elsewhere, never
  throwing: `autoPage` (History-API-driven page views) + a shared
  `dispatchPageView()` dedup helper it and `@typetrack/next`'s
  `AnalyticsPageView` both call — the latter refactored onto this shared
  helper (keeping its own Next-router-driven navigation detection, since
  that's more accurate than generic History-API watching) instead of
  duplicating dispatch logic, with zero public-API change and a
  React-Strict-Mode double-invoke dedup fixed as a side effect;
  `autoClicks`, `autoScroll`, `autoVisibility` (DOM interaction);
  `autoErrors`, `autoWebVitals` (hand-rolled FCP/LCP/CLS via
  `PerformanceObserver`, zero vendor deps), `autoPerformance` (Navigation
  Timing) (browser telemetry); `autoUTM` (first-touch UTM persistence to
  `sessionStorage` + a one-shot "Campaign Landing" event — deliberately
  decoupled from and non-duplicative of Phase 9's existing live
  per-event `context.campaign` annotation). Shipped `examples/plugins/`
  (two composed flows: landing-page-engagement, site-reliability-and-vitals
  — covering all eight plugins). Per policy, this phase's issue files
  stay in `plan/phase-10-plugins/` permanently.
- Phase 11 (privacy & consent): `src/consent.ts` — freeform-string
  `ConsentCategory`, `ConsentState`, pure `hasConsent`/
  `isConsentedForCategories`/`isConsentedForProvider`, and
  `detectBrowserPrivacySignal`/`resolveDefaultState` (DNT/GPC detection,
  fail-closed `"denied"` default unless `respectBrowserSignals` maps a
  detected signal to `"denied"` regardless of a configured `"granted"`
  default — one primitive serving both GDPR opt-in and CCPA/GPC opt-out
  postures). Wired into `createAnalytics({ consent })`: a live
  `analytics.consent` controller (`grant`/`deny`/`hasConsent`/`get`,
  snapshot-cloned) and a shared `isTrackingAllowed()` gate applied as the
  very first statement of all six data verbs (`track`/`page`/`screen`/
  `identify`/`group`/`alias`), including `track()`'s dev-server mirror.
  Added the VISION.md-reserved `enable()`/`disable()`/`isEnabled()` kill
  switch — AND'd with consent, `enabled` checked first, no warning noise
  on blocked calls. Added `anonymousMode` (suppresses `identify`/`alias`
  as one-time-warned no-ops, `userId` stays permanently unset;
  `group()` deliberately unaffected). Added `ProviderEntry.requiresConsent`
  (`src/routing.ts`) — `shouldRouteToProvider` gained a required
  `hasConsentFn` parameter, and `identify`/`group`/`alias`'s per-provider
  dispatch gained the same consent-only check (checked before capability
  gating, so a denied provider never emits a capability warning) without
  reopening Phase 7's "no full routing for these three verbs" decision.
  Added `cookieless` (readonly flag; locked in via a regression test that
  core touches no storage API regardless) and made `autoUTM` skip its
  `sessionStorage` read/write under it. Added `piiFilterMiddleware`
  (`src/middleware/piiFilter.ts`) — recursive, key-name-pattern (substring
  or `RegExp`) redaction to arbitrary depth through objects/arrays,
  complementary to (not replacing) Phase 8's exact-path `redactMiddleware`.
  `reset()` touches none of consent/`enabled`/`anonymousMode`/`cookieless`
  state — privacy posture is not identity/session state. Shipped
  `examples/recipes/` (consent-gated-tracking; anonymous-and-cookieless-
  tracking). Per policy, this phase's issue files stay in
  `plan/phase-11-privacy-consent/` permanently.
