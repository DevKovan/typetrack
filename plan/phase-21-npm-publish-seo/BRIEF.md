# Phase 21 brief: npm publish CI + SEO pass

Read CLAUDE.md, `plan/VISION.md`, and `plan/ROADMAP.md` (Phase 21 section)
first. Then read `plan/phase-20-ci-hardening/BRIEF.md` (most recent
precedent for this document's structure) and `.github/workflows/qa.yml` in
full (the one CI workflow this repo runs — `release.yml` is new, additive,
and must not duplicate or fight qa.yml's own triggers/steps).

This phase builds directly on top of Phases 6-20; do not re-litigate their
design. This repo has **never been published to npm** — this is the first
real release, so this BRIEF is more explicit about versioning and
publish-mechanics than prior phases needed to be.

## Research grounding (investigated 2026-08-11, not assumed)

Before planning, researched (WebSearch/WebFetch) current npm/GitHub Actions
publish conventions and Bun-workspaces monorepo tooling, and independently
verified two things by hand against this repo (`npm view typetrack`, `npm
pack --dry-run`, `bun publish --dry-run`, reading every `packages/*/
package.json`):

- **npm trusted publishing (OIDC, token-less) cannot bootstrap a brand-new
  package.** npm's trusted-publisher config
  (docs.npmjs.com/trusted-publishers) can only be set on a package that
  already exists on the registry — confirmed via npm's own docs and
  multiple independent write-ups, plus an open, unresolved npm/cli issue
  (#8544) asking for PyPI-style pre-registration that npm doesn't have.
  Every one of this repo's 9 publishable packages is brand new. This
  directly shapes the versioning-strategy decision below: **this phase
  cannot produce a working token-less first release** — the first publish
  of each package must be token-authenticated, and OIDC trusted publishing
  only becomes available *after* that first publish, as a follow-up
  hardening step.
- **`--provenance` itself (the Sigstore-signed build attestation) is a
  separate, older (2023) feature from trusted publishing (2025) and does
  not have the same bootstrap problem** — it works with either
  token-based or OIDC-based auth, as long as the workflow runs in GitHub
  Actions with `permissions: id-token: write` and npm CLI ≥11.5.1 / Node
  ≥22.14. So `release.yml` can and should pass `--provenance` from day
  one, even while using a classic automation token for auth.
- **`typetrack` and every `@typetrack/*` scoped name are unclaimed** on the
  npm registry (`npm view typetrack` / `npm view @typetrack/react` both
  404). No squatting risk found, but this also means there is no existing
  npm org to inherit settings from — a human needs to create the
  `typetrack` npm org (or publish `@typetrack/*` under a personal account
  with that scope) before any publish, real or dry-run-with-auth, can
  happen.
- **This session has no path to a real publish regardless of design
  choice**: `npm whoami` → `ENEEDAUTH` (no npm login in this environment),
  and Phase 20's own finding (this session's `gh` auth is
  read-only/`pull: true` on the repo, confirmed still applicable) means
  this session cannot create the `NPM_TOKEN` GitHub Actions secret
  `release.yml` will need, either. Both the local-manual-publish path and
  the CI-triggered path are equally out of reach here — this is not a
  reason to design around one path over the other, just a confirmation
  that **this phase stops at "workflow built + dry-run verified"** per
  the task's own instruction, regardless.
- **`bun publish` (not `npm publish`) is the right tool for the actual
  publish step**: per Bun's own docs, `bun publish` correctly resolves
  `workspace:*` protocol dependencies to the sibling's real version number
  at pack time (verified: `@typetrack/next`/`@typetrack/remix` depend on
  `@typetrack/react: workspace:*`, `@typetrack/nuxt` depends on
  `@typetrack/vue: workspace:*`). `changeset publish` does not do this
  reliably for Bun workspaces (confirmed via a changesets/changesets
  discussion thread) and would need an extra `bun update` resync step —
  one more moving part for no benefit here.
- **`bun publish` does *not* resolve `file:` protocol dependencies** the
  same way — and 8 of the 9 publishable packages depend on root
  `typetrack` via `"typetrack": "file:../.."` (per CLAUDE.md's own
  standing decision: root `typetrack` isn't a `workspaces` glob member,
  so `workspace:*` fails outright for it, `file:../..` is the documented
  workaround for *local dev*). A `file:../..` dependency published as-is
  is silently broken for every external installer — the referenced path
  won't exist on their machine. Confirmed by hand: neither `bun publish
  --dry-run` nor `npm pack --dry-run` warns about this — it packs
  `file:../..` into the tarball's `package.json` verbatim with no error.
  **This is a real correctness bug this phase must fix**, not a
  nice-to-have — see issue 002.
- **`npm pack --dry-run` needs no registry auth** and is the right
  verification tool for this phase's "dry-run" deliverable (`bun publish
  --dry-run` was tried by hand and errors `missing authentication` even
  in dry-run mode, since Bun's dry-run still opens an authenticated
  registry connection to compute what *would* happen — not usable in this
  session or in a `release.yml` CI run without a token already configured).
- **No LICENSE file exists anywhere in the repo**, despite every
  `package.json`'s `"license": "MIT"` field. `npm pack --dry-run` (root)
  confirms it: tarball contents are just `README.md` + `package.json`, no
  LICENSE. npm auto-includes a `LICENSE` file in the tarball if one
  physically exists next to the `package.json` being published, but
  doesn't error or warn if it's missing — so this has silently been true
  since Phase 0 and nothing caught it until now.
- **None of the 8 `packages/*` publishable packages has a `README.md`.**
  npm displays a package's own `README.md` (not the repo root's) on its
  npm page — right now all 8 would publish with npm's generic
  "no readme" placeholder page.
- **None of the 8 scoped `@typetrack/*` packages has `publishConfig:
  {"access": "public"}`.** npm defaults new scoped packages to
  `restricted` (paid-private) unless either `--access public` is passed
  at publish time or `publishConfig.access` is set in `package.json`.
  Without this, the very first `bun publish` of each scoped package would
  fail (free accounts can't publish restricted scoped packages) or
  silently attempt a private publish. Root `typetrack` is unscoped and
  defaults to public already, so it doesn't need this field.

## Publishable package set (confirmed, not re-litigated)

9 packages: root `typetrack` + `packages/{react,next,vue,nuxt,svelte,
solid,astro,remix}`. The other 4 packages under `packages/*`
(`provider-ga4`, `provider-posthog`, `provider-segment`,
`provider-contract-kit`) are **not published** — this was already decided
in Phase 2 (`plan/phase-2-providers/001-posthog-provider.md`: `"private:
true"`) and confirmed in Phase 16's BRIEF (Design note: "source-only,
dev/test packages, never published" — no `tsup` config, `main`/`types`
point straight at `src/index.ts`). This phase does not reopen that
decision; those 4 stay `"private": true`, absent from `release.yml`,
absent from the version bump.

## Versioning strategy (locked decision)

**Lockstep, manual version bump — no Changesets.** All 9 publishable
packages move from `0.0.0` to **`0.1.0`** together, in this phase, as one
of the issues below. Reasoning:

1. **0.1.0, not 1.0.0.** This is a first public release; semver convention
   for "we're not yet promising API stability" is `0.x`, not `1.0.0` —
   `1.0.0` would overclaim stability this project (still pre-1.0 per its
   own README "Status" section) hasn't earned yet. Root `typetrack`'s
   `package.json` `"version": "0.0.0"` was always a placeholder, never a
   real release — `0.1.0` is the actual first version, not a "bump from
   0.0.0" in the normal semver sense.
2. **Lockstep, not independent per-package versioning.** With 9 packages
   and a single-committer-per-phase workflow (no PRs, no lingering
   branches — `.claude/skills/git-discipline/SKILL.md`), independent
   versioning buys nothing yet: there's no history of packages evolving at
   different rates, and lockstep is simpler for consumers to reason about
   ("everything at 0.1.0 was tested and released together"). This can
   change later if real divergent release cadences emerge — not a
   decision this phase needs to future-proof.
3. **No Changesets.** Changesets exists to solve two problems this repo
   doesn't have yet: decentralized changelog authorship across many
   contributors' PRs, and automated semver-bump propagation across
   independently-versioned packages. This repo has neither — one
   contributor per phase, hand-maintained `plan/CHANGELOG.md`, and (per
   decision 2) lockstep versioning. Adding Changesets now would be new
   tooling with no problem yet to solve, and CLAUDE.md's own toolchain
   philosophy (devDependencies only, deliberately curated) argues against
   adding a tool that isn't earning its keep. `bun publish` alone
   (correctly resolving `workspace:*`, per the research above) is
   sufficient. Revisit if/when this project gains multiple concurrent
   external contributors.

## The `file:../..` publish problem and its fix (locked decision)

8 packages (`react`, `next`, `vue`, `nuxt`, `svelte`, `solid`, `astro`,
`remix`) depend on root `typetrack` via `"typetrack": "file:../.."` for
local dev (CLAUDE.md's documented, correct reason: root isn't a
`workspaces` glob member). Publishing that literal string breaks the
package for every external installer. Fix: a small publish-time script
(`scripts/publish.ts`, issue 002) that, for each dependent package,
**temporarily rewrites** `"typetrack": "file:../.."` to `"typetrack":
"^0.1.0"` (a real semver range) immediately before running `bun publish`
for that package, then restores the original `file:../..` afterward
(`git checkout -- <package.json>`, since the rewrite never needs to be
committed — it only needs to exist transiently for the `bun publish`
invocation to pack the correct value). This keeps CLAUDE.md's local-dev
`file:../..` decision completely intact; the rewrite is publish-only and
never lands in a commit. `@typetrack/react`/`@typetrack/vue`
`workspace:*` deps need no such handling — `bun publish` already resolves
those correctly (research finding above).

Publish order (script-enforced, matches dependency direction — not a Bun
requirement per se, since `workspace:*` resolves from local version
numbers rather than the registry, but keeps the on-registry state coherent
in the small window between packages during a real future run): `typetrack`
→ `react`, `vue`, `svelte`, `solid`, `astro` → `next`, `remix`, `nuxt`.

## Does this phase execute a real `npm publish`? **No.**

Locked answer, per the task's own explicit ask to flag this rather than
decide it silently: **this phase stops at "the publish workflow is built
and dry-run verified"; the real first publish is a manual human follow-up,
not something this session executes.** Reasons, layered:

1. **A real publish is a genuinely hard-to-reverse action** (npm allows
   unpublishing within 72 hours only, and even then with caveats for
   packages with dependents) — exactly the class of action this
   environment's standing instructions say warrants a check-in rather than
   autonomous execution.
2. **It's also not *possible* from this session regardless of that
   policy**: no npm login (`npm whoami` → `ENEEDAUTH`), no `NPM_TOKEN`
   secret exists on the repo, and this session's `gh` credentials can't
   create one (`push: false`, `admin: false` — Phase 20's finding, still
   true here). There is no path to a real publish from this sandbox even
   if it were desirable.
3. **A human needs to do several irreducibly-manual things first anyway**:
   create the `typetrack` npm org (or claim the scope under a personal
   account), generate an npm automation token, add it as the `NPM_TOKEN`
   GitHub Actions secret (needs repo admin), and only then trigger
   `release.yml`. These are enumerated as a checklist in issue 005's
   `RELEASING.md`, not performed here.

This phase's actual deliverable for "is it really publishable": `bun run
build:all` (real build), then `npm pack --dry-run` per package (real,
auth-free tarball-content verification — confirms `dist/`, `README.md`,
`LICENSE`, and a correctly-rewritten `package.json` all end up in the
tarball, and that the `file:../..` rewrite-and-restore round-trips
cleanly with no leftover diff). This is issue 005.

## Scope, mapped to issues

- **Package metadata + version bump** → issue 001. Root + 8 packages:
  `0.0.0` → `0.1.0`; add `publishConfig.access: public` to the 8 scoped
  packages; add `repository`/`homepage`/`bugs` fields (pointing at
  `github.com/DevKovan/typetrack`, monorepo `directory` field for the 8
  sub-packages); add a `keywords` array to all 9 (specific, real terms —
  no keyword-stuffing); tighten/confirm every `description` is a single
  sentence, roughly ≤140 characters (npm's own convention, confirmed in
  research). Add a root `LICENSE` file (MIT, matching the existing
  `"license": "MIT"` field) and copy it into each of the 8 `packages/*`
  directories (physical copies, not symlinks — simplest, no build-step
  dependency, low drift risk for a license file that rarely changes).
- **Publish-time `file:` dependency rewrite script** → issue 002.
  `scripts/publish.ts`: per-package rewrite → `bun publish
  --access public --provenance [--dry-run]` → restore, in the locked
  publish order above, root `typetrack` first with no rewrite needed.
  Must be idempotent and safe to run in `--dry-run` mode with zero side
  effects on the working tree (verify with `git status` before/after in
  issue 005).
- **`release.yml`** → issue 003. `workflow_dispatch` trigger only (not
  automatic on push/tag — matches the "no autonomous real publish" decision
  above: a human explicitly runs this, on purpose, when ready), with a
  `dry_run` boolean input (default `true`) so the workflow itself can be
  exercised safely in CI before anyone flips it to a real run.
  `permissions: { contents: read, id-token: write }`. Steps: checkout,
  `oven-sh/setup-bun`, `actions/setup-node@v4` with `registry-url:
  https://registry.npmjs.org/` (required for npm auth env-var wiring even
  though the actual publish uses `bun publish`, not `npm publish`), `bun
  install`, `bun run build:all` (exact mirror of `qa.yml`'s Build step),
  then `bun run scripts/publish.ts --dry-run=${{ inputs.dry_run }}` with
  `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` in the env. Does not remove
  or modify `qa.yml`.
- **Package READMEs + root SEO pass** → issue 004. A `README.md` for each
  of the 8 `packages/*` publishable packages (install snippet, minimal
  usage example matching that package's actual API, link back to root
  `docs/`) — short, consistent shape across all 8, not padded. Root
  `README.md` gains an npm badges row (shields.io: version, downloads,
  license — bundle-size badge deferred, see Design decision 4 below) and
  its "Status" section is updated to stop saying "not yet published to
  npm" (replace with an accurate statement: CI is built, first real
  publish is a pending manual step — do not claim it's live before it is).
- **Dry-run verification + `RELEASING.md` + wrap-up** → issue 005, last.
  Build everything, run issue 002's script in `--dry-run` mode for real
  against all 9 packages, inspect actual tarball contents (`npm pack
  --dry-run` per package after the rewrite step, or reading `bun publish
  --dry-run`'s packed-file list once a token exists — document why this
  session can only use the former), confirm `git status` is clean after
  the script runs (no leaked rewritten `package.json`), write
  `RELEASING.md` at repo root (the manual human checklist: create npm org,
  generate token, add `NPM_TOKEN` secret, run `release.yml` with `dry_run:
  false`, then post-publish: configure npmjs.com Trusted Publisher per
  package and drop the token requirement for future releases), add a
  `plan/CHANGELOG.md` Phase 21 entry, cross-link `RELEASING.md` from
  README's existing "Building from source" area.

## Design decisions locked for this phase

1. **`bun publish`, not `npm publish`, is the actual publish command** in
   both the script and `release.yml` — see research grounding above
   (`workspace:*` resolution). `npm pack --dry-run` is still the
   *verification* tool this phase itself uses (no-auth-required), since
   `bun publish --dry-run` needs a token this session doesn't have.
2. **Provenance (`--provenance`) is included from the very first publish**,
   not deferred to a later hardening phase — it has no bootstrap problem
   (unlike trusted publishing) and there's no reason to ship the first
   version without it.
3. **Trusted publishing (OIDC, token-less) is explicitly out of scope for
   this phase** — it cannot bootstrap new packages (research finding
   above). `RELEASING.md` (issue 005) documents it as a recommended
   *follow-up* once every package has its first version published, but
   configuring it is a human task on npmjs.com, not something this phase's
   `release.yml` can do.
4. **Bundle-size badge deferred, not added this phase.** A shields.io
   bundle-size badge needs the package live on the registry to compute
   against (bundlephobia/Bundlejs-style endpoints resolve a *published*
   package) — adding the badge markup now would render broken/404 until
   the real publish happens. `RELEASING.md` notes this as a post-publish
   follow-up. Version/downloads/license badges are added now even though
   they'll also 404 until publish, because that's normal, expected,
   self-resolving npm-badge behavior every new package's README goes
   through (shields.io shows a "package not found" badge state, not a
   broken image) — the bundle-size case is different only because the
   *endpoint itself* depends on registry data source availability in a
   way plain version/downloads badges don't.
5. **`release.yml` is additive — `qa.yml` is untouched.** No shared steps
   are factored out into a reusable workflow; the duplication (checkout,
   setup-bun, bun install, build:all) between the two files is small and
   copying it is simpler than introducing `workflow_call` composition for
   a two-workflow repo.

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-21-npm-publish-seo/`. **Issue files
   are kept, never deleted** (standing policy — see `plan/ROADMAP.md`
   "Policy changes").
2. Implement each issue directly (no `implementor`/`qa` subagent split —
   every issue here is small-to-medium, already-scoped by this BRIEF, with
   no open design questions left to delegate; per CLAUDE.md's guidance,
   sub-planner/implementor agents are for phases with real scoping
   ambiguity or parallelizable independent work, neither of which applies
   here).
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

Run the full `.github/workflows/qa.yml` step sequence locally before every
push (build:all, size, e2e, lint, typecheck, typecheck:svelte, test, knip).

## Branching / landing

Commit straight to `main`, no PR, no lingering branches, small commit per
issue (per repo convention — see `.claude/skills/git-discipline/SKILL.md`).
Do **not** delete `plan/phase-21-npm-publish-seo/` issue files. Add a
Phase 21 entry to `plan/CHANGELOG.md` (issue 005 owns this).

**STOP AFTER THIS PHASE.** Do not start Phase 22 (branch protection) or any
further phase. Do not, under any circumstance, run a real `bun publish` /
`npm publish` against the real registry, create an npm org/token, or add
GitHub secrets, even if it later becomes technically possible mid-phase —
that action needs an explicit, separate human go-ahead outside this
phase's scope, per the locked decision above. Report back and go idle once
this phase's commits are on `main`.

## Out of scope for this whole phase

- Branch protection on `main` — Phase 22, unaffected by this phase.
- A real `npm publish` / `bun publish` to the live registry — see "Does
  this phase execute a real npm publish?" above.
- npm org creation, token generation, GitHub secret configuration — human
  follow-up steps enumerated in `RELEASING.md`, not executed here.
- Configuring npm Trusted Publishing (OIDC) — cannot bootstrap new
  packages; documented as a post-first-publish follow-up only.
- Independent per-package versioning, Changesets, or any other
  multi-version-cadence tooling — locked decision above; lockstep manual
  bump is sufficient for a 9-package, single-committer-per-phase repo.
- Publishing the 4 private `provider-*`/`provider-contract-kit` packages —
  standing decision from Phases 2 and 16, not reopened here.
- A bundle-size npm badge — deferred to post-publish (Design decision 4).
