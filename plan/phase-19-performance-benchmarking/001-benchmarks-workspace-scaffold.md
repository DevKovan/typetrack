# Issue 001: `benchmarks/` workspace scaffold + local stub ingestion server

## Context

Read `plan/phase-19-performance-benchmarking/BRIEF.md` in full first,
especially Design decisions 2-4. Read `e2e/package.json`,
`e2e/playwright.config.ts`, `e2e/server.ts`, and `e2e/README.md` — this
issue creates the same shape of workspace for `benchmarks/`, one level up
from a single Playwright suite (this workspace holds both a `mitata`
suite and a Playwright suite). Read root `package.json` (`"workspaces"`),
`tsconfig.json` (`"include"`), `knip.json` (the `"e2e"` workspace entry),
and `.oxlintrc.json`.

## Scope

Create the `benchmarks/` directory as a new workspace member, with:

1. `benchmarks/package.json` — `"private": true`, `"type": "module"`.
   `devDependencies`: `mitata` (latest stable — check current npm version at
   implementation time, do not assume), `posthog-js` (pin `1.414.0`, the
   version this phase's BRIEF cited numbers against — see BRIEF's Research
   grounding table), `@segment/analytics-next` (pin `1.84.1`),
   `@rudderstack/analytics-js` (pin `3.31.6`), `@playwright/test` (match
   `e2e/package.json`'s pinned version exactly, so Playwright's browser
   binary cache is shared and not double-downloaded). `dependencies`:
   `typetrack` (`"file:.."`, same pattern as `e2e/package.json`). Scripts:
   `"bench": "mitata run"` placeholder (issue 002 adds the real suite file
   this points at — coordinate the exact script name/path with issue 002 at
   implementation time so it stays consistent), `"bench:browser":
   "playwright test"` (issues 004-005 add the specs), `"test":
   "bun test"` (unit tests for this issue's own stub-server code).
2. `benchmarks/README.md` — one paragraph explaining what this workspace is
   (measurement tooling, not a published package, not a usage example —
   cite BRIEF Design decision 2), how to run `bun run bench` and `bun run
   bench:browser`, and a pointer to `docs/performance.md`/`docs/
   comparison.md` as the human-readable output of what this workspace
   produces.
3. `benchmarks/stub-server.ts` — a small `Bun.serve()` HTTP server (mirror
   `e2e/server.ts`'s structure/style) that:
   - Responds `200` with an empty/minimal JSON body to **any** path and
     method within a few milliseconds, no processing — this is the
     "ingestion endpoint" every vendor SDK fixture (issue 004) points at
     instead of the vendor's real API host, per BRIEF Design decision 4.
   - Also serves each vendor SDK's real, already-installed browser bundle
     file (from this workspace's own `node_modules/`) as a static file
     response, so fixture HTML pages (issue 004) can `<script src="...">`
     load the real installed package without a live CDN fetch — resolve the
     exact `node_modules/<pkg>/dist/...` browser-bundle path for each of
     the three vendor packages by hand at implementation time (check each
     package's own `package.json` `"unpkg"`/`"browser"`/`"main"` field,
     the same fields `e2e/server.ts` already reads for typetrack's own
     `dist/index.global.js`) and expose them at stable, documented routes
     (e.g. `/vendor/posthog-js.js`, `/vendor/segment-analytics-next.js`,
     `/vendor/rudderstack-analytics-js.js`).
   - Exports a `startStubServer()`/`stopStubServer()` pair (or equivalent),
     not a bare top-level `Bun.serve()` call, so both the `mitata` suite (if
     it ever needs it) and the Playwright config (issues 004-005, via
     `webServer.command` exactly like `e2e/playwright.config.ts` already
     does) can start/stop it deterministically.
4. `benchmarks/stub-server.test.ts` — unit tests (`bun:test`) asserting: any
   path/method hits the stub and returns 200 fast; each vendor static-file
   route resolves to a real, non-empty file (i.e. this issue's path
   resolution against `node_modules` is actually correct, not a guess) and
   returns the right `Content-Type`.
5. Root `package.json` `"workspaces"`: add `"benchmarks"` (alphabetize
   consistently with the existing list's style — it currently lists `"e2e"`
   first, so add `"benchmarks"` before it or immediately after, whichever
   reads more naturally; just be consistent).
6. Root `tsconfig.json` `"include"`: add `"benchmarks"`.
7. `knip.json`: add a `"benchmarks"` workspace entry mirroring the existing
   `"e2e"` entry's shape (explicit `entry` for `stub-server.ts` since
   nothing statically imports it the same way `e2e/server.ts` needed one;
   `ignoreDependencies: ["typetrack"]` for the same reason `e2e` has it —
   the vendor SDK devDependencies are loaded by fixture HTML `<script>` tags
   in issue 004, not real TS imports, so pre-empt the same false-positive
   class of finding Knip already has a documented workaround for elsewhere
   in this file; read the existing comments in `knip.json` before adding
   yours, match that comment style).
8. `.oxlintrc.json`: confirm `benchmarks/` is covered by whatever glob
   already covers `e2e/` (it likely is, since `.oxlintrc.json` has no
   `e2e`-specific include list today — verify by running `bun run lint`
   after scaffolding and fixing forward if it isn't picked up).

## Explicitly not in this issue

- The `mitata` suite itself (issue 002).
- The bundle-size/tree-shaking comparison (issue 003).
- Any Playwright spec or fixture HTML page (issues 004-005) — this issue
  only stands up the server they'll point at.
- Any `docs/` change (issue 006).

## Acceptance criteria

- `bun install` at repo root succeeds with `benchmarks` in the workspace
  list, and installs the three real vendor SDK packages plus `mitata` and
  `@playwright/test` into `benchmarks/node_modules`.
- `cd benchmarks && bun test` passes (the stub-server unit tests from this
  issue).
- `bun run lint`, `bun run typecheck` (or `typecheck:tsc`), and `bunx knip`
  all pass repo-wide with `benchmarks/` included, with zero suppressions
  beyond the two documented, precedented ones above (`ignoreDependencies`,
  the `entry` array).
- `bun run build:all` is unaffected (this issue adds no build step for
  `benchmarks/` — it's a script-only workspace, no `tsup` config, no
  `dist/`).
