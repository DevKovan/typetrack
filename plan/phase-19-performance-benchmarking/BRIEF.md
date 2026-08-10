# Phase 19 brief: performance benchmarking

Read CLAUDE.md, `plan/VISION.md` ("Performance (target)") and
`plan/ROADMAP.md` (Phase 19 section) first. Then read
`plan/phase-16-testing-infrastructure/BRIEF.md` in full (precedent for this
document's structure, and — critically — its Design decision 3, which
explicitly scoped comparative benchmarking *out* of that phase and assigned
it here) and `plan/phase-17-documentation/008-performance-guide.md` plus the
current `docs/performance.md` and `docs/comparison.md` (this phase's actual
output target — both already contain a stub sentence pointing at Phase 19).
Also read, in full, the existing bundle-size/perf infrastructure this phase
extends rather than duplicates: root `.size-limit.json`,
`src/index.performance.test.ts` (Phase 16's regression smoke test — stays
as-is, a different purpose than this phase, see Design decision 1), and
`e2e/server.ts` + `e2e/playwright.config.ts` + `e2e/fixtures/*.html` (the
Playwright-in-Chromium pattern this phase's cross-library harness reuses).

This phase builds directly on top of Phases 6-18; do not re-litigate their
design.

## Research grounding (informed the design, not assumed)

Before planning, researched (WebSearch/WebFetch, 2026-08-10) rather than
assumed:

- **Benchmarking harness for Bun**: Bun's own docs
  (https://bun.com/docs/project/benchmarking) state plainly: "For
  microbenchmarks, we recommend `mitata`." `mitata` is the tool Bun and Deno
  themselves ship/use internally, with V8-deopt detection and a
  machine-parseable output format. `tinybench` is the lighter-weight
  alternative that ships inside Vitest's own `bench` command, aimed at
  everyday DX rather than rigorous microbenchmarking. Since Bun's own
  documentation names `mitata` specifically and this repo's toolchain is
  already Bun-first, this phase uses `mitata` — not a repo-invented choice,
  the platform's own recommendation.
- **Real bundle sizes of the three comparison vendors' current npm
  packages**, fetched via bundlephobia's public API
  (`https://bundlephobia.com/api/size?package=<name>`), which computes real
  minified and minified+gzip sizes by installing and bundling the actual
  published package (not a guess or a marketing number):

  | Package | Version | Minified | Minified+gzip |
  |---|---|---|---|
  | `posthog-js` | 1.414.0 | 236,469 B (~231 KB) | 77,616 B (~76 KB) |
  | `@segment/analytics-next` | 1.84.1 | 103,185 B (~101 KB) | 28,246 B (~28 KB) |
  | `@rudderstack/analytics-js` | 3.31.6 | 106,918 B (~104 KB) | 31,123 B (~30 KB) |

  For comparison, typetrack's own current, actually-built (not budget-limit)
  numbers as of this phase (`bun run build`, then `gzip -c dist/<file> | wc
  -c`): core ESM `dist/index.js` — 67,712 B raw / 15,754 B gzip (budget 18
  KB); core IIFE/CDN `dist/index.global.js` — 30,986 B raw / 10,989 B gzip
  (budget 12.5 KB). Both already comfortably smaller, gzipped, than every
  comparison vendor's *own* gzip size alone — a real, citable number, not a
  qualitative claim. `posthog-js`'s `hasSideEffects: true` /
  `@rudderstack/analytics-js`'s `hasSideEffects: true` (both confirmed via
  the same bundlephobia API response) are also real, useful signals for the
  tree-shaking comparison (issue 003).
- **Whether cross-library runtime comparison (cold start/memory/throughput)
  is fair to attempt at all**: all three vendor SDKs are browser SDKs that,
  un-configured, phone home on init (PostHog: feature-flag fetch,
  autocapture, session-recording setup; Segment: a CDN "integrations
  settings" JSON fetch before anything else runs; RudderStack: a similar
  source-config fetch) — none of that is representative of typetrack's own
  dispatch-overhead numbers, and running any of it against live vendor
  infrastructure from CI would be both non-reproducible and a violation of
  this repo's own documented aversion to flaky, network-dependent CI (see
  "A note on CI" below). This is answered by Design decision 4 (measure for
  real, in a real browser, against a local stub endpoint with heavy
  optional features explicitly disabled in each vendor's own config) rather
  than skipping the dimension entirely — full comparative numbers are
  achievable without live network calls, so this phase does not silently
  reduce Phase 19's scope on this point. What genuinely cannot be claimed
  with full confidence, and is called out explicitly in the results
  methodology sections (issues 004-005) rather than glossed over, is that
  each vendor's *default*, most-features-enabled configuration would cost
  measurably more — the numbers here are a best-effort, documented,
  reduced-feature-set comparison, not each vendor's out-of-the-box number.

## Scope (from plan/ROADMAP.md), mapped to issues

- **Bundle size** → issue 003 (own real numbers already measured above;
  issue 003 formalizes the comparison table + a committed, sourced data
  snapshot).
- **Tree-shaking** → issue 003 (same issue — static `sideEffects`/module
  inspection plus a real built minimal-import fixture proving typetrack's
  own dead-code elimination).
- **Cold start, memory, throughput for typetrack itself** → issue 002
  (`mitata`-based, Bun-native, fully reliable and reproducible — no
  cross-vendor fairness question at all).
- **Cold start, memory — cross-library comparison** → issue 004
  (Playwright/Chromium, reusing `e2e/`'s pattern, against a local stub
  endpoint).
- **Throughput — cross-library comparison** → issue 005 (same harness as
  004, extended).
- **Workspace scaffold + local stub server** (shared dependency of 002-005)
  → issue 001.
- **Feed real numbers into `docs/performance.md`/`docs/comparison.md`**
  (explicitly requested by this phase's task description, not just
  ROADMAP.md) → issue 006, last.

## Design decisions locked for this phase

1. **`src/index.performance.test.ts` (Phase 16) is untouched.** That file
   is a regression *guard* — deliberately generous, non-comparative
   thresholds, run on every push inside `bun test`, catching an
   order-of-magnitude accidental regression. This phase's `mitata` suite
   (issue 002) is a *measurement* tool — precise, comparative-across-config,
   run on demand (`bun run bench`), never gating CI. Two different jobs,
   two different files; Phase 16's BRIEF (Design decision 3) drew this
   exact line when deferring "comparative... benchmarking" here.
2. **A new top-level `benchmarks/` workspace, sibling of `e2e/`,
   `packages/`, `examples/`.** Not nested under `examples/` (same reasoning
   Phase 16 gave for `e2e/`: this is internal measurement tooling verifying
   this repo's own artifacts, not a user-facing "how to use typetrack"
   demo an app author would read) and not inside `src/`. Wired into root
   `package.json` `"workspaces"` and `tsconfig.json` `"include"` exactly the
   way `e2e/` already is.
3. **Real vendor SDKs (`posthog-js`, `@segment/analytics-next`,
   `@rudderstack/analytics-js`) are added as `benchmarks/`-local
   `devDependencies`, never touching root `package.json` or any
   `packages/*` package.** This does not violate CLAUDE.md's "zero vendor
   deps in core" rule — that rule scopes `src/`, and this repo already has
   direct precedent for vendor SDKs living in a devDependency-only,
   never-published workspace for measurement/testing purposes
   (`packages/provider-posthog`, `packages/provider-segment`, both
   `"private": true`). `mitata` is also a `benchmarks/`-local
   `devDependency`, not a root one — root's devDependency list is
   CLAUDE.md's canonical, closed toolchain list (Bun, `tsgo`, `typescript`,
   `oxlint`, Knip, `tsup`), and `mitata` is benchmarking-specific tooling
   with no reason to widen that list.
4. **A local Bun.serve() stub ingestion endpoint, not live vendor
   infrastructure or a live CDN fetch, backs every cross-library
   measurement.** Mirrors `e2e/server.ts`'s existing pattern (a tiny local
   server, started for the duration of the Playwright run). Every fixture
   page (issue 004) configures its SDK's API host/endpoint to point at this
   local stub (which responds `200` immediately, no processing) instead of
   the vendor's real ingestion API — this is what makes cold-start/
   memory/throughput numbers reproducible in an environment with no network
   access at all (relevant given this repo's own documented GitHub Actions
   trigger flakiness) and removes "vendor server response latency" as a
   confound in what's meant to be a *client-side SDK overhead* comparison.
   Each vendor SDK also has its heaviest optional init-time features
   (autocapture, session recording, heatmaps, feature-flag polling,
   destination-plugin auto-loading) explicitly disabled in its init config
   — documented per-vendor in issue 004's fixture files and results
   methodology section, so the exact configuration measured is fully
   inspectable and reproducible, not asserted.
5. **Vendor bundle-size numbers (issue 003) are a committed, dated,
   sourced JSON snapshot fetched once during this phase's implementation
   (bundlephobia's public API), not re-fetched live on every `bun run
   bench`/CI run.** A pinned vendor package version's bundle size is stable
   between snapshot refreshes, and re-fetching live on every run trades a
   reproducibility/CI-reliability win for no real accuracy gain — consistent
   with Design decision 4's same reasoning. The snapshot file records the
   exact package versions, byte counts, fetch date, and source URL so a
   future phase can refresh it deliberately (e.g. when re-running this
   phase's numbers for a release).
6. **None of `benchmarks/`'s scripts are wired into `.github/workflows/
   qa.yml`.** Comparative timing numbers (cold start ms, throughput
   calls/sec) measured on a shared, noisy CI runner are not trustworthy
   trend data — a runner's own variable load would produce numbers that
   look like regressions/improvements but are actually CI noise, exactly
   the failure mode Phase 16's own smoke-test design notes (BRIEF.md,
   `src/index.performance.test.ts`'s comments) already worked around by
   using deliberately generous, non-comparative thresholds instead of
   precise ones. `benchmarks/` numbers are regenerated on demand, by a
   human, when there's a real reason to (a release, a significant `src/`
   change, a vendor SDK version bump) — `bun run bench` (mitata suite,
   issue 002) and `bun run bench:browser` (Playwright cross-library suite,
   issues 004-005) are documented, runnable commands, just not CI gates.
   `bun install` at the repo root must still succeed with `benchmarks/` in
   the workspace list (verified in issue 001), and `bunx knip`/lint/
   typecheck must still pass against `benchmarks/`'s own source (wired the
   same way `e2e/` already is in `knip.json`/`.oxlintrc.json`/
   `tsconfig.json`) — so this phase does not silently break the existing
   qa.yml steps, it just doesn't add new ones for the benchmark *runs*
   themselves.
7. **Tree-shaking is verified two ways, not asserted**: (a) a real minimal
   fixture (`import { createAnalytics, noopProvider } from "typetrack"`
   only, nothing else) built with the same `tsup`/esbuild toolchain already
   in this repo's devDependencies, comparing its built+minified+gzipped size
   against the full `dist/index.js` gzip size — the delta is what
   tree-shaking actually removed, a measured number, not a claim; (b) static
   `package.json` inspection (`sideEffects`, `module`/`exports` field
   presence) for typetrack and all three vendors, using the same
   bundlephobia API response already fetched for Design decision/issue 003
   (which surfaces `hasSideEffects`/`hasJSModule` directly) as the vendor
   side of that comparison, cited by source and date same as the size
   numbers.

## A note on CI

Per repeated observation across Phases 16-18: GitHub Actions has
intermittently failed to trigger workflow runs for pushes on this repo.
This is GH-side infra, not a code problem — if seen again this phase, do
not chase/force-retrigger; confirm local checks pass on a clean checkout
and move on.

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-19-performance-benchmarking/`. **Issue
   files are kept, never deleted** (standing policy — see
   `plan/ROADMAP.md` "Policy changes").
2. For each issue, in order (001 → 006, respecting the dependency chain —
   002/003 depend on 001's workspace scaffold; 004 depends on 001's stub
   server; 005 depends on 004's fixture harness; 006 depends on 002-005 all
   having produced real results to feed into the docs): the `implementor`
   subagent implements with unit+integration tests where applicable (002-005
   are themselves measurement scripts with results files — "tests" there
   means the harness code itself is unit-tested for correctness, e.g. the
   stub server responds correctly, the results-parsing/formatting logic is
   correct — not that a specific timing number is asserted, per Design
   decision 6), the `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

Run the full `.github/workflows/qa.yml` step sequence locally before every
push (build:all, size, e2e, lint, typecheck, typecheck:svelte, test, knip) —
`benchmarks/` must not break any of them even though its own benchmark runs
aren't part of that sequence (Design decision 6).

## Branching / landing

Branch `phase-19-performance-benchmarking` for isolation (new top-level
workspace, root `package.json`/`tsconfig.json`/`knip.json`/`.oxlintrc.json`
wiring, plus `docs/` changes — multi-file, same shape as Phase 16/18, not
Phase 17's docs-only diff). Once all issues pass QA: push commits to
`origin/main` directly (no PR, no force-push — if `origin/main` has moved,
rebase cleanly on top). Delete the `phase-19-performance-benchmarking`
branch (local, and remote only if pushed there). Do **not** delete
`plan/phase-19-performance-benchmarking/` issue files. Add a one-line
Phase 19 entry to `plan/CHANGELOG.md`, following the existing format (see
the Phase 6-18 entries for current style/length) — issue 006 owns this.

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on `main` and
cleanup is done.

## Out of scope for this whole phase

- Any change to `src/index.performance.test.ts` or its CI-gating
  behavior — see Design decision 1.
- Firefox/WebKit in the cross-library Playwright harness — only Chromium,
  same call Phase 16 made for `e2e/` and for the same reason (no known
  engine-specific divergence relevant to what's measured here; tripling CI
  time, or in this case local run time, for coverage this phase doesn't
  need).
- Measuring each vendor SDK's *default*, all-features-enabled configuration
  — explicitly out of reach without live vendor infrastructure; see
  "Research grounding" above and issue 004's methodology section.
- A `@typetrack/provider-rudderstack` adapter or any other net-new
  `AnalyticsProvider` implementation — this phase measures the *vendor
  SDKs directly* for comparison purposes, it does not add or change any
  typetrack provider adapter.
- Wiring `benchmarks/` scripts into `.github/workflows/qa.yml` as a gate —
  see Design decision 6.
