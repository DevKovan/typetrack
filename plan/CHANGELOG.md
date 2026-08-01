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
