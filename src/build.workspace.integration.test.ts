// Integration test (real, non-mocked): runs the actual `bun run build:all`
// script as a real child process against the real, already-`bun install`ed
// monorepo (same pattern as `src/index.global.integration.test.ts`'s real
// `bun run build` subprocess), then confirms every package's real `dist/`
// output landed on disk, and that `packages/next/src/index.test.tsx` --
// the test that specifically exercises the cross-package `@typetrack/react`
// import that previously failed with "Cannot find module '@typetrack/react'"
// (see `plan/phase-4-build/002-workspace-linking-and-build-orchestration.md`)
// -- passes as a real, separately-spawned `bun test` run.
//
// This does *not* replace the fuller `rm -rf node_modules dist
// packages/*/dist packages/*/node_modules && bun install && bun run
// build:all && bun test` clean-checkout sequence from that issue's
// acceptance criterion 4 -- that sequence is destructive (deletes
// `node_modules`) and slow, so it's unsuitable to run as part of the normal
// `bun test` suite; it must be run manually/in CI instead. This test
// exercises the same `build:all` script and the same previously-broken
// import non-destructively, so it's safe to run repeatedly.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "bun:test";

const REPO_ROOT = join(import.meta.dir, "..");

let buildExitCode: number;
let buildStderr: string;

beforeAll(async () => {
  const build = Bun.spawn({
    cmd: ["bun", "run", "build:all"],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  buildExitCode = await build.exited;
  buildStderr = await new Response(build.stderr).text();
}, 60_000);

describe("bun run build:all, real subprocess", () => {
  it("exits 0", () => {
    expect(buildExitCode).toBe(0);
  });

  it("produces real dist/ output for root typetrack", () => {
    expect(existsSync(join(REPO_ROOT, "dist", "index.js"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "dist", "index.d.ts"))).toBe(true);
  });

  it("produces real dist/ output for packages/react, built after root (re-exports typetrack's types)", () => {
    expect(existsSync(join(REPO_ROOT, "packages", "react", "dist", "index.js"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "packages", "react", "dist", "index.d.ts"))).toBe(true);
  });

  it("produces real dist/ output for packages/next, built after packages/react", () => {
    expect(existsSync(join(REPO_ROOT, "packages", "next", "dist", "index.js"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "packages", "next", "dist", "index.d.ts"))).toBe(true);
  });

  it("never fails to resolve typetrack's own type declarations while building packages/react", () => {
    expect(buildStderr).not.toContain("Cannot find module 'typetrack'");
  });
});

describe("packages/next/src/index.test.tsx, real bun test subprocess", () => {
  it("passes -- the specific @typetrack/react cross-package import that previously failed with 'Cannot find module' now resolves", async () => {
    const test = Bun.spawn({
      cmd: ["bun", "test", join("packages", "next", "src", "index.test.tsx")],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await test.exited;
    const stderr = await new Response(test.stderr).text();

    expect(stderr).not.toContain("Cannot find module '@typetrack/react'");
    expect(exitCode).toBe(0);
  }, 30_000);
});
