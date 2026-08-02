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
