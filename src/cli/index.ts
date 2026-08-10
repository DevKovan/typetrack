#!/usr/bin/env bun

// `typetrack dev` is built directly on `Bun.serve()`'s `ReadableStream`-based
// SSE support (see `src/devServer/server.ts` / `sse.ts`) -- this is a hard
// runtime requirement, not a soft preference. This check must run before
// anything else in this file touches a Bun-only API (including, indirectly,
// importing `./dev`, which is why that import below is dynamic rather than
// static) so that a non-Bun runtime gets this one clear line instead of a
// raw `ReferenceError`.
if (typeof Bun === "undefined") {
  console.error("✗ typetrack dev requires the Bun runtime. Install it from https://bun.sh and re-run with `bunx typetrack dev` (or `bun` on PATH).");
  process.exit(1);
}

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
