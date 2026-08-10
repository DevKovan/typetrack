import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { runDocsCommand } from "./docs";

// Fixtures that `runDocsCommand()` actually `import()`s (via `loadConfig`)
// must live somewhere under the repo root (rather than the OS tmpdir) so
// their `import { z } from "zod"` resolves via the normal ancestor
// `node_modules` lookup -- same pattern as `src/cli/schema.test.ts`.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(REPO_ROOT, ".tmp-fixtures");

let baseDir: string;
let originalLog: typeof console.log;
let originalError: typeof console.error;
let logLines: string[];
let errorLines: string[];

beforeEach(() => {
  mkdirSync(FIXTURES_ROOT, { recursive: true });
  baseDir = mkdtempSync(join(FIXTURES_ROOT, "docs-cmd-"));

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

describe("runDocsCommand", () => {
  it("returns 1 and prints an error when no config is found", async () => {
    const exitCode = await runDocsCommand([], { cwd: baseDir });

    expect(exitCode).toBe(1);
    expect(errorLines.join("\n")).toContain("no typetrack config found");
  });

  it("returns 1 and prints the ConfigLoadError message for a malformed config", async () => {
    writeFileSync(join(baseDir, "typetrack.config.ts"), `throw new Error("boom");`);

    const exitCode = await runDocsCommand([], { cwd: baseDir });

    expect(exitCode).toBe(1);
    expect(errorLines.join("\n")).toContain("boom");
  });

  it("writes EVENTS.md in cwd by default and prints a confirmation, exit 0", async () => {
    writeFileSync(
      join(baseDir, "typetrack.config.ts"),
      `import { z } from "zod";
export default { schemas: { signup_completed: z.object({ plan: z.string() }) } };`,
    );

    const exitCode = await runDocsCommand([], { cwd: baseDir });
    const defaultOutPath = join(baseDir, "EVENTS.md");

    expect(exitCode).toBe(0);
    expect(existsSync(defaultOutPath)).toBe(true);
    const written = readFileSync(defaultOutPath, "utf8");
    expect(written).toContain("## signup_completed");
    expect(logLines.join("\n")).toContain(`✓ event catalog written to ${defaultOutPath}`);
  });

  it("writes the catalog to an explicit --out path and prints a confirmation, exit 0", async () => {
    writeFileSync(
      join(baseDir, "typetrack.config.ts"),
      `import { z } from "zod";
export default { schemas: { page_viewed: z.object({ path: z.string() }) } };`,
    );
    const outPath = join(baseDir, "docs", "catalog.md");

    const exitCode = await runDocsCommand(["--out", outPath], { cwd: baseDir });

    expect(exitCode).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, "utf8")).toContain("## page_viewed");
    expect(logLines.join("\n")).toContain(`✓ event catalog written to ${outPath}`);
  });

  it("prints the Markdown catalog to stdout with no confirmation line when --out is '-'", async () => {
    writeFileSync(
      join(baseDir, "typetrack.config.ts"),
      `import { z } from "zod";
export default { schemas: { page_viewed: z.object({ path: z.string() }) } };`,
    );

    const exitCode = await runDocsCommand(["--out", "-"], { cwd: baseDir });

    expect(exitCode).toBe(0);
    expect(existsSync(join(baseDir, "EVENTS.md"))).toBe(false);
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toContain("# Event Catalog");
    expect(logLines[0]).toContain("## page_viewed");
    expect(logLines.some((line) => line.includes("written to"))).toBe(false);
  });

  it("returns 1 and prints the usage on an unknown flag", async () => {
    const exitCode = await runDocsCommand(["--bogus", "1"], { cwd: baseDir });

    expect(exitCode).toBe(1);
    expect(errorLines.some((line) => line.includes("Unknown argument"))).toBe(true);
    expect(errorLines.some((line) => line.includes("Usage: typetrack docs"))).toBe(true);
  });

  it("honors --config to point at a non-default config path", async () => {
    const customPath = join(baseDir, "custom.config.ts");
    writeFileSync(
      customPath,
      `import { z } from "zod";
export default { schemas: { custom_event: z.object({}) } };`,
    );

    const exitCode = await runDocsCommand(["--config", customPath, "--out", "-"], { cwd: baseDir });

    expect(exitCode).toBe(0);
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toContain("## custom_event");
  });
});
