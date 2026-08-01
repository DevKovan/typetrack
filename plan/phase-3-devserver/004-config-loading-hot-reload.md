# 004 — Config file loading + chokidar hot reload

## Context

Depends on 002's `setSchemas()` hook. Introduces the `typetrack.config.*`
file convention that lets a running `typetrack dev` process discover the
app's Zod schemas, and hot-reloads them on file change via `chokidar`
without restarting the server or losing its bound port.

**chokidar version note:** current major is **v5** (ESM-only, no CJS —
compatible since this repo is `"type": "module"` throughout); v4 removed
glob-pattern support entirely, which is irrelevant here since this issue
only ever watches one exact, resolved file path, never a glob. Basic API
is unchanged: `chokidar.watch(path).on('change', fn)`.

**Dependency placement:** `chokidar` must be added to the root
`package.json`'s `dependencies` (a new section — first real, non-peer
runtime dependency in this package), **not** `devDependencies`. It's a
runtime dependency of the shipped `typetrack dev` CLI feature that a
downstream consumer executes, not part of this repo's own build/lint/test
toolchain (the devDependency-only list in CLAUDE.md refers to the latter).
This is analogous to how `zod` is already a (peer) runtime dependency for
schema validation, not a toolchain tool.

**Config convention:** search, in order, `typetrack.config.ts`,
`typetrack.config.mts`, `typetrack.config.js`, `typetrack.config.mjs` in
the cwd `typetrack dev` is invoked from; first match wins. A `--config
<path>` CLI flag (wired in 005) overrides the search entirely and is
passed through to this issue's loader as an explicit path. The resolved
module's **default export** must be an object shaped
`{ schemas: Record<string, z.ZodType> }` — the same shape already accepted
by `createAnalytics({ schemas })`, so a user can share one object between
their app code and this config file rather than declaring schemas twice.
Loaded via dynamic `import()` — Bun executes `.ts` natively, no bundler/
transpile step is needed for this loader.

## Acceptance criteria

- A loader function resolves the config path per the search order above
  (or accepts an explicit override path), dynamically imports it, and
  validates (at minimum) that its default export has a `schemas` object —
  a config module missing this, or throwing during import/evaluation,
  produces a clear, path-inclusive error (not a bare stack trace) rather
  than crashing the whole process.
- Root `package.json` gains a `dependencies` section containing `chokidar`
  pinned to its current major (v5.x).
- On startup, the resolved config path is watched via `chokidar`. On its
  `change` event, the loader re-imports it using a cache-busting strategy
  (e.g. a query-string suffix) since a bare `import()` of an
  already-imported specifier is served from the module cache and won't
  observe on-disk changes.
- A successful reload calls `setSchemas()` with the newly loaded schemas
  and prints a one-line "config reloaded" message; the server's port and
  running instance are untouched (no restart).
- A reload that throws (syntax error, an exception thrown at module
  evaluation time) prints a clear, path-inclusive error and **keeps the
  previously-loaded schemas active** — a broken edit must not crash the
  dev server or drop back to "no schemas loaded".

## Test requirements

**Unit**
- Config-path resolution: given a fixture directory listing (or a real
  temp dir with only some of the candidate filenames present), the
  correct precedence order is honored; an explicit override path always
  wins regardless of what's present in the search directory.
- Cache-busting reload: write a real temp `.mjs` fixture file, load it,
  change its contents on disk, reload via the loader function directly
  (without chokidar/server wiring), and assert the second load reflects
  the new contents — proving the cache-bust actually defeats the module
  cache (this is a small, isolated test of just the loader, not the full
  watch pipeline).

**Integration**
- Using real temp-directory fixtures: start a `startDevServer()`, load an
  initial `typetrack.config.ts` fixture, `POST` an event that's valid
  under the initial schema and confirm it's marked valid via `GET /events`.
  Edit the fixture file on disk to tighten the schema (e.g. add a required
  field), wait for chokidar's `change` event and the resulting reload,
  `POST` the same old payload again, and confirm it's now marked invalid
  — proving the live schema was hot-swapped without restarting the
  server. Assert the server's `port` is identical before and after.
- A corrupt-config test: after a successful initial load, overwrite the
  fixture with syntactically invalid content, trigger a reload, and
  assert (a) the server keeps responding on `/health`, (b) an event still
  validates against the last-known-good schema, and (c) a clear error was
  printed referencing the config file path.

## Out of scope

- Watching multiple config files or splitting schemas across files/globs.
- Config formats other than a JS/TS default export (no YAML/JSON config).
- Deep-validating the config module's own shape with Zod — a malformed
  config surfaces as a plain thrown/caught JS error, per above.
- CLI argument parsing itself, including the `--config` flag's parsing
  (005 owns argument parsing; this issue only accepts an already-resolved
  override path as a function parameter).
