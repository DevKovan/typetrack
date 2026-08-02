# Phase 8 brief: middleware

Read CLAUDE.md, README.md, plan/VISION.md, plan/GAP-ANALYSIS.md, and
plan/ROADMAP.md (Phase 8 section) first. Read the current src/index.ts and
src/routing.ts in full — Phase 6 landed the canonical event model and
identity/session state in core; Phase 7 (just landed) added multi-provider
fan-out (`dispatchToProviders`/`settleAll` helpers in src/index.ts),
per-provider routing (`src/routing.ts`: `shouldRouteToProvider`,
`sortByPriority`), and per-provider capability gating. This phase builds
directly on top of both; do not re-litigate their design.

## Scope (from plan/ROADMAP.md)

- `analytics.use(middleware)` registration API on the `Analytics` interface.
- Before/after/error hooks: a middleware can inspect/mutate the canonical
  event before it's dispatched to providers, run logic after dispatch
  completes, and react to a provider call failing.
- Ship built-in middlewares: redact PII, sampling, logging, enrichment,
  version/build metadata injection, timing/tracing. These live in the
  package as opt-in exports (apps import and `.use()` them), not
  auto-enabled.
- Examples: `examples/middleware/` per `plan/VISION.md`'s examples policy
  (README, source, expected output, explanation, production notes).

## Design ambiguity — use grill-me

Several real open decisions here, not to be guessed silently:

- **Middleware signature and hook shape.** Is this one `(event) =>
  event | null | Promise<event | null>` function per middleware (implicit
  "before" only, returning `null`/`undefined` drops the event), or an
  object with separate `before`/`after`/`onError` methods? The vision doc
  doesn't fully pin this down — read it carefully and bring options.
- **Where middleware runs relative to Phase 7's per-provider fan-out.**
  Middleware almost certainly needs to run once globally on the canonical
  event *before* `dispatchToProviders`/routing evaluation (so routing
  predicates and provider adapters see the already-transformed event,
  and redaction/enrichment isn't duplicated per-provider) rather than once
  per provider inside the fan-out loop. Confirm this rather than assuming.
- **Which verbs run through the middleware pipeline.** `track`/`page`/
  `screen` all build a `CanonicalEvent` (see `buildEvent()` in
  src/index.ts) — do `identify`/`group`/`alias` (which don't build a
  `CanonicalEvent`, per Phase 7's Q3b resolution) participate at all, or
  is middleware scoped only to the three event-producing verbs? Phase 7
  resolved the exact same question for routing by scoping it to
  track/page/screen only — consider whether middleware should follow the
  same precedent or has different reasons to differ.
- **Short-circuit contract.** If a middleware drops the event (returns
  `null`/`undefined`, or explicitly signals "stop"), do later middlewares
  in the chain still run, or does the pipeline stop immediately? Does a
  dropped event still fire `after` hooks for middlewares that already ran
  their `before`?
- **Error hook trigger.** Does `onError` fire when a middleware itself
  throws, when a provider's dispatch rejects (i.e. hooked into the
  existing `dispatchToProviders`/`settleAll` rejection path), or both? If
  both, how does a caller tell which happened?
- **Relationship to Phase 7's per-provider `sampling` field.** The
  built-in "sampling" middleware and Phase 7's `ProviderEntry.sampling`
  (deterministic, hash(anonymousId)-based, gates whether a specific
  provider receives a specific event) sound similar but serve different
  layers (global pre-dispatch drop vs. per-provider routing gate). Get
  this distinction right and document it clearly — don't let the two
  features collide or duplicate each other's job without a clear reason.

Use the `grill-me` skill to interview the user on these, exactly as
Phases 6 and 7 did for their own open questions. Do not guess and move on.

## Process

Same as every phase since Phase 6:

1. `research-planner` subagent writes issue files into
   `plan/phase-8-middleware/`. **Issue files are kept, never deleted**
   (standing policy — see plan/ROADMAP.md "Policy changes").
2. For each issue: `implementor` subagent implements with unit+integration
   tests, `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

## Branching / landing

Branch `phase-8-middleware` for isolation. Once all issues pass QA: push
commits to `origin/main` directly (no PR, no force-push — if `origin/main`
has moved, rebase cleanly on top). Delete the `phase-8-middleware` branch
(local, and remote only if you pushed it there). Do **not** delete
`plan/phase-8-middleware/` issue files. Add a one-line Phase 8 entry to
`plan/CHANGELOG.md` following the existing format (see the Phase 6/7
entries for the current style/length).

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on main and
cleanup is done.

## Done criteria

Before declaring done, verify yourself from a genuinely clean checkout:
`rm -rf node_modules dist packages/*/dist 2>/dev/null; rm -rf
packages/*/node_modules 2>/dev/null`, `bun install`, `bun run build:all`,
`bun run lint`, `bun run typecheck`, `bun test`, `bunx knip` — all must
pass. Report back: issues completed, the middleware signature/hook shape
you landed on (and why, referencing the grill-me answers), how it composes
with Phase 7's fan-out/routing, files changed, and clean-checkout
verification results.
