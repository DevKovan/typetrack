# 001 -- shared JSON Schema extraction + `typetrack schema` CLI command

## Context

Read `plan/phase-18-tooling-extras/BRIEF.md`'s Design decisions 2, 6, and 7
first -- this issue implements them.

Today, `src/devServer/server.ts`'s `handleGetSchema()` is the only place
that turns a loaded `Record<string, z.ZodType>` into JSON Schema, and it's
only reachable over HTTP from a running `typetrack dev` process:

```ts
function handleGetSchema(): Response {
  const events: Record<string, unknown> = {};
  if (schemas) {
    for (const [name, schema] of Object.entries(schemas)) {
      events[name] = z.toJSONSchema(schema);
    }
  }
  return jsonResponse({ events }, 200);
}
```

This issue extracts that loop into a standalone, pure, reusable function,
and adds a new `typetrack schema` CLI command that produces the same shape
as a file on disk (or stdout) -- usable in CI or committed to the repo as a
versioned artifact, with no dev server process required.

## Scope of this issue

### 1. `src/devServer/schemaExport.ts` (new file)

```ts
import { z } from "zod";

export interface EventJsonSchemas {
  events: Record<string, unknown>;
}

// Pure: converts a loaded schema map into the same { events: { [name]:
// JSONSchema } } shape `GET /schema` has always returned. `undefined`
// (no config loaded) yields `{ events: {} }`, matching the dev server's
// existing schema-less passthrough behavior.
export function buildEventJsonSchemas(schemas: Record<string, z.ZodType> | undefined): EventJsonSchemas {
  const events: Record<string, unknown> = {};
  if (schemas) {
    for (const [name, schema] of Object.entries(schemas)) {
      events[name] = z.toJSONSchema(schema);
    }
  }
  return { events };
}
```

### 2. `src/devServer/server.ts`: dedup

Replace `handleGetSchema()`'s body with a call to `buildEventJsonSchemas(schemas)`,
importing it from `./schemaExport`. `GET /schema`'s response shape is
unchanged (still `{ events: {...} }`, status 200) -- this is a pure
refactor, not a behavior change. Existing `server.test.ts`/
`server.integration.test.ts` schema-endpoint assertions must keep passing
unmodified.

### 3. `src/devServer/index.ts`: export

Add `export { buildEventJsonSchemas, type EventJsonSchemas } from "./schemaExport";`
alongside the existing re-exports.

### 4. `src/cli/schema.ts` (new file): the command itself

```ts
export interface RunSchemaCommandOptions {
  cwd?: string;
}

export async function runSchemaCommand(argv: string[], options?: RunSchemaCommandOptions): Promise<number>;
```

Behavior, mirroring `runDevCommand`'s (`src/cli/dev.ts`) error-handling
conventions exactly (never throws for a recognized failure mode; returns a
non-zero exit code; prints a `✗ ...` line to `console.error`):

- Flags: `--config <path>` (optional override, same semantics as `dev`'s),
  `--out <path>` (optional; when omitted, writes to stdout instead of a
  file). No `--port`/`--buffer-size` -- this command never starts a server.
- Resolves the config path via `resolveConfigPath(cwd, args.configPath)`
  (`src/devServer/config.ts`, already imported by `dev.ts` the same way).
  If no config is found (`resolveConfigPath` returns `undefined`), print
  `✗ no typetrack config found -- see typetrack.config.ts documentation`
  and return `1` (this command has no meaningful output with zero
  schemas, unlike `dev`'s "run unvalidated" fallback -- there is nothing
  to export).
- Loads it via `loadConfig(configPath)`; a thrown `ConfigLoadError` is
  caught, printed (`✗ ${error.message}`), and returns `1` (same pattern as
  `runDevCommand`'s own `loadConfig` call site).
- Builds `buildEventJsonSchemas(schemas)` and serializes it with
  `JSON.stringify(result, null, 2)`.
- With `--out <path>`: writes the serialized JSON to that path (via
  `Bun.write`), then prints `✓ schema written to ${path}` to stdout, then
  returns `0`.
- Without `--out`: writes the serialized JSON straight to stdout (a single
  `console.log(json)` call, no extra wrapper text -- this must be pipeable,
  e.g. `typetrack schema | jq`), then returns `0`.

### 5. New `src/cli/schemaArgs.ts`: flag parsing

Small, mirrors `src/cli/args.ts`'s `parseDevArgs`/`CliArgError` exactly
(reuse `CliArgError` from `./args`, do not redefine it):

```ts
export interface ParsedSchemaArgs {
  configPath?: string;
  outPath?: string;
}

export function parseSchemaArgs(argv: string[]): ParsedSchemaArgs;
```

Known flags: `--config`, `--out`. Same "unknown flag" / "flag missing its
value" `CliArgError` behavior as `parseDevArgs`.

### 6. `src/cli/index.ts`: generalize dispatch

Today's entire command dispatch is:

```ts
const [, , command, ...rest] = process.argv;

if (command !== "dev") {
  console.error(`✗ Unknown command: "${command ?? ""}"`);
  console.error("Usage: typetrack dev [--config <path>] [--port <n>] [--buffer-size <n>]");
  process.exit(1);
}

const { runDevCommand } = await import("./dev");
const exitCode = await runDevCommand(rest);
process.exit(exitCode);
```

Generalize to a small command table so `schema` (this issue) and `docs`
(issue 002) can register alongside `dev` without a third near-duplicate
`if` block:

```ts
const COMMANDS: Record<string, { usage: string; run: (argv: string[]) => Promise<number> }> = {
  dev: {
    usage: "typetrack dev [--config <path>] [--port <n>] [--buffer-size <n>]",
    run: async (argv) => (await import("./dev")).runDevCommand(argv),
  },
  schema: {
    usage: "typetrack schema [--config <path>] [--out <path>]",
    run: async (argv) => (await import("./schema")).runSchemaCommand(argv),
  },
};

const [, , command, ...rest] = process.argv;
const entry = command ? COMMANDS[command] : undefined;

if (!entry) {
  console.error(`✗ Unknown command: "${command ?? ""}"`);
  console.error(`Usage: typetrack <${Object.keys(COMMANDS).join("|")}> ...`);
  for (const { usage } of Object.values(COMMANDS)) console.error(`  ${usage}`);
  process.exit(1);
}

const exitCode = await entry.run(rest);
process.exit(exitCode);
```

Keep the existing top-of-file Bun-runtime guard (`typeof Bun === "undefined"`)
exactly as-is -- `schema`/`docs` are just as Bun-only as `dev` (both go
through `loadConfig`, which uses `Bun.write`/dynamic `import()` of
`.ts`/`.mts` config files the same way `dev` already does), so there is no
reason to special-case a non-Bun path for the new commands. Exact table
shape/typing is the implementor's call as long as the observable CLI
behavior above holds and `dev`'s existing behavior/usage string is
unchanged.

## Testing

- `src/devServer/schemaExport.test.ts`: unit tests for
  `buildEventJsonSchemas` -- empty/`undefined` input, single schema, schema
  with nested object properties, `z.undefined()` (no-payload event) does
  not throw.
- `src/devServer/server.test.ts` / `server.integration.test.ts`: existing
  `GET /schema` assertions continue to pass against the refactored handler
  (no new tests strictly required here, but confirm none regress).
- `src/cli/schemaArgs.test.ts`: unit tests for `parseSchemaArgs` (known
  flags, unknown flag throws, missing value throws), mirroring `args.test.ts`.
- `src/cli/schema.test.ts` / `schema.integration.test.ts`: mirror `dev.test.ts`'s
  own structure (check that file first) -- cases: no config found (exit 1,
  stderr message), malformed config (exit 1, `ConfigLoadError` message),
  valid config + `--out` (file written, correct JSON, exit 0, stdout
  confirmation), valid config without `--out` (stdout contains the JSON,
  exit 0), unknown flag (exit 1 via `CliArgError`).

## Out of scope

`typetrack docs` (issue 002, built on this issue's `buildEventJsonSchemas`).
Any change to `GET /schema`'s response shape or `typetrack dev`'s existing
flags/behavior.
