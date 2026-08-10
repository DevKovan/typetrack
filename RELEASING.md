# Releasing typetrack

This repo has never been published to npm. `release.yml` (the publish
workflow) and `scripts/publish.ts` (the publish script it runs) are built
and dry-run verified, but the actual first publish is a manual, deliberate
human action, not something any automated session executes on its own.

## Why this is manual

A real `npm publish` is a genuinely hard-to-reverse action — npm only
allows unpublishing within 72 hours, with further restrictions once a
package has real dependents. It also isn't *possible* from an automated
coding-assistant session regardless: no npm login exists in that kind of
environment, no `NPM_TOKEN` GitHub Actions secret exists on this repo yet,
and the credentials available to such a session for this repo are
read-only (no permission to create one). See
`plan/phase-21-npm-publish-seo/BRIEF.md` ("Does this phase execute a real
npm publish?") for the full reasoning.

## Dry-run verification already done (2026-08-11)

Real commands, run against this repo's actual `main` branch state, not
simulated:

```sh
bun install
bun run build:all
bun run scripts/publish.ts --dry-run
```

All 9 publishable packages (`typetrack`, `@typetrack/{react,vue,svelte,
solid,astro,next,remix,nuxt}`) completed a full `npm publish --dry-run
--access public --provenance` run successfully (`npm publish --dry-run`
needs no registry login — it prints a non-fatal `npm warn ... requires you
to be logged in ... (dry-run)` and still completes). Confirmed from the
real output:

- Every package's tarball contains its own `LICENSE`, its own `README.md`,
  and a built `dist/` — none of these existed before this phase.
- `scripts/publish.ts`'s dependency rewrite is correct: `@typetrack/next`'s
  packed `package.json` (spot-checked directly, not just eyeballed in the
  npm notice output) shows `"@typetrack/react": "^0.1.0"` and `"typetrack":
  "^0.1.0"` — both real semver, not the repo's local-dev `workspace:*`/
  `file:../..` values.
- `git status`/`git diff` are clean immediately after the script exits —
  the rewrite-then-restore round-trip leaves no modified files behind.
- All 9 packages reported `OK`; the script's own summary line read `9/9
  packages dry-run published successfully.`

This is real, complete verification (not blocked by missing auth, unlike
`bun publish --dry-run`, which does require a login) — the only thing not
exercised is an actual registry write.

## One-time setup checklist (before the first real publish)

1. Create the `typetrack` npm org (or decide to publish `@typetrack/*`
   under a personal npm account that owns that scope) at
   [npmjs.com/org/create](https://www.npmjs.com/org/create).
2. Generate an npm **automation** token (not a publish token requiring
   interactive 2FA per publish — that won't work non-interactively in CI)
   scoped to that org/account, under npmjs.com Access Tokens settings.
3. Add it as a GitHub Actions repository secret named `NPM_TOKEN`
   (`Settings → Secrets and variables → Actions` on
   [github.com/DevKovan/typetrack](https://github.com/DevKovan/typetrack)
   — needs repo admin).

## First release steps

1. Trigger `release.yml` via the GitHub Actions UI ("Run workflow"), first
   with `dry_run: true` (the default) — confirms the real CI environment
   behaves the same as the local dry-run verification above.
2. Once satisfied, trigger again with `dry_run: false` for the real first
   publish of all 9 packages at `0.1.0`.

## Post-first-publish follow-up (recommended, not required)

- **Configure npm Trusted Publishing (OIDC) per package** on npmjs.com
  (Settings → Trusted Publisher on each of the 9 package pages, pointing
  at this repo + `release.yml` + the branch/environment used). This can
  only be configured *after* a package's first version already exists on
  the registry — it cannot bootstrap a brand-new package, which is why
  this phase couldn't set it up from the start. Once configured per
  package, `NPM_TOKEN` is no longer needed for that package's future
  releases.
- **Add a bundle-size shields.io badge** to root `README.md` — deferred
  from Phase 21's SEO pass because the badge's endpoint needs the package
  live on the registry to compute against.

## Future releases (after the first)

1. Bump versions: edit all 9 `package.json` `version` fields together
   (lockstep, matching this phase's approach — no Changesets, see
   `plan/phase-21-npm-publish-seo/BRIEF.md`'s versioning-strategy section
   for why), add a `plan/CHANGELOG.md` entry.
2. Re-trigger `release.yml` with `dry_run: false`.
