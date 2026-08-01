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

const [, , command, ...rest] = process.argv;

if (command !== "dev") {
  console.error(`✗ Unknown command: "${command ?? ""}"`);
  console.error("Usage: typetrack dev [--config <path>] [--port <n>] [--buffer-size <n>]");
  process.exit(1);
}

const { runDevCommand } = await import("./dev");
const exitCode = await runDevCommand(rest);
process.exit(exitCode);
