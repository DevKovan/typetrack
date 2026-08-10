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
- Phase 12 (reliability): `src/reliability/` — a new subdirectory family
  mirroring `src/plugins/`, holding a fallback storage chain
  (`createMemoryStorageAdapter`/`createLocalStorageAdapter`/
  `createIndexedDbStorageAdapter`/`detectBestStorage`, all hand-promisified,
  zero vendor deps) and a pure queue engine (`createQueueEngine` —
  priority-desc/FIFO ordering, exponential `computeBackoffDelay`,
  lowest-priority-then-oldest eviction at `maxQueueSize`, `maxAttempts`
  dead-lettering) plus a pure `chunkForBatching` batch-window helper. Wired
  into `createAnalytics({ reliability })` (boolean-or-object, mirroring
  `devServer`'s shorthand): a proactive offline check
  (`navigator.onLine === false`) skips a doomed provider call and enqueues
  directly, while a same-tick provider rejection is now enqueued for retry
  instead of being permanently lost — `console.warn` still fires
  immediately, but `onError` middleware notification is deferred to
  eventual dead-letter (once per event, not once per retry). A background
  `setInterval` drain loop plus an `online`-event listener retry queued
  entries per-provider (looked up live by name, per (event, provider)
  queue-entry granularity); `flush()` now also drains the queue first,
  bypassing each entry's backoff gate; `destroy()` stops the timer/listener
  without draining. `analytics.queue` (`size`/`drain`/`clear`) is always
  present, a true no-op when `reliability` was never configured. Added
  `TrackOptions.priority` (flat numeric, higher drains first) and
  `ProviderCapabilities.batch`/`AnalyticsProvider.trackBatch` (distinct
  from the pre-existing `batching` flag — opts a provider into receiving
  coalesced `trackBatch(events[])` calls from the drain loop instead of one
  call per queued event, chunked by `ReliabilityOptions.batch.size`/
  `intervalMs`, all-or-nothing per chunk). Added `pagehide`-based
  flush-on-unload (`flushOnUnload`, defaults `true` whenever `reliability`
  is enabled): a best-effort, non-bookkept, fire-and-forget final attempt —
  `sendBeacon` for the dev-server mirror specifically, direct
  provider-method calls otherwise — accepting at-least-once (not
  exactly-once) delivery on the entries it happens to catch. `identify`/
  `group`/`alias` remain entirely out of scope (no `CanonicalEvent` to
  queue), unchanged from every prior phase. Shipped
  `examples/advanced/offline-resilient-tracking/` (one composed
  e-commerce flow covering the full surface: offline queueing, retry/
  backoff, priority ordering, batching, dead-letter exhaustion, and
  flush-on-unload). Per policy, this phase's issue files stay in
  `plan/phase-12-reliability/` permanently.
- Phase 13 (runtime-agnostic adapters): added zero-vendor-dependency,
  `fetch()`-based transports alongside the existing Node-SDK-based
  factories in `packages/provider-posthog` (`createPostHogFetchProvider`)
  and `packages/provider-segment` (`createSegmentFetchProvider`) — usable
  anywhere `fetch` exists (browser, Cloudflare Workers, Vercel Edge, Bun,
  Deno, Node 18+), verified against each vendor's own published HTTP API
  docs. Both packages gained a shared `mapping.ts` so the SDK-based and
  fetch-based variants within a package produce byte-for-byte-identical
  event/property translation; the existing SDK-based factories were
  refactored to import from it with zero behavior change. The fetch
  variants declare `batching: false`/`offline: false` (no client-side
  queue of their own — Phase 12's reliability queue is the intended
  retry/offline mechanism); PostHog's fetch adapter also implements
  `trackBatch`/`/batch/` (`capabilities.batch: true`), Segment's
  `/v1/batch` support is explicitly deferred. Added `ProviderCapabilities.
  runtimes` (`src/providers/index.ts`) — optional, declarative,
  core-opaque metadata (same pattern as `batching`) listing which of
  `"node"`/`"browser"`/`"edge"`/`"bun"`/`"deno"` a factory truthfully
  supports; backfilled on all five factories, with the two SDK-based ones
  researched against their installed package's own `exports` map and
  transport internals rather than assumed (`posthog-node` ships real
  edge/workerd `fetch()`-based entrypoints but its node/bun/deno build
  pulls in `node:fs`, so browser is excluded; `@segment/analytics-node`
  has no edge export condition and a transitive dependency resolves to a
  `node:crypto` build, so only node/bun/deno are declared). Added
  dedicated SSR-safety test coverage (`src/ssr-safety.test.ts` plus one
  per provider package) that deletes every browser global from
  `globalThis` and exercises `createAnalytics()` — with no options and
  with every browser-touching option enabled at once — end-to-end,
  confirming the existing `isBrowserEnvironment()`/try-catch guards
  already hold (no SSR-unsafe path was found; test-coverage-only). Shipped
  `examples/runtimes/` (Cloudflare Worker, Vercel Edge, Bun, Deno) — only
  the Bun example is genuinely runnable/wired into this repo's own test
  suite, the other three are realistic source-plus-README entries per
  this repo's "no new toolchain dependencies" policy. Per policy, this
  phase's issue files stay in `plan/phase-13-runtime-agnostic/`
  permanently.
- Phase 14 (remaining framework wrappers): six new packages under
  `packages/` complete VISION.md's framework-integrations target (Angular
  excluded, per ROADMAP.md). `@typetrack/vue` — a plugin
  (`app.use(typetrackPlugin, { analytics })`) + `useAnalytics()` composable
  via typed `provide`/`inject`. `@typetrack/nuxt` — a `defineNuxtModule`
  registering `@typetrack/vue`'s plugin via `@nuxt/kit`, SSR-safe, with
  automatic pageview tracking on route change; resolves the app's
  `Analytics` instance via an `analyticsModule` import-specifier option
  (a live object can't cross the Node-config-time/browser-runtime
  boundary), aliased into the generated runtime via `nuxt.options.alias`
  (`@nuxt/kit`'s own `addAlias` doesn't exist in the installed version).
  `@typetrack/svelte` — Svelte 5 runes-era `setContext`/`getContext` (not
  stores) + snippets-based `<AnalyticsProvider>`; needed `esbuild-svelte`
  wired into its own `tsup.config.ts` and an additive `svelte-check`
  `typecheck:svelte` script/CI step, plus a repo-root `bun test
  --conditions=browser` flag (Svelte's own package.json branches its `"."`
  export on a `browser` condition Bun doesn't default to). `@typetrack/solid`
  — SolidJS `createContext`/`useContext` + JSX `<AnalyticsProvider>`
  (legacy-style `.Provider` form, not React 19's direct-context-as-element);
  needed a per-file `@jsxImportSource solid-js` pragma (root tsconfig's
  `"jsx": "react-jsx"` stays untouched), `tsup-preset-solid` for the build,
  and a `"solid"` export condition — confirmed the existing `--conditions=
  browser` flag from the Svelte package already covers Solid's own
  server/browser export split too, no further root-level change needed.
  `@typetrack/astro` — structurally different from every other package in
  this phase: an Integration-API package (`astro:config:setup` +
  `injectScript("page", ...)`) rather than a context/hook pattern, since
  Astro ships zero client JS by default; the injected script listens for
  `astro:page-load` and delegates to core's `dispatchPageView()`, also
  resolving the app's `Analytics` instance via an `analyticsModule`
  specifier. `@typetrack/remix` — targets React Router v8 framework mode
  exclusively (Remix itself reached EOL in 2026, merged into React Router;
  `peerDependencies.react-router: ^8.0.0`, never `react-router-dom`/
  `@remix-run/*`); a thin re-export of `@typetrack/react`'s
  `AnalyticsProvider`/`useAnalytics` (no `"use client"`-equivalent boundary
  needed — v8's default framework mode has no RSC split) plus a
  `useLocation()`-based `AnalyticsPageView` (simpler than Next's
  `usePathname`/`useSearchParams` pair, no Suspense wrapper needed). SvelteKit/SolidStart route-tracking explicitly deferred (both
  packages work unmodified inside their meta-frameworks; only automatic
  router-driven pageview tracking is out of scope). Shipped
  `examples/frameworks/` for all six: Vue/Svelte/Solid are genuinely
  tested-in-repo (each framework's own official testing-library + happy-dom
  for CSR, a dependency-free `renderToString`-equivalent for SSR);
  Nuxt/Astro/Remix are realistic source-plus-README-only entries, not
  wired into this repo's own test suite, per the same "no new toolchain
  dependencies" policy Phase 13 established. Per policy, this phase's issue
  files stay in `plan/phase-14-framework-wrappers/` permanently.
- Phase 15 (validation hardening): `src/deprecation.ts` — pure
  `resolveDeprecatedEvent()`/`formatDeprecationWarning()` module for
  deprecated-event names, wired into `track()` via a new
  `deprecatedEvents` option (warns once per original name; redirects to
  `replacement` when given, so a rename is a one-config-file change, not
  an application-code sweep). New `validate?: boolean` option
  (default `true`) skips `schema.safeParse()` entirely when `false`,
  resolved once at construction with no internal `NODE_ENV`/
  `import.meta.env` read — same "caller's responsibility" contract as
  `devServer` — intended for a caller-supplied production-stripping
  recipe the app's own bundler dead-code-eliminates. New
  `schemaVersion?: string | number` option stamps a single instance-level
  tracking-plan version tag onto every `track()` call's
  `metadata.schemaVersion` (an explicit `trackOptions.metadata.schemaVersion`
  always wins over the instance default) — deliberately not a per-event
  multi-version resolver, per BRIEF.md's research-grounded scope call.
  Shipped `examples/validation/{production-stripping,
  deprecated-event-rename,schema-versioning}`, all genuinely tested in
  this repo. Per policy, this phase's issue files stay in
  `plan/phase-15-validation-hardening/` permanently.
- Phase 16 (testing infrastructure): `packages/provider-contract-kit`
  (`runProviderContractTests(harness)`, a test-file-supplied harness, not a
  raw config object) consolidates 13 near-duplicate capability/lifecycle
  assertions independently reworded across `provider-ga4`/`provider-posthog`/
  `provider-segment`'s own test files into one shared suite, wired
  identically into all five factories (`createGA4Provider`,
  `createPostHogProvider`/`createPostHogFetchProvider`,
  `createSegmentProvider`/`createSegmentFetchProvider`). Added `bun:test`
  native snapshot tests (`toMatchSnapshot()`) for both each adapter's
  vendor-specific wire payload shape and the dev server's `GET /schema`
  dump, as a regression lock. Added a bundle-size regression check
  (`size-limit`'s `@size-limit/file` plugin, root `.size-limit.json`, `bun
  run size`) against already-built `dist/` artifacts, no re-bundling. Added
  a narrow `bun:test`-only performance smoke test asserting
  `createAnalytics()`/`track()`'s synchronous dispatch overhead stays within
  a generous regression threshold (not comparative benchmarking, deferred to
  Phase 19). Added a new top-level `e2e/` Playwright package (two specs) —
  the IIFE global bundle (`dist/index.global.js`) actually loading via a
  real `<script>` tag in a real browser, and the `pagehide`/
  `navigator.sendBeacon` flush-on-unload behavior firing on a real
  cross-document navigation — wired into `qa.yml`'s new "Bundle size" and
  "e2e" steps. This phase's originating task description's claimed
  `build:all`/framework-package CI gap was verified during research to
  already be closed by Phase 14 (`7e2c8d2` through `4c3a3db`); no fix was
  needed or made. Per policy, this phase's issue files stay in
  `plan/phase-16-testing-infrastructure/` permanently.
- Phase 17 (documentation): added a new top-level `docs/` directory with ten
  guides — architecture, cookbook, migration, three per-provider references
  (GA4/PostHog/Segment), plugins, middleware, performance, comparison (vs.
  direct PostHog/Segment/RudderStack SDK usage), and FAQ — indexed from
  `docs/README.md`. Refreshed the root `README.md`, which had gone stale:
  `## Usage` still showed the pre-Phase-6 `track(event, payload, meta)`/
  positional-argument shape instead of the real, current
  `AnalyticsProvider.track(event: CanonicalEvent)` signature, and `##
  Status` still read "Early scaffold" after 16 landed phases. Corrected a
  divergence between `plan/VISION.md`'s aspirational pipeline diagram
  ("Validation → Middleware → Context → Enrichment → Filtering → Sampling →
  Routing → Provider Mapping") and the real, shipped `track()` order (consent
  → deprecated-event resolution → dev-server mirror → validation →
  canonical-event construction, including context capture → middleware
  `before` chain → per-provider routing/sampling/capability-gated dispatch →
  adapter-internal event mapping → middleware `after` chain) —
  `docs/architecture.md` documents the real order; "Enrichment"/"Filtering"/
  "Sampling" are middleware and per-provider routing config, not fixed
  pipeline stages. Every code sample across the new guides is either copied
  verbatim from a real, cited source file or clearly labeled illustrative —
  no new doc-sample-compilation tooling was added (existing `examples/*`
  packages already provide equivalent, already-tested coverage); this
  phase's issue 011 instead did a manual link/anchor/citation verification
  pass and a full clean-checkout `build:all`/`size`/`e2e`/`lint`/
  `typecheck`/`test`/`knip` run, all green. Per policy, this phase's issue
  files stay in `plan/phase-17-documentation/` permanently.
- Phase 18 (tooling extras): added `typetrack schema` and `typetrack docs`
  CLI commands (`src/cli/schema.ts`/`docs.ts`), both built on a shared
  `buildEventJsonSchemas()` extraction (`src/devServer/schemaExport.ts`,
  also now deduplicating the dev server's existing `GET /schema` handler) —
  the first writes raw JSON Schema to disk or stdout, the second renders a
  Markdown event catalog (`renderEventCatalog`, default `EVENTS.md`, meant
  to be committed) via the same data. Added a live event inspector UI
  served at the dev server's previously-unhandled `GET /` route
  (`src/devServer/inspectorPage.ts`), a dependency-free HTML page consuming
  the already-shipped `/events`, `/events/stream`, and `/schema` endpoints.
  Added `debugOverlayMiddleware()` (`src/middleware/debugOverlay.ts`), a
  new opt-in, browser-only, pure-observer built-in middleware rendering a
  small in-page panel of recently dispatched events. A VSCode extension was
  considered and deliberately deferred, not silently dropped — TypeScript's
  own language service against `createAnalytics<Events>()`'s generic
  parameter already covers the main autocomplete/type-checking need; see
  `plan/phase-18-tooling-extras/BRIEF.md`'s Design decision 1. All four
  pieces are documented and cross-linked in a new `docs/tooling.md` guide.
  Per policy, this phase's issue files stay in
  `plan/phase-18-tooling-extras/` permanently.
