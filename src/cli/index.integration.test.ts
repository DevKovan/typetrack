import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { portFilePath, readPortFile } from "../devServer";

// The CLI entry itself does an `import { z } from "zod"` (via its config
// loading path) -- fixtures it actually loads must live somewhere under the
// repo root (rather than the OS tmpdir) so that bare specifier resolves via
// the normal ancestor `node_modules` lookup, matching the pattern used by
// `src/devServer/config.integration.test.ts` / `server.integration.test.ts`.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(REPO_ROOT, ".tmp-fixtures");
const CLI_ENTRY = join(REPO_ROOT, "src", "cli", "index.ts");

let baseDir: string;

beforeEach(() => {
  mkdirSync(FIXTURES_ROOT, { recursive: true });
  baseDir = mkdtempSync(join(FIXTURES_ROOT, "cli-integration-"));
  writeFileSync(
    join(baseDir, "typetrack.config.ts"),
    `import { z } from "zod";
export default { schemas: { ping: z.object({ ok: z.boolean() }) } };`,
  );
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

// Polls `predicate` until it returns `true` or `timeoutMs` elapses -- used to
// wait on the CLI child process's async startup (config load + real
// `Bun.serve()` bind + health poll) without an arbitrary fixed-length sleep.
async function waitUntil(predicate: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitUntil: condition never became true within the timeout");
}

function spawnCli(args: string[], cwd: string): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  return Bun.spawn({
    cmd: ["bun", CLI_ENTRY, "dev", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("typetrack dev CLI, real child process", () => {
  it(
    "binds a real server, answers /health, writes .typetrack/port, and cleans up on SIGINT",
    async () => {
      const proc = spawnCli(["--port", "5100", "--buffer-size", "50"], baseDir);

      try {
        await waitUntil(() => existsSync(portFilePath(baseDir)));

        const port = await readPortFile(baseDir);
        expect(port).toBeGreaterThanOrEqual(5100);

        const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
        expect(healthResponse.status).toBe(200);

        proc.kill("SIGINT");
        const exitCode = await proc.exited;

        expect(exitCode).toBe(0);
        expect(existsSync(portFilePath(baseDir))).toBe(false);
      } finally {
        if (!proc.killed) proc.kill();
        await proc.exited;
      }
    },
    10_000,
  );

  it(
    "a second instance against the same cwd refuses to start while the first is live, and does not clobber its port file",
    async () => {
      const first = spawnCli(["--port", "5110"], baseDir);

      try {
        await waitUntil(() => existsSync(portFilePath(baseDir)));
        const firstPort = await readPortFile(baseDir);

        const second = spawnCli(["--port", "5160"], baseDir);
        const secondExitCode = await second.exited;
        const secondStderr = await new Response(second.stderr).text();

        expect(secondExitCode).toBe(1);
        expect(secondStderr.toLowerCase()).toContain("already running");

        // The first instance's port file must be untouched, and it must
        // still be genuinely serving -- the second instance never got far
        // enough to bind a competing server or overwrite the file.
        const portAfter = await readPortFile(baseDir);
        expect(portAfter).toBe(firstPort);

        const healthResponse = await fetch(`http://127.0.0.1:${firstPort}/health`);
        expect(healthResponse.status).toBe(200);
      } finally {
        first.kill("SIGINT");
        await first.exited;
      }
    },
    10_000,
  );

  // `typeof Bun === "undefined"` can't be simulated in-process: Bun's own
  // `Bun` global is a non-configurable, non-writable property (attempting to
  // reassign or delete it throws), so the only faithful way to exercise this
  // branch is to run the exact same entry file under a genuinely different,
  // Bun-less runtime. Node is used here as that runtime when it's available
  // on `PATH`; the check itself (`src/cli/index.ts`) runs before any
  // Bun-only API is touched and before its own dynamic `import("./dev")`, so
  // Node never needs to resolve or execute anything beyond that first
  // top-level check.
  const hasNode = Bun.which("node") !== null;
  const maybeIt = hasNode ? it : it.skip;

  maybeIt(
    "prints a clear 'requires Bun' message and exits 1 when run under a non-Bun runtime",
    async () => {
      const proc = Bun.spawn({
        cmd: ["node", CLI_ENTRY, "dev"],
        cwd: baseDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderrText = await new Response(proc.stderr).text();

      expect(exitCode).toBe(1);
      expect(stderrText.toLowerCase()).toContain("bun");
      expect(existsSync(portFilePath(baseDir))).toBe(false);
    },
    5_000,
  );
});
