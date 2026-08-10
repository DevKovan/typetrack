# Phase 20 brief: CI hardening

Read CLAUDE.md, `plan/VISION.md`, and `plan/ROADMAP.md` (Phase 20 section)
first. Then read `plan/phase-19-performance-benchmarking/BRIEF.md` (most
recent precedent for this document's structure, and its own "A note on
CI" section, which is the standing, previously-unverified claim this
phase's issue 001 finally investigates properly instead of restating) and
`.github/workflows/qa.yml` in full (the one CI workflow this repo runs,
and the exact step sequence issue 002's fix must not break).

This phase builds directly on top of Phases 6-19; do not re-litigate their
design.

## Scope change mid-phase

This phase's original scope (per `plan/ROADMAP.md` before this phase
started) also included branch protection on `main` and required-checks
config. Partway through planning, the orchestrator session
(`typetrack-12`) requested that scope be split out: branch protection
moves to a new **Phase 22** (after the existing Phase 21, npm-publish-CI +
SEO), and Phase 20 keeps only the CI-trigger-flakiness investigation and
flaky-test triage. `plan/ROADMAP.md` has been updated accordingly (Phase
20's bullet trimmed, new Phase 22 entry added after Phase 21). This
BRIEF and its issues reflect the trimmed scope — branch protection is not
discussed further here.

This split turned out to be the right call independent of the
orchestrator's own reasoning: see issue 001's "gh auth scope" finding —
this session's `gh` credentials have read-only access to the repo (no
`push`, no `admin`), so branch-protection configuration (which needs repo
admin) could not have been executed from this session anyway. A future
Phase 22 worker will need either an escalated token or a human with admin
access to actually apply it.

## Research grounding (investigated, not assumed)

Before writing anything, this phase's own planning investigated — using
`gh api` — the standing claim (repeated, unverified, across Phases 16-19's
own "A note on CI" sections) that GitHub Actions has been intermittently
failing to trigger `qa.yml` runs on pushes to `main`:

- **The claim is real, but smaller than the qualitative "several
  consecutive pushes, zero runs" framing suggested**, and the method used
  to previously "confirm" it (`gh api .../actions/runs`, eyeballing gaps
  in the run list) was itself unreliable: workflow runs are keyed by
  `head_sha`, and comparing the *commit* list (`git log` / `gh api
  .../commits`) against the *run* list conflates two different things —
  a `git push` covering several already-created local commits produces
  exactly **one** push event (and, if triggered, one run) for the final
  `head_sha`; the earlier commits in that push never get their own run by
  design, not because of a dropped trigger. A naive commit-vs-run diff
  over this repo's full history found 90 of 158 commits with no matching
  run — which looks alarming but is mostly this artifact, since commit
  *author* timestamps (what `git log`/`gh api .../commits` exposes) record
  when a commit was created locally, not when it was pushed.
- **The rigorous check uses GitHub's Events API
  (`gh api repos/DevKovan/typetrack/events`)**, which records actual
  `PushEvent`s with real push timestamps and `payload.head` — one entry
  per real `git push` to `main`, not per commit. Cross-referencing the 80
  `PushEvent`s available (GitHub's events feed is retention-limited — this
  covers 2026-08-01 through 2026-08-10, the most recent ~10 days) against
  the 70 workflow runs actually recorded
  (`repos/DevKovan/typetrack/actions/runs`) found **11 of 80 pushes
  (13.75%) with no corresponding workflow run at all** — a real,
  non-trivial silent-trigger-failure rate, not a misreading of batched
  pushes. Full evidence and methodology are written up in issue 001's
  output doc.
- **The failures cluster, they don't scatter randomly**: the 11 missed
  triggers fall into exactly two tight windows (2026-08-01 11:57–12:13,
  five consecutive pushes over 16 minutes; 2026-08-06 18:36–19:48, six
  consecutive pushes over 72 minutes) rather than being spread evenly
  across the 10-day window. A misconfigured or flaky `qa.yml` (wrong
  trigger syntax, a YAML error) would fail *every* push, not just pushes
  inside two short bursts while dozens of pushes before, between, and
  after each burst triggered normally. Clustering is the signature of a
  transient GitHub-side event-delivery hiccup (e.g. a webhook/event-bus
  backlog), not a repo-config defect — consistent with, and now actually
  evidencing, what Phases 16-19 asserted without proof.
- **Ruled out, with evidence, as causes**: `gh api rate_limit` showed
  4,976/5,000 core requests remaining (not rate-limited); this is a public
  repo, and GitHub Actions minutes are unmetered/unbilled for public
  repos, so an Actions-minutes/billing exhaustion is structurally not
  possible here regardless of usage.
- **Could not be fully investigated — flagged per the task's explicit
  instruction to say so rather than silently skip**: this session's `gh`
  auth (`gh auth status`) is scoped to a personal account
  (`Ajith-Pandian`) with only `pull: true` on `DevKovan/typetrack` (`push:
  false`, `admin: false` — confirmed via `gh api repos/DevKovan/typetrack
  -q .permissions`). The actual commit author / push identity for this
  repo (`DevKovan`, via a separate SSH key/host alias,
  `git@github-devkovan:...`) has no equivalent `gh`/REST credential
  available in this session. This blocks: webhook delivery logs (`gh api
  .../hooks` → 403, needs `admin:repo_hook` scope this token doesn't have
  and repo-admin permission this account doesn't have), and any
  organization/account-level Actions status page or incident history a
  repo admin's dashboard might show. If a future session has a token for
  the `DevKovan` account (or another account with admin on this repo),
  re-running the webhook-delivery check would be the one remaining
  avenue to look for a root cause beyond "GitHub-side, transient,
  unconfirmed exact mechanism."
- **Flaky-test triage found one real, systemic issue — but it does not
  affect actual CI**: `bun test --rerun-each=5` (Bun's built-in
  repeated-run flag, exactly the tool this phase's task description named)
  surfaced 152 failing/44-erroring test executions, entirely traced to one
  root cause across 9 files (`packages/{react,next,remix,svelte,vue,solid,
  astro,nuxt}` plus `src/index.global.integration.test.ts`): each of these
  files' `testSetup.ts` calls `GlobalRegistrator.register()` (happy-dom)
  at *module top level*, paired with an `afterAll(() =>
  GlobalRegistrator.unregister())` in the actual test file. Bun's
  `--rerun-each` re-invokes a test file's hooks/tests N times but does
  **not** re-evaluate the file's top-level module code — so `register()`
  fires once, but `unregister()` fires on every rerun, throwing
  `"has not previously been globally registered"` starting on rerun #2.
  Three independent, non-rerun-each, freshly-invoked `bun run test`
  executions (exactly what `qa.yml` runs, no flags) were run back to back
  and were **100% clean, 1348/1348 pass, all three times** — this is a
  `--rerun-each`-tooling artifact, not intermittent CI flakiness. See
  issue 002 for the fix (idempotency guards) and its documented remaining
  limitation (DOM-dependent assertions in `examples/frameworks/*` still
  fail, gracefully, on reruns #2+ — a structural consequence of the
  `register()`-must-run-before-`vue`/`svelte`/etc.-is-imported ordering
  constraint several of these `testSetup.ts` files' own comments already
  document, not something this phase's fix re-architects).

## Scope (trimmed, from plan/ROADMAP.md), mapped to issues

- **CI-trigger reliability investigation** → issue 001. Write-up of the
  evidence above as a permanent, citable doc (`CONTRIBUTING.md`,
  "Continuous Integration" section) — methodology, the exact `gh api`
  commands used (reproducible by a future session), the two burst
  windows, what was ruled out, and the explicit gh-auth-scope limitation.
- **Flaky-test triage** → issue 002. The `GlobalRegistrator.isRegistered`
  guard fix across the 9 affected files, plus the same `CONTRIBUTING.md`
  doc gaining a "Flaky-test triage" section recording the method
  (`bun test --rerun-each=N`), the root cause, the fix, and the documented
  residual limitation.
- Wrap-up (`plan/CHANGELOG.md` entry, README cross-link to
  `CONTRIBUTING.md`) → issue 003, last.

## Design decisions locked for this phase

1. **Findings live in a new root `CONTRIBUTING.md`, not `docs/`.**
   `docs/README.md`'s existing guide index (architecture, cookbook,
   migration, provider guides, ...) is explicitly library-consumer-facing
   ("how do I use typetrack"); CI-trigger reliability and flaky-test
   triage are repo-contributor/ops content with a different audience.
   This repo has no `CONTRIBUTING.md` yet — adding one at the
   conventional root location, cross-linked from README.md's existing
   "Building from source" section (which already talks to contributors,
   not consumers), is the right home and needs no restructuring of
   `docs/`.
2. **The flaky-test fix is a minimal idempotency guard, not a
   restructure of the happy-dom register/unregister pattern.** Moving
   `register()` out of module-top-level (e.g. into a `beforeAll`, which
   *does* re-run under `--rerun-each`) was considered and rejected: every
   affected `testSetup.ts` file's own header comment documents that
   `register()` must execute *before* `vue`/`svelte`/`solid`/etc. are
   imported (an ESM-ordering hazard, not a preference), and imports are
   resolved at file-parse time — before any hook, including a
   first-in-file `beforeAll`, ever runs. A guard
   (`if (GlobalRegistrator.isRegistered) unregister();`) is the correct,
   minimal fix for the actual defect (an unhandled crash cascading into
   `"Unhandled error between tests"` noise that pollutes unrelated
   later-running files' output), without pretending to solve full
   N-rerun DOM availability, which the ordering constraint makes
   structurally unreachable without a larger rework this phase's task
   scope (flaky-test triage, not a testing-infrastructure redesign) does
   not ask for.
3. **`src/index.global.integration.test.ts` gets the same guard even
   though it was already rerun-each-safe** (its `register()`/
   `unregister()` are both scoped inside the same `it()`, in a
   `try`/`finally`, unlike the module-top-level pattern the other 8 files
   use) — defensive consistency, zero behavior change for the common
   case, and it means every `GlobalRegistrator.unregister()` call site in
   the repo now shares the same defensive shape.
4. **No change to `examples/frameworks/*`.** Those packages hit the exact
   same "document not defined" symptom under `--rerun-each` (their own
   `testSetup.ts` files follow the identical pattern), for the identical
   structural reason as Design decision 2. Since normal CI never invokes
   `--rerun-each`, and the fix would be the same non-fix (a guard,
   not a cure) as the 9 files above, this phase does not touch
   `examples/` — the finding is recorded in `CONTRIBUTING.md` (issue 002)
   as a known, accepted limitation of the tool rather than silently
   ignored.

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-20-ci-hardening/`. **Issue files
   are kept, never deleted** (standing policy — see `plan/ROADMAP.md`
   "Policy changes").
2. Implement each issue directly (no `implementor`/`qa` subagent split
   this phase — both issues are small, already-investigated, single-topic
   changes with no unresolved design questions left to delegate; per
   CLAUDE.md's guidance, sub-planner/implementor agents are for phases
   with real scoping ambiguity or parallelizable independent work,
   neither of which applies here).
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

Run the full `.github/workflows/qa.yml` step sequence locally before every
push (build:all, size, e2e, lint, typecheck, typecheck:svelte, test,
knip).

## Branching / landing

This session is already on `ao/typetrack-23/root` (an AO worker branch),
not a fresh `phase-20-ci-hardening` branch — small, low-risk, docs-plus-
guard-clauses diff (2 files touched for docs, 9 for the one-line guard
each), same low-blast-radius shape as Phase 17's docs-only diff, so no
separate isolation branch was cut. Once issues pass local QA: push commits
to `origin/main` directly (no PR, no force-push — if `origin/main` has
moved, rebase cleanly on top). Do **not** delete
`plan/phase-20-ci-hardening/` issue files. Add a one-line Phase 20 entry
to `plan/CHANGELOG.md`, following the existing format — issue 003 owns
this.

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work (including Phase 22, branch protection — that's a separate future
phase, not this one, per the mid-phase scope split above). Report back and
go idle once this phase's commits are on `main`.

## Out of scope for this whole phase

- Branch protection on `main`, required-status-checks config — moved to
  the new Phase 22 (see "Scope change mid-phase" above).
- Actually re-triggering or "fixing" GitHub's own event-delivery
  mechanism — outside repo-owner control per issue 001's findings; the
  deliverable is the investigation and its documented conclusion, not a
  guaranteed cure for GitHub-side infra.
- A full rework of the happy-dom register/unregister test-setup pattern,
  or making `examples/frameworks/*`/the 9 fixed files fully
  `--rerun-each`-safe across unlimited reruns — see Design decisions 2
  and 4.
- Any change to `.github/workflows/qa.yml` itself — no evidence found
  that the workflow file's own trigger config (`push: branches: [main]`)
  is wrong; the majority of pushes in the investigated window did trigger
  correctly.
