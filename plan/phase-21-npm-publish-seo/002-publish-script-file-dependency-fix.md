# 002 — Publish script: resolve `file:`/`workspace:` deps, publish via npm

**Superseded design — see BRIEF.md's "Correction, found during
implementation" section at the top of the file before reading this issue.**
The original plan (`bun publish` resolves `workspace:*` automatically, only
`file:../..` needs a manual rewrite) turned out to be wrong on both counts:
`bun publish` has no `--provenance` flag, and its `workspace:*` resolution
reads a `bun.lock`-cached version that a plain `bun install` does not
refresh after a workspace member's version changes (verified by hand,
BRIEF has the evidence). This issue's actual scope, corrected: resolve
*both* `file:../..` and `workspace:*` dependency lines to concrete
`^x.y.z` semver ourselves, reading live `package.json` files (never
`bun.lock`), then publish with `npm publish`, not `bun publish`.

## Context

Read `plan/phase-21-npm-publish-seo/BRIEF.md` in full first (including the
correction section). Depends on issue 001 having already landed (needs the
`0.1.0` version bump and `publishConfig.access: public` in place).

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
`npm publish` understands neither `file:` (packs the literal string,
unresolvable for external installers) nor `workspace:*` (same problem —
npm has no concept of this protocol at all, confirmed in BRIEF research).
Both must be rewritten to real semver ranges before `npm publish` ever
runs against these package.json files.

## Build `scripts/publish.ts`

New file, root `scripts/publish.ts` (new `scripts/` directory). Run via
`bun run scripts/publish.ts [--dry-run]`. Behavior:

1. Accept a `--dry-run` flag (boolean, default `false` when run directly;
   `release.yml` in issue 003 always passes it explicitly from its own
   input). When true, pass `--dry-run` through to every `npm publish`
   invocation (npm's own dry-run mode — no registry auth is consumed,
   though npm CLI still validates the auth token is present/well-formed;
   confirm this by hand during verification, see below).
2. Publish order (a literal list; matches the dependency direction so the
   window where a not-yet-published sibling might be referenced is
   minimized — not a strict technical requirement the way the rewrite
   step below is, since every rewrite reads live package.json versions
   regardless of what's actually live on the registry yet):
   `["", "packages/react", "packages/vue", "packages/svelte",
   "packages/solid", "packages/astro", "packages/next", "packages/remix",
   "packages/nuxt"]` (`""` = repo root, the `typetrack` package itself).
3. Build an in-memory version map first, before touching any files: for
   every entry in the order list, read that directory's `package.json`
   and record `{ name, version }` (e.g. `{ "typetrack": "0.1.0",
   "@typetrack/react": "0.1.0", ... }`). This is the single source of
   truth the rewrite step uses — never read a version out of `bun.lock`.
4. For each package directory in order:
   - Read the *raw text* of that directory's `package.json` (not just the
     parsed object — the rewrite must be a targeted string substitution
     that preserves the file's existing formatting byte-for-byte outside
     the changed value, so restoration is trivial and the diff during the
     rewritten window is minimal).
   - For every `"<pkgName>": "file:../.."` or `"<pkgName>":
     "workspace:*"` substring found in that raw text, where `<pkgName>`
     is a key present in the version map built in step 3, replace it with
     `"<pkgName>": "^<version>"` using that package's real recorded
     version. Handle both protocols with the same logic — don't special
     case `typetrack`'s `file:` dep separately from `@typetrack/react`'s
     `workspace:*` dep, they're the same kind of fix.
   - Write the rewritten text back to that package.json.
   - Run `npm publish --access public --provenance` (plus `--dry-run` if
     set) with `cwd` set to that package directory. `--access public` is
     harmless to pass even for the unscoped root `typetrack` package
     (confirm this by hand — npm's own docs note `--access` only affects
     scoped packages, unscoped packages are already public and the flag
     is a no-op for them).
   - **Always** restore the original raw `package.json` text afterward,
     even if `npm publish` exits non-zero — wrap the publish call so
     restoration happens unconditionally (a try/finally around the
     subprocess call, keeping the pre-rewrite string in memory rather
     than re-deriving it).
5. Log each package's name + version + dry-run-or-real status to stdout as
   it publishes, and a final one-line summary (9/9 succeeded, or which
   ones failed) — this becomes the visible output in `release.yml`'s job
   log.
6. Exit non-zero if any package's publish step fails, after all
   restoration has happened for every package already processed (don't
   leave a rewritten file behind just because a later package's publish
   failed).

Keep this script dependency-free (no new npm packages) — `node:fs`/
`node:path` plus `Bun.spawn` (or `node:child_process`) to shell out to
`npm publish`, both already available in this Bun-first repo.

## Verification

- Run `bun run scripts/publish.ts --dry-run` for real, against all 9
  packages, in this session. It is expected to fail at the actual `npm
  publish --dry-run` subprocess step with an auth error (no `npm login`
  in this environment — expected, matches BRIEF's documented limitation).
  What must be verified regardless: **the rewrite-then-restore round-trip
  works correctly even when the underlying `npm publish` call fails**.
  After the script exits (non-zero, expected), run `git status` and `git
  diff` and confirm **zero** modified files. If any `packages/*/
  package.json` shows a diff after the script exits, the restore-on-
  failure logic is broken — fix it before moving on; this is the core
  correctness property of this issue.
- Separately, verify the rewrite logic actually produces correct output
  (independent of whether `npm publish` itself can succeed here): use
  `bun pm pack --dry-run` (no auth needed, confirmed empirically) on 1-2
  packages immediately after the script's rewrite step has run (you may
  need to add a brief debug pause, or test the rewrite function directly
  with a small standalone check) to confirm the packed `package.json`
  would show `"@typetrack/react": "^0.1.0"`/`"typetrack": "^0.1.0"`, not
  `"workspace:*"`/`"file:../.."`/a stale version.
- Confirm `bun run typecheck`/`bun run lint` are happy with the new
  `scripts/publish.ts` file (check `knip.json`/`tsconfig.json` includes —
  add a `scripts/` entry only if either tool actually flags it as
  unreachable or out-of-project).

Run the full `qa.yml` step sequence locally before committing.
