# Phase 9 brief: context auto-capture

Read CLAUDE.md, README.md, plan/VISION.md, plan/GAP-ANALYSIS.md, and
plan/ROADMAP.md (Phase 9 section) first. Read the current src/index.ts,
src/schema.ts, and src/middleware.ts in full — Phase 8 (just landed) added
the `.use()` middleware pipeline (`before`/`after`/`onError` hooks, running
once globally on the canonical event before Phase 7's routing/fan-out).
This phase builds directly on top of Phase 6-8; do not re-litigate their
design.

## Current state (read before planning)

- `CanonicalEvent.context` (`src/schema.ts`) is currently an opaque,
  caller-supplied `Record<string, unknown> | undefined` — nothing populates
  it automatically. `TrackOptions.context` is how a caller sets it today,
  passed straight through to `buildEvent()` in `src/index.ts`.
- `CanonicalEvent` already carries `sessionId` (`crypto.randomUUID()`,
  generated once per `createAnalytics()` call, in-memory only, reassigned
  by `reset()`) — this is core-owned identity/session state, separate from
  whatever "session" means in this phase's context-capture scope (see
  ambiguity below).
- No runtime-detection logic exists anywhere in `src/` today — core has
  never needed to branch on browser vs. Node/Bun/edge.

## Scope (from plan/ROADMAP.md)

- Automatic capture of: browser/device/OS/locale/timezone/viewport,
  campaign/referrer (UTM-style), session, feature-flag context — merged
  into `CanonicalEvent.context` without the app having to supply it by
  hand.
- Examples: folded into `examples/core/` or a new `examples/frameworks/`
  entry, showing automatic context on a real page load (per
  `plan/ROADMAP.md`'s Phase 9 line).

## Design ambiguity — use grill-me

- **Feature-flag capture vs. the Future Investigation list.**
  `plan/ROADMAP.md`'s "Explicitly out of scope for now" section defers
  "Feature flags, experiments, remote config" entirely, yet this phase's
  scope line names "feature-flag capture" as part of context. Resolve
  this apparent conflict before implementing — likely reading of intent:
  typetrack captures/mirrors feature-flag state the *app* already knows
  about (e.g. an app-supplied flag map) into event context, not that
  typetrack implements a flag *system* — but confirm this rather than
  guessing, and confirm the exact shape of how an app would supply that
  flag state.
- **Merge/precedence with caller-supplied `context`.** `TrackOptions.context`
  already lets a caller pass their own `context` object per-call. When
  auto-capture is enabled, does it deep-merge with a caller-supplied
  `context` (and who wins field-for-field on conflict), or does automatic
  context live in its own reserved sub-key so the two never collide?
- **Where capture runs.** Is this a first-class core mechanism (e.g. an
  `enableContext()`/`context: true` option on `createAnalytics()`, captured
  once at construction for static fields like timezone/locale and
  per-call for dynamic fields like viewport), or is it itself shipped as
  one of Phase 8's `.use()` middlewares (a `contextMiddleware()` built-in)?
  Consider consistency with how Phase 8's built-ins are structured and
  with `plan/VISION.md`'s framing before picking.
- **Runtime detection and safe no-op.** Most of these fields (browser,
  device, viewport) only exist in a browser `window`/`navigator`
  environment. Core must never throw when running server-side (Node/Bun,
  including the CLI/dev server paths in `src/cli/`, `src/devServer/`) —
  confirm the exact feature-detection strategy (e.g. `typeof window !==
  "undefined"`) and what a Node-side capture attempt should produce
  (omitted fields vs. explicit `undefined` vs. a documented
  environment-appropriate subset).
- **Session-field scope vs. existing `sessionId`.** Core already generates
  and owns `sessionId`. Does this phase's "session" context field
  duplicate that (bug/confusion risk), or does it mean something
  additive (e.g. session start timestamp, page count, session duration)
  that lives inside `context.session` rather than the top-level
  `sessionId`? Get this distinction right and document it.

Use the `grill-me` skill to interview the user on these before locking in
implementation, exactly as Phases 6-8 did for their own open questions.

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-9-context/`, following the same
   scoping style as `plan/phase-6-canonical/`, `plan/phase-7-multi-provider/`,
   and `plan/phase-8-middleware/`. **Issue files are kept, never deleted**
   (standing policy — see plan/ROADMAP.md "Policy changes"). If delegating
   to the `research-planner` subagent works cleanly, use it as normal; if
   it hangs or fails for any reason, don't retry it repeatedly — fall back
   to writing the issue files directly yourself and proceed.
2. For each issue: `implementor` subagent implements with unit+integration
   tests, `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

## Branching / landing

Branch `phase-9-context` for isolation. Once all issues pass QA: push
commits to `origin/main` directly (no PR, no force-push — if `origin/main`
has moved, rebase cleanly on top). Delete the `phase-9-context` branch
(local, and remote only if you pushed it there). Do **not** delete
`plan/phase-9-context/` issue files. Add a one-line Phase 9 entry to
`plan/CHANGELOG.md` following the existing format (see the Phase 6/7/8
entries for the current style/length).

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on main and
cleanup is done.

## Done criteria

Before declaring done, verify yourself from a genuinely clean checkout:
`rm -rf node_modules dist packages/*/dist 2>/dev/null; rm -rf
packages/*/node_modules 2>/dev/null`, `bun install`, `bun run build:all`,
`bun run lint`, `bun run typecheck`, `bun test`, `bunx knip` — all must
pass. Report back: issues completed, how the feature-flag-vs-future-scope
conflict was resolved, the capture mechanism you landed on (core option vs.
middleware) and why, the merge/precedence rule for caller-supplied context,
files changed, and clean-checkout verification results.
