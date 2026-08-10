# 005 — Dry-run verification, `RELEASING.md`, wrap-up

## Context

Read `plan/phase-21-npm-publish-seo/BRIEF.md` in full first — this is the
last issue of the phase, implementing its "Dry-run verification +
`RELEASING.md` + wrap-up" scope bullet. Depends on issues 001-004 all
having landed.

## Dry-run verification (real commands, run in this session)

1. `bun install && bun run build:all` — confirm a clean, full build across
   all 9 publishable packages (mirrors `qa.yml`'s Build step; must already
   be passing from each prior issue's own local QA pass, this is a final
   confirmation after all four land together).
2. Run `bun run scripts/publish.ts --dry-run` for real, against all 9
   packages. Per the BRIEF's correction (publish command is `npm publish`,
   not `bun publish`), this actually **runs to completion successfully**
   in this session — `npm publish --dry-run` does not require a logged-in
   session (verified by hand: it prints `npm warn This command requires
   you to be logged in ... (dry-run)` as a non-fatal warning and still
   exits 0 with full tarball-contents output). This means the dry run is
   real, complete verification, not a truncated one blocked by auth.
   Confirm from the log output/exit code:
   - The script attempts packages in the documented order (root first,
     then the two dependency tiers).
   - Every one of the 9 packages' `npm publish --dry-run` output shows the
     correct tarball contents: `dist/` (built files), `README.md` (the
     package's own, from issue 004), `LICENSE` (from issue 001), and a
     `package.json` whose dependency lines show real `^0.1.0` ranges, not
     `workspace:*`/`file:../..`.
   - The script's own exit code is `0` (all 9 succeeded).
   - After the script exits, run `git status` and `git diff`. **Must show
     zero modified files.** If any `packages/*/package.json` is left
     modified, issue 002's restore-on-failure logic has a bug — go fix it
     in a follow-up commit to issue 002's script before proceeding (don't
     paper over it here).
3. As an independent cross-check of the rewrite logic (not strictly
   required now that step 2 above gives real, complete `npm publish
   --dry-run` output, but cheap and worth doing): spot-check 2-3 packages'
   dry-run output by eye — root `typetrack` (no rewrite needed), one
   single-dependency-tier package (`packages/react`), and one with both a
   rewritten `workspace:*` and `file:../..` dep (`packages/next`) — and
   confirm the `^0.1.0` values are correct for each.
4. Document this verification (the commands run and their actual output,
   abbreviated) inside `RELEASING.md` itself (see below) as evidence, the
   same way Phase 20's `CONTRIBUTING.md` documented its own CI
   investigation with real commands/output rather than just asserting
   conclusions.

## `RELEASING.md`

New file, repo root. Audience: a future human maintainer (possibly you,
possibly someone else) doing the actual first publish. Contents:

1. **Why this is manual**: brief pointer to BRIEF's "Does this phase
   execute a real npm publish?" reasoning — hard-to-reverse action,
   npm's 72-hour-only unpublish window, no credentials available in the
   automated session that built this pipeline.
2. **One-time setup checklist** (each a real, concrete step, not vague):
   - Create the `typetrack` npm org (or decide to publish `@typetrack/*`
     under a personal npm account that owns that scope) at
     npmjs.com/org/create.
   - Generate an npm **automation** token (not a publish token tied to
     2FA-per-publish, which won't work non-interactively in CI) scoped to
     that org/account, at npmjs.com (Access Tokens settings).
   - Add it as a GitHub Actions repository secret named `NPM_TOKEN`
     (`Settings → Secrets and variables → Actions` on
     `github.com/DevKovan/typetrack` — needs repo admin).
3. **First release steps**:
   - Trigger `release.yml` via the GitHub Actions UI ("Run workflow"),
     first with `dry_run: true` (the default) to confirm the real CI
     environment behaves the same as this phase's local dry-run
     verification.
   - Once satisfied, trigger again with `dry_run: false` for the real
     first publish of all 9 packages at `0.1.0`.
4. **Post-first-publish follow-up** (not required, but recommended, and
   explicitly *not* done by this phase — see BRIEF Design decisions 3-4):
   - Configure npm Trusted Publishing (OIDC) per package on npmjs.com
     (Settings → Trusted Publisher on each of the 9 package pages,
     pointing at this repo + `release.yml` + the `main` branch/whatever
     environment is used) — once configured, `NPM_TOKEN` is no longer
     needed for that package's future releases and can eventually be
     removed as a secret once all 9 packages have it configured.
   - Add a bundle-size shields.io badge to root `README.md` now that the
     package is live on the registry (deferred from issue 004 — see its
     BRIEF Design decision 4 reasoning).
5. **Future releases** (after the first): bump versions via issue 001's
   same manual-lockstep pattern (no tooling to run, just edit the 9
   `version` fields + add a `plan/CHANGELOG.md` entry), then re-trigger
   `release.yml` with `dry_run: false`.

Cross-link `RELEASING.md` from root `README.md`'s existing "Building from
source" area (same pattern Phase 20 used to cross-link `CONTRIBUTING.md`).
If issue 004 already added a `RELEASING.md` reference in the "Status"
section, make sure the two references aren't redundant/contradictory —
read the current README state before editing.

## `plan/CHANGELOG.md`

Add a Phase 21 entry following the existing format (see prior phases'
entries for the expected shape/level of detail) — cover: the 9-package
`0.1.0` version bump, the `file:../..` publish-fix script, `release.yml`,
the 8 new package READMEs, root README SEO pass, and the explicit
"real publish deferred to `RELEASING.md`'s manual follow-up" note (so a
future reader of the changelog doesn't assume the package is live on npm
just because this phase's entry exists).

## Final verification

Run the full `.github/workflows/qa.yml` step sequence locally one more
time, end to end (build:all, size, e2e, lint, typecheck, typecheck:svelte,
test, knip) — this is the last issue of the phase, confirm nothing across
all 5 issues' combined diff broke anything qa.yml checks. Confirm `git
status` is clean (no stray rewritten `package.json` files, no leftover
`.tgz` files from local `npm pack`/`bun publish --dry-run` runs — add a
`.gitignore` entry for `*.tgz` if any got created during this issue's
verification steps and aren't already ignored).
