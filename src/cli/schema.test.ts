import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { runSchemaCommand } from "./schema";

// Fixtures that `runSchemaCommand()` actually `import()`s (via `loadConfig`)
// must live somewhere under the repo root (rather than the OS tmpdir) so
// their `import { z } from "zod"` resolves via the normal ancestor
// `node_modules` lookup -- same pattern as `src/devServer/config.test.ts`
// and `src/cli/index.integration.test.ts`.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(REPO_ROOT, ".tmp-fixtures");

let baseDir: string;
let originalLog: typeof console.log;
let originalError: typeof console.error;
let logLines: string[];
let errorLines: string[];

beforeEach(() => {
  mkdirSync(FIXTURES_ROOT, { recursive: true });
  baseDir = mkdtempSync(join(FIXTURES_ROOT, "schema-cmd-"));

  logLines = [];
  errorLines = [];
  originalLog = console.log;
  originalError = console.error;
  console.log = (...args: unknown[]) => {
    logLines.push(args.join(" "));
  };
  console.error = (...args: unknown[]) => {
    errorLines.push(args.join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  rmSync(baseDir, { recursive: true, force: true });
});

describe("runSchemaCommand", () => {
  it("returns 1 and prints an error when no config is found", async () => {
    const exitCode = await runSchemaCommand([], { cwd: baseDir });

    expect(exitCode).toBe(1);
    expect(errorLines.join("\n")).toContain("no typetrack config found");
  });

  it("returns 1 and prints the ConfigLoadError message for a malformed config", async () => {
    writeFileSync(join(baseDir, "typetrack.config.ts"), `throw new Error("boom");`);

    const exitCode = await runSchemaCommand([], { cwd: baseDir });

    expect(exitCode).toBe(1);
    expect(errorLines.join("\n")).toContain("boom");
  });

  it("writes the schema JSON to --out and prints a confirmation, exit 0", async () => {
    writeFileSync(
      join(baseDir, "typetrack.config.ts"),
      `import { z } from "zod";
export default { schemas: { signup_completed: z.object({ plan: z.string() }) } };`,
    );
    const outPath = join(baseDir, "schema.json");

    const exitCode = await runSchemaCommand(["--out", outPath], { cwd: baseDir });

    expect(exitCode).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const written = JSON.parse(readFileSync(outPath, "utf8")) as { events: Record<string, unknown> };
    expect(Object.keys(written.events)).toEqual(["signup_completed"]);
    expect(logLines.join("\n")).toContain(`✓ schema written to ${outPath}`);
  });

  it("prints the schema JSON to stdout when --out is omitted, exit 0", async () => {
    writeFileSync(
      join(baseDir, "typetrack.config.ts"),
      `import { z } from "zod";
export default { schemas: { page_viewed: z.object({ path: z.string() }) } };`,
    );

    const exitCode = await runSchemaCommand([], { cwd: baseDir });

    expect(exitCode).toBe(0);
    expect(logLines).toHaveLength(1);
    const parsed = JSON.parse(logLines[0] ?? "") as { events: Record<string, unknown> };
    expect(Object.keys(parsed.events)).toEqual(["page_viewed"]);
  });

  it("returns 1 and prints the usage on an unknown flag", async () => {
    const exitCode = await runSchemaCommand(["--bogus", "1"], { cwd: baseDir });

    expect(exitCode).toBe(1);
    expect(errorLines.some((line) => line.includes("Unknown argument"))).toBe(true);
    expect(errorLines.some((line) => line.includes("Usage: typetrack schema"))).toBe(true);
  });

  it("honors --config to point at a non-default config path", async () => {
    const customPath = join(baseDir, "custom.config.ts");
    writeFileSync(
      customPath,
      `import { z } from "zod";
export default { schemas: { custom_event: z.object({}) } };`,
    );

    const exitCode = await runSchemaCommand(["--config", customPath], { cwd: baseDir });

    expect(exitCode).toBe(0);
    expect(logLines).toHaveLength(1);
    const parsed = JSON.parse(logLines[0] ?? "") as { events: Record<string, unknown> };
    expect(Object.keys(parsed.events)).toEqual(["custom_event"]);
  });
});
