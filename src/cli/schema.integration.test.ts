import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// The CLI entry itself does an `import { z } from "zod"` (via its config
// loading path) -- fixtures it actually loads must live somewhere under the
// repo root (rather than the OS tmpdir) so that bare specifier resolves via
// the normal ancestor `node_modules` lookup, matching the pattern used by
// `src/cli/index.integration.test.ts`.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(REPO_ROOT, ".tmp-fixtures");
const CLI_ENTRY = join(REPO_ROOT, "src", "cli", "index.ts");

let baseDir: string;

beforeEach(() => {
  mkdirSync(FIXTURES_ROOT, { recursive: true });
  baseDir = mkdtempSync(join(FIXTURES_ROOT, "schema-integration-"));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

async function runCli(args: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI_ENTRY, "schema", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

describe("typetrack schema CLI, real child process", () => {
  it("exits 1 with a clear stderr message when no config is found", async () => {
    const { exitCode, stderr } = await runCli([], baseDir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("no typetrack config found");
  });

  it("exits 1 with the ConfigLoadError message for a malformed config", async () => {
    writeFileSync(join(baseDir, "typetrack.config.ts"), `throw new Error("kaboom");`);

    const { exitCode, stderr } = await runCli([], baseDir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("kaboom");
  });

  it("writes a real JSON Schema file (real Zod validation) to --out and confirms on stdout, exit 0", async () => {
    writeFileSync(
      join(baseDir, "typetrack.config.ts"),
      `import { z } from "zod";
export default {
  schemas: {
    signup_completed: z.object({ plan: z.enum(["free", "pro"]) }),
    page_viewed: z.object({ path: z.string(), referrer: z.string().optional() }),
  },
};`,
    );
    const outPath = join(baseDir, "schema.json");

    const { exitCode, stdout } = await runCli(["--out", outPath], baseDir);

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`✓ schema written to ${outPath}`);
    expect(existsSync(outPath)).toBe(true);

    const written = JSON.parse(readFileSync(outPath, "utf8")) as { events: Record<string, unknown> };
    expect(Object.keys(written.events).sort()).toEqual(["page_viewed", "signup_completed"]);
    const signupSchema = written.events.signup_completed as { type?: string; properties?: unknown };
    expect(signupSchema.type).toBe("object");
    expect(signupSchema.properties).toBeDefined();
  });

  it("prints the JSON Schema straight to stdout, pipeable, when --out is omitted, exit 0", async () => {
    writeFileSync(
      join(baseDir, "typetrack.config.ts"),
      `import { z } from "zod";
export default { schemas: { ping: z.object({ ok: z.boolean() }) } };`,
    );

    const { exitCode, stdout } = await runCli([], baseDir);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { events: Record<string, unknown> };
    expect(Object.keys(parsed.events)).toEqual(["ping"]);
  });

  it("exits 1 via CliArgError on an unknown flag", async () => {
    const { exitCode, stderr } = await runCli(["--bogus", "1"], baseDir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown argument");
  });
});
