# Phase 6 brief: canonical event model + provider rework (breaking)

Read CLAUDE.md, README.md, plan/VISION.md, plan/GAP-ANALYSIS.md, and
plan/ROADMAP.md (Phase 6 section) first — this is a BREAKING architecture
change, not additive, so understand the full context before touching code.
Also read the current src/index.ts, src/schema.ts, src/providers/index.ts,
and all three packages/provider-{ga4,posthog,segment}/src/index.ts to see
exactly what you're changing.

## Scope (from plan/ROADMAP.md)

- Canonical event shape (`name`, `properties`, `timestamp`, `anonymousId`,
  `userId`, `sessionId`, `context`, `metadata`) replacing today's bare
  `EventMeta` (`{ timestamp }` only).
- `AnalyticsProvider.track()`/`.page()` signatures updated to receive the
  canonical event; identity/session state moves into core
  (`createAnalytics`), adapters stop each reinventing anonymous/identified
  user state independently.
- Canonical-to-vendor event-name and property-name mapping tables added to
  each of the 3 existing adapters (GA4, PostHog, Segment) — replaces
  today's raw passthrough where the app's own event string/payload is
  forwarded verbatim.
- `capabilities` field added to `AnalyticsProvider` (identify/group/alias/
  page/screen/batching/offline/featureFlags/sessionReplay/heatmaps);
  backfill on all 3 adapters based on what they actually support; define
  and implement an ignore/warn/fallback policy for unsupported calls
  (today it's silent no-op via optional chaining — not a designed
  contract).
- Resolve the `flush()` terminal-vs-non-terminal disagreement: PostHog's
  `flush()` is reusable/non-terminal, Segment's is terminal
  (`closeAndFlush()`, adapter unusable after) — these currently disagree
  at the interface level. Pick one documented lifecycle contract and make
  both adapters conform; add `reset()`/`destroy()` methods to the
  `Analytics` interface and `AnalyticsProvider`.
- This is a big, foundational, breaking change. If you hit real design
  ambiguity (exact canonical event/property mapping table format, how much
  vendor-specific event mapping should be app-configurable vs hardcoded
  per-vendor defaults, exact capabilities-fallback UX), use the `grill-me`
  skill to interview the user rather than guessing silently — this is
  explicitly what `research-planner.md`'s instructions call for in exactly
  this situation.
- Examples requirement (per `plan/VISION.md`'s per-phase examples policy,
  and the Phase 6 line in `plan/ROADMAP.md`): ship `examples/core/`
  showing the canonical event shape and a provider-switch demo (same app
  code, swap one config line, different provider). Every example needs
  README, source, expected output, explanation, production notes per
  `plan/VISION.md`'s "Examples" section — this is a new requirement not
  present in earlier phases, read that section carefully.

## Process

Follow the repo's own process exactly as it worked for prior phases:

1. `research-planner` subagent researches (if anything version/API
   sensitive) and writes issue files into `plan/phase-6-canonical/`.
   **Policy change**: issue files are KEPT now, never delete them after
   merge — see `plan/ROADMAP.md` "Policy changes" section. The old
   delete-on-merge convention from phases 0-5 is retired.
2. For each issue: `implementor` subagent implements with unit+integration
   tests, `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly.

## Branching / landing

You're on branch `phase-6-canonical` for isolation. Once all issues pass
QA: push commits to `origin/main` directly (no PR, no force-push — if
`origin/main` has moved, rebase on top cleanly), delete the
`phase-6-canonical` branch (local and remote if pushed there). Do **not**
delete `plan/phase-6-canonical/` issue files — leave them in place, per
the new policy. Add a one-line Phase 6 entry to `plan/CHANGELOG.md`
following the existing format.

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on main and
cleanup is done.

## Done criteria

Before declaring done, verify yourself from a genuinely clean checkout:
`rm -rf node_modules dist packages/*/dist packages/*/node_modules`,
`bun install`, `bun run build:all`, `bun run lint`, `bun run typecheck`,
`bun test`, `bunx knip` — all must pass. Report back: issues completed,
the mapping-table design you landed on, how you resolved the
`flush()`/lifecycle contract, files changed, and clean-checkout
verification results.
