# 007 -- CI wiring, stale-premise documentation, changelog

## Context

Depends on issues 004 (bundle-size checks) and 006 (Playwright e2e) both
existing and passing locally -- this issue only wires their already-built
scripts into `.github/workflows/qa.yml`, it does not build either
capability itself. Last issue in this phase.

Read `plan/phase-16-testing-infrastructure/BRIEF.md`'s "A stale premise,
corrected" section first -- this issue is where that finding gets
recorded permanently (in this issue file's own completion, and in the
`plan/CHANGELOG.md` entry below), since the phase's originating task
description asserted a `build:all`/`qa.yml` gap that turned out, on
verification, to already be closed by Phase 14.

## Scope of this issue

1. **`.github/workflows/qa.yml`**: add two new steps, after the existing
   "Test" step and before "Unused code check" (or wherever the
   implementor judges the most sensible position -- e.g. size-limit
   logically follows "Build" directly, before "Lint", since it only needs
   built `dist/` output and has no dependency on the Test step; use
   judgment):
   - A "Bundle size" step running `bun run size` (issue 004's script) --
     needs `bun run build:all` to have already run in this job, which it
     already has (the existing "Build" step).
   - An "e2e" step: `bunx playwright install --with-deps chromium`
     followed by `cd e2e && bun run test` (issue 006). Needs `dist/
     index.global.js` to exist, which the existing "Build" step's `bun
     run build:all` already produces (root `tsup` build runs first inside
     `build:all`, before any `packages/*` sub-build).
   Do **not** add any step re-verifying `build:all`'s framework-package
   coverage -- per the BRIEF's research finding, that coverage already
   exists and needs no further CI change in this phase.
2. **Root `package.json`**: no `build:all`/framework-package changes (see
   above). If issues 004/006 didn't already do so, confirm `"e2e"` is
   present in the `"workspaces"` array (issue 006's own scope item --
   this issue just verifies it landed, doesn't re-add it).
3. **`plan/CHANGELOG.md`**: add a one-line Phase 16 entry, following the
   existing format (see the Phase 6-15 entries for current style/length).
   Cover: the provider-contract-kit and its five-adapter wiring (with the
   exact dedup framing -- "consolidates N near-duplicate capability/
   lifecycle assertions across the three provider packages into one
   shared suite", not just "adds a test kit"); the snapshot tests (both
   halves); the bundle-size check (`size-limit`, root `.size-limit.json`,
   `bun run size`); the performance smoke test; the Playwright `e2e/`
   package and its two specs (name the two things it actually verifies --
   the IIFE global bundle loading in a real browser, and real-browser
   `pagehide`/`sendBeacon` flush-on-unload behavior -- since those are the
   novel, previously-uncovered surfaces this phase adds, not a generic
   "added e2e tests" line). **Also explicitly note** that this phase's
   originating task description's claimed `build:all`/framework-package
   CI gap was verified, during this phase's research, to already be
   closed by Phase 14 (cite commits `7e2c8d2` through `4c3a3db`) -- no
   fix was needed or made. Per policy, this phase's issue files stay in
   `plan/phase-16-testing-infrastructure/` permanently.

## Testing

From a genuinely clean checkout (mirroring every prior phase's "Done
criteria"): `rm -rf node_modules dist packages/*/dist packages/*/
node_modules examples/*/*/node_modules e2e/node_modules 2>/dev/null`,
`bun install`, `bun run build:all`, `bun run lint`, `bun run typecheck`
(root, plus the pre-existing `packages/svelte` targeted invocation), `bun
run size`, `bunx playwright install --with-deps chromium && cd e2e && bun
run test && cd ..`, `bun test --conditions=browser`, `bunx knip` -- all
must pass. This mirrors `.github/workflows/qa.yml`'s own step order
exactly (per this repo's standing instruction to run the same checks
locally before every push).

## Out of scope

Everything already listed in `plan/phase-16-testing-infrastructure/
BRIEF.md`'s "Out of scope for this whole phase" section, notably:
re-fixing `build:all`'s framework-package coverage (already fixed, not
this phase's job), Firefox/WebKit in CI, comparative performance
benchmarking.

## Done criteria (for the phase as a whole)

Before declaring Phase 16 done: every issue 001-007 merged to `main`
individually (per this repo's one-commit-per-issue convention), the clean-
checkout verification above passes, `plan/CHANGELOG.md` has its Phase 16
entry, and the `phase-16-testing-infrastructure` branch (if one was used
for isolation) is deleted per `plan/ROADMAP.md`'s branching policy.
