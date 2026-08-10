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
   packages. It is expected to fail at the actual `bun publish --dry-run`
   subprocess call with an npm auth error (`missing authentication` — no
   npm login exists in this environment, documented limitation, not a
   bug to fix). What this run must demonstrate, and what to actually
   check:
   - The script attempts packages in the documented order (root first,
     then the two dependency tiers) — confirm from the log output.
   - After the script exits (non-zero, expected), run `git status` and
     `git diff`. **Must show zero modified files.** If any
     `packages/*/package.json` is left modified, issue 002's
     restore-on-failure logic has a bug — go fix it in a follow-up commit
     to issue 002's script before proceeding (don't paper over it here).
3. Since `bun publish --dry-run` can't get past the auth wall in this
   session, get real tarball-content verification via `npm pack --dry-run`
   instead (no auth needed — confirmed in BRIEF research). Run it for
   real, per package, **after** temporarily performing the same
   `file:../..` → `^0.1.0` rewrite issue 002's script does (you can invoke
   the rewrite portion of `scripts/publish.ts` directly if it's factored
   in a way that allows that, or perform the equivalent rewrite by hand
   for this verification pass only — either way, restore the file
   afterward and confirm `git status` is clean again). For at least 3
   packages (root `typetrack`, one single-dependency-tier package like
   `packages/react`, and one that has both a `workspace:*` and a rewritten
   `typetrack` dep like `packages/next`), confirm via the `npm pack
   --dry-run` output that the tarball contains: `dist/` (built files),
   `README.md` (the package's own, from issue 004), `LICENSE` (from issue
   001), and that `package.json`'s packed `dependencies.typetrack` field
   shows `^0.1.0`, not `file:../..`.
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
