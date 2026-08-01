import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CONFIG_FILE_CANDIDATES, ConfigLoadError, loadConfig, resolveConfigPath } from "./config";

// Fixtures that `loadConfig()` actually `import()`s must live somewhere
// under the repo root (rather than the OS tmpdir) so their `import { z }
// from "zod"` resolves via the normal ancestor `node_modules` lookup --
// `resolveConfigPath`-only fixtures never get imported and would work
// either way, but this keeps every fixture in this file consistent.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(REPO_ROOT, ".tmp-fixtures");

let baseDir: string;

beforeEach(() => {
  mkdirSync(FIXTURES_ROOT, { recursive: true });
  baseDir = mkdtempSync(join(FIXTURES_ROOT, "config-"));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("resolveConfigPath", () => {
  it("returns undefined when no candidate file and no override exist", () => {
    expect(resolveConfigPath(baseDir)).toBeUndefined();
  });

  it("resolves typetrack.config.ts when it's the only candidate present", () => {
    writeFileSync(join(baseDir, "typetrack.config.ts"), "export default { schemas: {} };");

    expect(resolveConfigPath(baseDir)).toBe(join(baseDir, "typetrack.config.ts"));
  });

  it("honors the exact search order: .ts before .mts before .js before .mjs", () => {
    // All four candidates present -- only .ts should win.
    for (const candidate of CONFIG_FILE_CANDIDATES) {
      writeFileSync(join(baseDir, candidate), "export default { schemas: {} };");
    }

    expect(resolveConfigPath(baseDir)).toBe(join(baseDir, "typetrack.config.ts"));
  });

  it("falls through to .mts when .ts is absent but .mts, .js, .mjs are present", () => {
    writeFileSync(join(baseDir, "typetrack.config.mts"), "export default { schemas: {} };");
    writeFileSync(join(baseDir, "typetrack.config.js"), "export default { schemas: {} };");
    writeFileSync(join(baseDir, "typetrack.config.mjs"), "export default { schemas: {} };");

    expect(resolveConfigPath(baseDir)).toBe(join(baseDir, "typetrack.config.mts"));
  });

  it("falls through to .js when only .js and .mjs are present", () => {
    writeFileSync(join(baseDir, "typetrack.config.js"), "export default { schemas: {} };");
    writeFileSync(join(baseDir, "typetrack.config.mjs"), "export default { schemas: {} };");

    expect(resolveConfigPath(baseDir)).toBe(join(baseDir, "typetrack.config.js"));
  });

  it("falls through to .mjs when it's the only candidate present", () => {
    writeFileSync(join(baseDir, "typetrack.config.mjs"), "export default { schemas: {} };");

    expect(resolveConfigPath(baseDir)).toBe(join(baseDir, "typetrack.config.mjs"));
  });

  it("an explicit override path always wins, even when the search directory has its own candidates", () => {
    for (const candidate of CONFIG_FILE_CANDIDATES) {
      writeFileSync(join(baseDir, candidate), "export default { schemas: {} };");
    }
    const overridePath = join(baseDir, "custom.config.mjs");
    writeFileSync(overridePath, "export default { schemas: {} };");

    expect(resolveConfigPath(baseDir, overridePath)).toBe(overridePath);
  });

  it("an explicit override path wins even when nothing exists in the search directory at all", () => {
    const overridePath = join(baseDir, "elsewhere.config.mjs");

    expect(resolveConfigPath(baseDir, overridePath)).toBe(overridePath);
  });
});

describe("loadConfig", () => {
  it("loads a valid config's default export schemas", async () => {
    const path = join(baseDir, "typetrack.config.mjs");
    writeFileSync(
      path,
      `import { z } from "zod";
export default { schemas: { signup_completed: z.object({ plan: z.string() }) } };`,
    );

    const { schemas } = await loadConfig(path);

    expect(Object.keys(schemas)).toEqual(["signup_completed"]);
    expect(schemas.signup_completed?.safeParse({ plan: "pro" }).success).toBe(true);
  });

  it("throws a ConfigLoadError referencing the path when the module has no default export", async () => {
    const path = join(baseDir, "typetrack.config.mjs");
    writeFileSync(path, `export const notDefault = { schemas: {} };`);

    await expect(loadConfig(path)).rejects.toThrow(ConfigLoadError);
    await expect(loadConfig(path)).rejects.toThrow(path);
  });

  it("throws a ConfigLoadError referencing the path when default export has no schemas object", async () => {
    const path = join(baseDir, "typetrack.config.mjs");
    writeFileSync(path, `export default { notSchemas: true };`);

    await expect(loadConfig(path)).rejects.toThrow(ConfigLoadError);
    await expect(loadConfig(path)).rejects.toThrow(path);
  });

  it("throws a ConfigLoadError referencing the path when the module throws during evaluation", async () => {
    const path = join(baseDir, "typetrack.config.mjs");
    writeFileSync(path, `throw new Error("boom");`);

    await expect(loadConfig(path)).rejects.toThrow(ConfigLoadError);
    await expect(loadConfig(path)).rejects.toThrow(path);
  });

  it("throws a ConfigLoadError referencing the path for a syntax error", async () => {
    const path = join(baseDir, "typetrack.config.mjs");
    writeFileSync(path, `this is not valid javascript {{{`);

    await expect(loadConfig(path)).rejects.toThrow(ConfigLoadError);
    await expect(loadConfig(path)).rejects.toThrow(path);
  });

  it("cache-busting: a reload after an on-disk edit reflects the new contents, proving the module cache was defeated", async () => {
    const path = join(baseDir, "typetrack.config.mjs");
    writeFileSync(
      path,
      `import { z } from "zod";
export default { schemas: { first_event: z.object({}) } };`,
    );

    const initial = await loadConfig(path);
    expect(Object.keys(initial.schemas)).toEqual(["first_event"]);

    writeFileSync(
      path,
      `import { z } from "zod";
export default { schemas: { second_event: z.object({}) } };`,
    );

    const reloaded = await loadConfig(path, { cacheBust: true });
    expect(Object.keys(reloaded.schemas)).toEqual(["second_event"]);
  });

  it("without cache-busting, a re-import of the same path is served from the module cache (stale)", async () => {
    const path = join(baseDir, "typetrack.config.mjs");
    writeFileSync(
      path,
      `import { z } from "zod";
export default { schemas: { first_event: z.object({}) } };`,
    );

    const initial = await loadConfig(path);
    expect(Object.keys(initial.schemas)).toEqual(["first_event"]);

    writeFileSync(
      path,
      `import { z } from "zod";
export default { schemas: { second_event: z.object({}) } };`,
    );

    const reloadedWithoutBust = await loadConfig(path);
    expect(Object.keys(reloadedWithoutBust.schemas)).toEqual(["first_event"]);
  });
});
