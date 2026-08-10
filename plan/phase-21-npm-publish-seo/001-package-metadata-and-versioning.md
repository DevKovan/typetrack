# 001 — Package metadata + version bump

## Context

Read `plan/phase-21-npm-publish-seo/BRIEF.md` in full first — this issue
implements its "Versioning strategy" and part of its "Scope" sections. Do
not re-derive those decisions; apply them.

9 packages get touched: root `typetrack` + `packages/{react,next,vue,nuxt,
svelte,solid,astro,remix}`. The 4 `provider-*`/`provider-contract-kit`
packages are **not** touched (standing `"private": true`, not published —
see BRIEF's "Publishable package set").

## Changes, per package.json

For all 9:
1. `"version": "0.0.0"` → `"version": "0.1.0"`.
2. Add/confirm a `"keywords"` array — specific, real terms a user would
   actually search, not stuffed. Root `typetrack` example shape (adapt,
   don't copy verbatim): `["analytics", "typescript", "tracking",
   "telemetry", "events", "provider-agnostic", "type-safe"]`. Each
   framework package's keywords should include its framework name (e.g.
   `packages/react`: add `"react"`; `packages/svelte`: add `"svelte"`,
   `"svelte5"`) plus a shared core subset (`"analytics"`, `"typescript"`,
   `"typetrack"`).
3. Confirm `"description"` is one sentence, roughly ≤140 characters
   (npm's own convention — see BRIEF research grounding). Every
   `packages/*` description already reads as one sentence today; check
   actual character counts and trim only if over, don't rewrite
   descriptions that are already fine.
4. Add `"repository"`, `"homepage"`, `"bugs"` fields pointing at
   `https://github.com/DevKovan/typetrack`. For root `typetrack`:
   ```json
   "repository": { "type": "git", "url": "git+https://github.com/DevKovan/typetrack.git" },
   "homepage": "https://github.com/DevKovan/typetrack#readme",
   "bugs": { "url": "https://github.com/DevKovan/typetrack/issues" }
   ```
   For each `packages/*` sub-package, same `repository`/`bugs`, plus a
   `"directory"` key inside `repository` (npm/GitHub convention for
   monorepo sub-packages, so npm's UI links to the right subdirectory):
   ```json
   "repository": { "type": "git", "url": "git+https://github.com/DevKovan/typetrack.git", "directory": "packages/react" },
   "homepage": "https://github.com/DevKovan/typetrack/tree/main/packages/react#readme",
   "bugs": { "url": "https://github.com/DevKovan/typetrack/issues" }
   ```
   (substitute the correct `packages/<name>` directory per package).

For the 8 scoped `@typetrack/*` packages only (not root `typetrack`, which
is unscoped and public by default):
5. Add `"publishConfig": { "access": "public" }`. Without this, npm
   defaults new scoped packages to `restricted` and the first `bun
   publish` of each would fail or attempt a private publish — see BRIEF
   research grounding.

Do not touch `"dependencies"`, `"devDependencies"`, `"peerDependencies"`,
`"exports"`, `"main"`/`"module"`/`"types"`, `"files"`, or `"scripts"` in
this issue — those are correct as-is and out of scope here. Do not touch
the `"typetrack": "file:../.."` dependency lines — issue 002 handles that
at publish time only, not as a repo-committed change.

## LICENSE files

No `LICENSE` file exists anywhere in the repo despite every
`package.json`'s `"license": "MIT"` field (confirmed via `npm pack
--dry-run` in BRIEF's research — the LICENSE never made it into a tarball
because it was never in the tree). Add:

1. A root `LICENSE` file — standard MIT license text, copyright line
   `Copyright (c) 2026 DevKovan` (match `git log` author identity /
   `package.json` author info if one exists; if no explicit author/org
   name is findable, use `DevKovan`, matching the GitHub org/repo owner).
2. A byte-identical copy of that same `LICENSE` file into each of the 8
   `packages/*` directories (`packages/react/LICENSE`,
   `packages/next/LICENSE`, etc.) — physical copies, not symlinks (simpler,
   no build-step dependency, low drift risk for a license file that
   rarely changes; see BRIEF Design decisions). npm auto-includes a
   `LICENSE` file in a package's tarball if one exists next to that
   package's own `package.json`, regardless of the `"files"` array.

Do not add `LICENSE` files to the 4 private, unpublished `provider-*`/
`provider-contract-kit` packages — not needed, they never ship a tarball.

## Verification

- `bun install` still resolves cleanly (version bumps don't change any
  `workspace:*`/`file:` resolution — those are protocol-based, not
  version-pinned).
- `bun run typecheck`, `bun run lint`, `bun run knip` all still pass —
  none of these changes touch source code.
- Spot-check with `node -e "console.log(require('./package.json'))"` (and
  equivalent for 2-3 of the `packages/*/package.json` files) that JSON is
  well-formed and every added field is present.
- `npm pack --dry-run` (root, and one or two `packages/*` as a spot check)
  now shows `LICENSE` in the tarball contents list, where it didn't
  before.

Run the full `qa.yml` step sequence locally before committing (per
BRIEF's "Process" section).
