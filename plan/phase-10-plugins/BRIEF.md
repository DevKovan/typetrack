# Phase 10 brief: plugins

Read CLAUDE.md, README.md, plan/VISION.md, plan/GAP-ANALYSIS.md, and
plan/ROADMAP.md (Phase 10 section) first. Read the current src/index.ts,
src/middleware.ts, and src/context.ts in full — Phase 8 landed the
`.use()` middleware pipeline, Phase 9 (just landed) added opt-in
`context`-option auto-capture (`src/context.ts`'s `isBrowserEnvironment()`
runtime-detection helper, static/dynamic capture, zero-vendor-dep UA
parsing). Also read `packages/next/src/AnalyticsPageView.tsx` and
`packages/next/src/buildPageViewArgs.ts` — the existing hand-rolled
auto-pageview component this phase must generalize. This phase builds
directly on top of Phases 6-9; do not re-litigate their design.

## Scope (from plan/ROADMAP.md)

- Plugins: `autoPage`, `autoClicks`, `autoErrors`, `autoWebVitals`,
  `autoPerformance`, `autoScroll`, `autoVisibility`, `autoUTM`.
- Generalize `@typetrack/next`'s `AnalyticsPageView` into the generic
  `autoPage()` plugin — Next's own component becomes a thin wrapper over
  it, not a parallel/duplicate implementation.
- Examples: `examples/plugins/` per `plan/VISION.md`'s examples policy
  (README, source, expected output, explanation, production notes).

## Design ambiguity — use grill-me

- **What a "plugin" mechanically is, and how it differs from Phase 8's
  middleware.** Middleware transforms/observes events already being
  tracked (`before`/`after`/`onError` on a call already in flight).
  Plugins are fundamentally different: `autoClicks`/`autoScroll`/
  `autoVisibility`/`autoWebVitals` actively originate new track calls in
  response to browser events the app never explicitly fired. Nail down
  the plugin shape before implementing — likely something like
  `(analytics: Analytics) => () => void` (a setup function called once
  with the live `Analytics` instance, wiring whatever DOM listeners it
  needs and calling `analytics.track()`/`.page()` itself, returning a
  teardown/cleanup function) — but confirm exact shape, not just the gist.
- **Registration point, distinct from `.use()`.** Middleware already owns
  `.use()`. Plugins need their own registration surface so the two don't
  collide or read ambiguously — e.g. a `plugins` array option on
  `createAnalytics()` (auto-initialized at construction), a separate
  `analytics.plugin()` method, or something else. Decide and justify.
- **Teardown ownership.** Plugins that attach global listeners
  (`click`/`scroll`/`visibilitychange`/etc.) need cleanup. Does core's
  existing `destroy()` (Phase 6/7) automatically call every registered
  plugin's returned teardown function? Confirm this is wired, not just
  assumed.
- **Runtime safety.** Nearly every one of these plugins is browser-only.
  Reuse Phase 9's `isBrowserEnvironment()` (`src/context.ts`) rather than
  reinventing detection — confirm whether that helper should be exported
  for reuse here, and confirm plugins no-op safely (never throw) when
  registered in a non-browser runtime (Node/Bun/edge/SSR).
- **`autoUTM` vs. Phase 9's existing `context.campaign` capture.** Phase 9
  already captures UTM/campaign/referrer into every event's `context` when
  auto-capture is enabled. Does `autoUTM` duplicate that, replace it, or
  serve a distinct purpose (e.g. firing a one-time "campaign landing"
  event on page load, vs. Phase 9's per-event context annotation)? Resolve
  this overlap explicitly — don't ship two features doing the same job
  for unclear reasons.
- **`@typetrack/next` refactor scope.** Confirm exactly how
  `AnalyticsPageView` becomes a thin wrapper over the new `autoPage()`
  plugin (e.g. does it still exist as a React component that calls
  `autoPage()` internally with route-change detection wired via Next's
  router, or does something more fundamental change?) — read the existing
  component and `buildPageViewArgs.ts` closely first so the refactor is
  additive/compatible, not a breaking rewrite of `@typetrack/next`'s
  public API.

Use the `grill-me` skill to interview the user on these before locking in
implementation, exactly as Phases 6-9 did for their own open questions.
If `research-planner`/other subagent delegation hangs for any reason,
don't retry it repeatedly — fall back to writing issue files directly.

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-10-plugins/`, following the same
   scoping style as prior phases. **Issue files are kept, never deleted**
   (standing policy — see plan/ROADMAP.md "Policy changes").
2. For each issue: `implementor` subagent implements with unit+integration
   tests, `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

## Branching / landing

Branch `phase-10-plugins` for isolation. Once all issues pass QA: push
commits to `origin/main` directly (no PR, no force-push — if `origin/main`
has moved, rebase cleanly on top). Delete the `phase-10-plugins` branch
(local, and remote only if you pushed it there). Do **not** delete
`plan/phase-10-plugins/` issue files. Add a one-line Phase 10 entry to
`plan/CHANGELOG.md` following the existing format (see the Phase 6-9
entries for the current style/length).

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on main and
cleanup is done.

## Done criteria

Before declaring done, verify yourself from a genuinely clean checkout:
`rm -rf node_modules dist packages/*/dist 2>/dev/null; rm -rf
packages/*/node_modules 2>/dev/null`, `bun install`, `bun run build:all`,
`bun run lint`, `bun run typecheck`, `bun test`, `bunx knip` — all must
pass. Report back: issues completed, the plugin shape/registration point
you landed on and why, how teardown is wired into `destroy()`, how the
`autoUTM`-vs-Phase-9-context overlap was resolved, how `@typetrack/next`
was refactored, files changed, and clean-checkout verification results.
