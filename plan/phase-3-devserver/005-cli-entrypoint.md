# 005 — CLI entrypoint (`npx typetrack dev`)

## Context

Depends on 001 (port-file helpers), 002/003 (the composed dev server), and
004 (config loading/hot reload) — this issue wires them together behind
`npx typetrack dev` and owns process lifecycle, argument parsing, and
`package.json`/build wiring. `src/cli/` is the target directory (currently
a scaffold with only `.gitkeep`).

**Hard Bun requirement:** `typetrack dev` requires the Bun runtime to be
installed and on `PATH` — this is not a soft preference but a hard
dependency, since 002/003 are built directly on `Bun.serve()`'s
`ReadableStream`-based SSE support. The entrypoint must detect
`typeof Bun === "undefined"` at the very top, before touching any
Bun-only API, and exit(1) with a short, clear message rather than a raw
runtime error — this is a real DX/adoption tradeoff for a published npm
package (a project without Bun installed cannot use `typetrack dev` at
all) and is called out here for visibility.

## Acceptance criteria

- Root `package.json` gains a `"bin": { "typetrack": <path> }` entry
  pointing at a new tsup-built CLI output (a new tsup entry point, e.g.
  `src/cli/index.ts`, alongside the existing `src/index.ts` entry),
  emitted ESM-only (no CJS build needed for the CLI) with a
  `#!/usr/bin/env bun` shebang banner.
- `knip.json`'s entry list is updated so the new CLI entry point isn't
  flagged as unused.
- `typetrack dev [--config <path>] [--port <n>] [--buffer-size <n>]`:
  - Resolves the config (004) using `--config` if given.
  - Starts the dev server (002/003) with the resolved schemas and any
    `--port`/`--buffer-size` overrides.
  - On success, writes `.typetrack/port` (001) and prints a one-line
    "ready" message including the bound URL.
  - Registers `SIGINT`/`SIGTERM` handlers that stop the dev server and
    delete `.typetrack/port` before the process exits — a genuinely
    killed process (`SIGKILL`) cannot be helped and is an accepted,
    documented limitation, not a bug to fix here.
- Before binding, if `.typetrack/port` already exists **and** a health
  check against it succeeds (i.e. another `typetrack dev` is genuinely
  still running), the CLI prints a clear "already running on port N"
  message and exits(1) rather than silently starting a second instance on
  a different port and overwriting the first instance's port file out
  from under it. If the file exists but the health check fails (a stale
  file from a crashed process), the CLI proceeds normally and overwrites
  it.
- Invalid CLI arguments (e.g. non-numeric `--port`) produce a clear
  usage/error message and exit(1), rather than an unhandled exception.

## Test requirements

**Unit**
- Argument parsing: flags map to the correct options object; defaults
  apply when a flag is omitted; an invalid `--port` value is rejected
  with a clear error rather than propagating `NaN` silently.
- "Stale vs. live port file" decision, as an isolated function taking a
  candidate port and a health-check function dependency: returns "live"
  when the health check resolves and "stale" when it fails/times out,
  testable with a fake health-checker (no real process spawning needed).

**Integration**
- Build the CLI (or run it directly via Bun against the source, whichever
  the repo's test setup supports) and spawn it as a real child process
  invoking `dev` in a temp working directory with a fixture config; poll
  until `.typetrack/port` appears on disk, `fetch()` its `/health`, then
  send the process `SIGINT` and assert it exits and `.typetrack/port` is
  removed.
- Spawn one `dev` instance, then attempt to spawn a second instance
  against the same working directory, and assert the second exits(1)
  with the "already running" message instead of binding a second server
  or clobbering the first instance's port file.
- Assert that running the CLI in an environment where `Bun` is undefined
  (simulate however the implementor's test harness allows, e.g. stubbing
  the global) produces the clear "requires Bun" message rather than a
  raw runtime error.

## Out of scope

- Any subcommand other than `dev` (no `init`, `build`, etc.).
- Guaranteed Windows signal-handling behavior — best-effort only; do not
  block this issue on Windows-specific `SIGINT` semantics if the repo's
  CI doesn't run on Windows (verify against existing CI config).
- Watching/reloading anything other than the resolved config file (no
  general source/asset hot reload).
