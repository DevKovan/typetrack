# 002 — Publish-time `file:` dependency rewrite script

## Context

Read `plan/phase-21-npm-publish-seo/BRIEF.md` in full first — this issue
implements its "The `file:../..` publish problem and its fix" section. Do
not re-derive that decision; apply it. Depends on issue 001 having already
landed (needs the `0.1.0` version bump and `publishConfig.access: public`
in place).

## The problem, concretely

`packages/{react,vue,svelte,solid,astro}/package.json` each have:
```json
"dependencies": { "typetrack": "file:../.." }
```
`packages/{next,remix}/package.json` have both:
```json
"dependencies": { "@typetrack/react": "workspace:*", "typetrack": "file:../.." }
```
`packages/nuxt/package.json` has:
```json
"dependencies": { "@typetrack/vue": "workspace:*", "typetrack": "file:../.." }
```
`bun publish` correctly resolves `workspace:*` to the sibling's real
version at pack time (verified in BRIEF research) — no action needed for
those lines. It does **not** touch `file:../..` — publishing any of these
8 packages as-is embeds a literal `"file:../.."` in the tarball's
`package.json`, which is unresolvable and breaks installation for every
external consumer.

## Build `scripts/publish.ts`

New file, root `scripts/publish.ts` (new `scripts/` directory — doesn't
exist yet). Run via `bun run scripts/publish.ts [--dry-run]`. Behavior:

1. Accept a `--dry-run` flag (boolean, default `false` when run directly;
   `release.yml` in issue 003 always passes it explicitly from its own
   input). When true, pass `--dry-run` through to every `bun publish`
   invocation.
2. Define the publish order as a literal list (matches BRIEF's locked
   order): `["", "packages/react", "packages/vue", "packages/svelte",
   "packages/solid", "packages/astro", "packages/next", "packages/remix",
   "packages/nuxt"]` (`""` = repo root, i.e. the `typetrack` package
   itself).
3. For each package directory in order:
   - Read that directory's `package.json`.
   - If it has a `"typetrack": "file:../.."` dependency (root won't; the
     other 8 will), rewrite that one field in memory to `"typetrack":
     "^0.1.0"` (read the *actual* current version off root
     `package.json` at run time — do not hardcode `0.1.0` a second time;
     if root's version ever changes, this script must not silently pack a
     stale range) and write the file back out (pretty-printed, matching
     the repo's existing 2-space JSON style).
   - Run `bun publish --access public --provenance` (plus `--dry-run` if
     set) with `cwd` set to that package directory.
   - **Always** restore the original `package.json` content afterward
     (the literal pre-rewrite bytes, not a re-derived version) — wrap the
     publish call so restoration happens even if `bun publish` exits
     non-zero, so a failed publish never leaves a rewritten file behind
     uncommitted. Simplest correct approach: read the original file
     content into memory before rewriting, write it back verbatim in a
     `finally`-equivalent block after the `bun publish` subprocess
     resolves or rejects.
   - Root `typetrack` itself has no `file:` dependency to rewrite and is
     not a scoped package (no `--access public` needed for it, but
     passing it is harmless — `--access` is a no-op for unscoped
     packages, confirm this rather than special-casing the flag away).
4. Log each package's name + version + dry-run-or-real status to stdout as
   it publishes, and a final one-line summary (9/9 succeeded, or which
   ones failed) — this becomes the visible output in `release.yml`'s job
   log.
5. Exit non-zero if any package's publish step fails, after all
   restoration has happened (don't leave later packages unpublished
   silently — but also don't let one failure corrupt the working tree for
   packages already processed).

Keep this script dependency-free (no new npm packages) — it only needs
`node:fs`/`node:path` and Bun's `Bun.spawn` (or `node:child_process`) to
shell out to `bun publish`, both already available in this Bun-first repo.

## Verification

- Run `bun run scripts/publish.ts --dry-run` for real, against all 9
  packages, in this session. It will fail at the actual `bun publish
  --dry-run` subprocess step with an auth error (no npm login in this
  environment — expected and fine, matches BRIEF's documented limitation).
  What must be verified regardless: **the rewrite-then-restore round-trip
  works correctly even when the underlying `bun publish` call itself
  fails** — after the script exits (non-zero, expected), run `git status`
  and `git diff` and confirm **zero** modified files. If any
  `packages/*/package.json` shows a diff after the script exits, the
  finally/restoration logic is broken — fix it before moving on, this is
  the core correctness property of this issue.
- Add a lightweight assertion of this to the script itself if practical
  (e.g. a try/finally around the rewrite, not a separate test file — this
  is an operational script, not library code, a full test suite is not
  required, but the restore-on-failure path must be exercised by hand as
  described above, not just eyeballed in the source).
- Confirm `bun run typecheck`/`bun run lint` are happy with the new
  `scripts/publish.ts` file (it's inside the repo's existing `tsconfig`/
  `oxlint` scope by default — check `knip.json` and `tsconfig.json`
  includes/excludes don't need a new entry for `scripts/`; add one only if
  `bun run knip` or `bun run typecheck` actually flags it as unreachable
  or out-of-project).

Run the full `qa.yml` step sequence locally before committing.
