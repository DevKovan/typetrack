# 003 — `release.yml` GitHub Actions workflow

## Context

Read `plan/phase-21-npm-publish-seo/BRIEF.md` in full first — this issue
implements its "`release.yml`" scope bullet and Design decisions 1-3, 5.
Depends on issue 002's `scripts/publish.ts` existing. Read
`.github/workflows/qa.yml` in full before writing this file — mirror its
`bun install`/`build:all` steps exactly (same commands, same order), don't
invent a different build sequence.

## `.github/workflows/release.yml`

New file. Key properties (all locked decisions from BRIEF — do not deviate
without re-reading the BRIEF's reasoning):

- **Trigger**: `workflow_dispatch` only. No `push`/`tag` trigger — a human
  explicitly runs this on purpose, every time, real or dry-run.
- **Input**: `dry_run`, type `boolean`, `default: true`. This means the
  default invocation of this workflow (if someone clicks "Run workflow"
  without changing the input) is always a dry run — real publishes require
  an explicit opt-out, not an explicit opt-in. Get this default direction
  right, it's a deliberate safety property, not an arbitrary choice.
- **Permissions**: `contents: read`, `id-token: write` (the latter is
  required for `--provenance`'s Sigstore/OIDC signing step inside `bun
  publish`, per BRIEF research — without it the publish step will fail at
  the provenance-signing stage even with a valid `NPM_TOKEN`).
- **Job steps**, in order:
  1. `actions/checkout@v4`
  2. `oven-sh/setup-bun@v2` with `bun-version: latest` (matches `qa.yml`).
  3. `actions/setup-node@v4` with `node-version: '24'` and
     `registry-url: 'https://registry.npmjs.org/'` — required so the npm
     auth environment (`NODE_AUTH_TOKEN`) is wired up correctly even
     though the actual publish command is `bun publish`, not `npm
     publish` (Bun reads the same `NODE_AUTH_TOKEN` env var / generated
     `.npmrc` that `setup-node` produces).
  4. `bun install` (matches `qa.yml`).
  5. `bun run build:all` (matches `qa.yml`'s Build step exactly — same
     command, no divergence; every publishable package's `dist/` must
     exist and be current before anything downstream packs it).
  6. Run the publish script:
     ```yaml
     - name: Publish
       env:
         NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
       run: bun run scripts/publish.ts ${{ inputs.dry_run == true && '--dry-run' || '' }}
     ```
     (adjust the exact GitHub Actions expression syntax as needed to
     correctly convert the boolean input into a conditional `--dry-run`
     flag — verify the expression is valid YAML/Actions syntax, e.g. via
     `actionlint` if available locally, or careful manual review of
     GitHub's expression-syntax docs, since a malformed expression here
     would silently pass the flag wrong).
- Does not remove, rename, or modify anything in `.github/workflows/
  qa.yml` (BRIEF Design decision 5 — additive only, no shared
  `workflow_call` composition for a two-workflow repo).

## What this issue does *not* do

- Does not create the `NPM_TOKEN` secret (needs repo admin this session
  doesn't have — issue 005's `RELEASING.md` documents this as a human
  step).
- Does not trigger the workflow (`workflow_dispatch` requires either the
  GitHub UI or `gh workflow run`, and this session's `gh` auth is
  read-only per Phase 20's finding — even the dry-run mode can't actually
  be exercised as a real Actions run from this session; local
  verification happens via issue 002's script run directly, and issue
  005's local dry-run pass, not via triggering this workflow file itself).

## Verification

- The YAML is well-formed: `bun x js-yaml .github/workflows/release.yml`
  or equivalent parse check (no `js-yaml` dependency exists in this repo
  — use `node -e "require('node:fs'); ..."` with a minimal YAML parse, or
  simply eyeball it carefully against `qa.yml`'s existing structure/
  indentation conventions and cross-check with `actionlint` if it's
  available on the system `PATH`; if neither tool is available, a careful
  manual structural review against `qa.yml`'s known-working syntax is the
  fallback — do not skip verification, use whatever tool is actually
  present).
- Confirm the file lives at exactly `.github/workflows/release.yml`
  (sibling to `qa.yml`, same directory).

Run the full `qa.yml` step sequence locally before committing (this issue
doesn't touch anything `qa.yml` itself checks, but the standing process
requires it every commit regardless).
