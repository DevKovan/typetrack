# Phase 7 brief: multi-provider + routing

Read CLAUDE.md, README.md, plan/VISION.md, plan/GAP-ANALYSIS.md, and
plan/ROADMAP.md (Phase 7 section) first. Read the current src/index.ts and
src/providers/index.ts in full — Phase 6 (just landed) rewrote these with
the canonical event model, per-provider `capabilities` gating (via
`isCapabilitySupported`), and identity/session state living in core. This
phase builds directly on top of that; do not re-litigate Phase 6's design.

## Scope (from plan/ROADMAP.md + CLAUDE.md's resolved provider-plurality decision)

- `CreateAnalyticsOptions.provider` changes from `AnalyticsProvider` to
  `AnalyticsProvider | AnalyticsProvider[]` (already the documented type in
  CLAUDE.md — Phase 6 only implemented the singular half). A single
  provider stays the ergonomic default (unchanged behavior). An array fans
  out every verb call (`track`/`identify`/`page`/`group`/`alias`/`screen`/
  `flush`/`reset`/`destroy`) to every listed provider.
- Capability gating (`isCapabilitySupported` in src/index.ts) currently
  closes over one `provider` variable — must become per-provider when
  fanning out, so a warn/no-op decision for one provider in the array
  doesn't block the call from reaching a different provider in the array
  that does support it.
- Fan-out error isolation: one provider throwing/rejecting must not stop
  the others in the array from receiving the call. Decide and document
  how `track()`/`flush()` etc.'s own return value (`void | Promise<void>`)
  behaves when multiple providers are involved (e.g. does `flush()` await
  all providers via `Promise.allSettled`, and if some reject, does
  `destroy()`/`flush()` throw an aggregate error or swallow-and-warn like
  the existing capability-gating pattern does?).
- Per-provider routing: include/exclude by event name (exact, wildcard,
  regex), predicate function, priority (ordering when multiple providers
  would otherwise all receive an event), sampling (percentage of events
  that reach a given provider). Exact config shape is not decided — see
  "Design ambiguity" below.
- Examples: `examples/providers/` — a multi-provider config with routing,
  per `plan/VISION.md`'s examples requirements (README, source, expected
  output, explanation, production notes).

## Design ambiguity — use grill-me

The exact routing config shape is a real open design decision, not
something to guess silently:
- Where does routing config attach — alongside each provider in the array
  (e.g. `{ provider, include, exclude, sampling, priority }` wrapper
  objects instead of bare `AnalyticsProvider[]`), or as a separate parallel
  `routing` option keyed by provider name?
- Precedence when both `include` and `exclude` are given for the same
  provider.
- Whether `predicate` receives the canonical event (post-construction) or
  the raw `track()` args (pre-validation).
- Whether sampling is deterministic (hash-based, stable per
  anonymousId/session) or purely random per call — this matters for
  products that expect a given user to consistently land in/out of a
  sampled provider.
- Whether `priority` means "stop after first match" (routing, exclusive)
  or "ordering only" (fan-out still happens, priority just controls call
  order) — these are very different semantics and the vision doc doesn't
  fully pin this down.

Use the `grill-me` skill to interview the user on these before locking in
the implementation, exactly as Phase 6 did for its own open questions.

## Process

Same as every phase since Phase 6:

1. `research-planner` subagent writes issue files into
   `plan/phase-7-multi-provider/`. **Issue files are kept, never deleted**
   (standing policy — see plan/ROADMAP.md "Policy changes").
2. For each issue: `implementor` subagent implements with unit+integration
   tests, `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

## Branching / landing

Branch `phase-7-multi-provider` for isolation. Once all issues pass QA:
push commits to `origin/main` directly (no PR, no force-push — if
`origin/main` has moved, rebase cleanly on top). Delete the
`phase-7-multi-provider` branch (local, and remote only if you pushed it
there). Do **not** delete `plan/phase-7-multi-provider/` issue files. Add a
one-line Phase 7 entry to `plan/CHANGELOG.md` following the existing
format (see the Phase 6 entry for the current style/length).

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on main and
cleanup is done.

## Done criteria

Before declaring done, verify yourself from a genuinely clean checkout:
`rm -rf node_modules dist packages/*/dist 2>/dev/null; rm -rf
packages/*/node_modules 2>/dev/null`, `bun install`, `bun run build:all`,
`bun run lint`, `bun run typecheck`, `bun test`, `bunx knip` — all must
pass. Report back: issues completed, the routing config shape you landed
on (and why, referencing the grill-me answers), how fan-out error
isolation works, files changed, and clean-checkout verification results.
