import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { FSWatcher } from "chokidar";
import { loadConfig, resolveConfigPath, watchConfig } from "./config";
import { startDevServer, type DevServerHandle } from "./server";

// Fixtures here are real files `loadConfig()` `import()`s, including an
// `import { z } from "zod"` -- they must live somewhere under the repo root
// (rather than the OS tmpdir) so that bare specifier resolves via the
// normal ancestor `node_modules` lookup.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_ROOT = join(REPO_ROOT, ".tmp-fixtures");

let baseDir: string;
let handle: DevServerHandle | undefined;
let watcher: FSWatcher | undefined;

beforeEach(() => {
  mkdirSync(FIXTURES_ROOT, { recursive: true });
  baseDir = mkdtempSync(join(FIXTURES_ROOT, "config-integration-"));
});

afterEach(async () => {
  if (watcher) {
    await watcher.close();
    watcher = undefined;
  }
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
  rmSync(baseDir, { recursive: true, force: true });
});

// Polls `predicate` until it returns `true` or `timeoutMs` elapses -- used
// to wait on chokidar's async `change` event + reload without an arbitrary
// fixed-length sleep.
async function waitUntil(predicate: () => boolean, timeoutMs = 4000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitUntil: condition never became true within the timeout");
}

describe("config loading + chokidar hot reload wired to a real dev server", () => {
  it(
    "hot-swaps the live schema on a config file edit, without restarting the server or changing its port",
    async () => {
      const configPath = join(baseDir, "typetrack.config.ts");
      writeFileSync(
        configPath,
        `import { z } from "zod";
export default { schemas: { signup_completed: z.object({ plan: z.string() }) } };`,
      );

      const resolved = resolveConfigPath(baseDir);
      expect(resolved).toBe(configPath);

      handle = await startDevServer({ startPort: 4950 });
      const initialPort = handle.port;

      const initial = await loadConfig(resolved as string);
      handle.setSchemas(initial.schemas);

      let reloadCount = 0;
      watcher = watchConfig(resolved as string, {
        onReload: (schemas) => {
          reloadCount++;
          handle?.setSchemas(schemas);
        },
      });

      const payload = { event: "signup_completed", payload: { plan: "pro" } };

      await fetch(`${handle.url}/events`, { method: "POST", body: JSON.stringify(payload) });

      // Tighten the schema: `region` becomes a required field the old
      // payload (which only has `plan`) no longer satisfies.
      writeFileSync(
        configPath,
        `import { z } from "zod";
export default { schemas: { signup_completed: z.object({ plan: z.string(), region: z.string() }) } };`,
      );

      await waitUntil(() => reloadCount > 0);

      await fetch(`${handle.url}/events`, { method: "POST", body: JSON.stringify(payload) });

      const eventsResponse = await fetch(`${handle.url}/events`);
      const events = (await eventsResponse.json()) as Array<{ valid: boolean }>;

      expect(events).toHaveLength(2);
      expect(events[0]?.valid).toBe(true);
      expect(events[1]?.valid).toBe(false);
      expect(handle.port).toBe(initialPort);
    },
    8000,
  );

  it(
    "a corrupt config edit keeps the server healthy and the last-known-good schema active",
    async () => {
      const configPath = join(baseDir, "typetrack.config.ts");
      writeFileSync(
        configPath,
        `import { z } from "zod";
export default { schemas: { signup_completed: z.object({ plan: z.string() }) } };`,
      );

      handle = await startDevServer({ startPort: 4960 });

      const initial = await loadConfig(configPath);
      handle.setSchemas(initial.schemas);

      let reloadCount = 0;
      let lastError: Error | undefined;
      watcher = watchConfig(configPath, {
        onReload: (schemas) => {
          reloadCount++;
          handle?.setSchemas(schemas);
        },
        onError: (error) => {
          lastError = error;
        },
      });

      const originalConsoleError = console.error;
      const errorLines: string[] = [];
      console.error = (...args: unknown[]) => {
        errorLines.push(args.join(" "));
      };

      try {
        writeFileSync(configPath, `this is not valid javascript {{{`);
        await waitUntil(() => lastError !== undefined);
      } finally {
        console.error = originalConsoleError;
      }

      expect(reloadCount).toBe(0);
      expect(lastError?.message).toContain(configPath);
      expect(errorLines.some((line) => line.includes(configPath))).toBe(true);

      const healthResponse = await fetch(`${handle.url}/health`);
      expect(healthResponse.status).toBe(200);

      const validResponse = await fetch(`${handle.url}/events`, {
        method: "POST",
        body: JSON.stringify({ event: "signup_completed", payload: { plan: "pro" } }),
      });
      expect(await validResponse.json()).toMatchObject({ valid: true });

      const invalidResponse = await fetch(`${handle.url}/events`, {
        method: "POST",
        body: JSON.stringify({ event: "signup_completed", payload: { plan: 123 } }),
      });
      expect(await invalidResponse.json()).toMatchObject({ valid: false });
    },
    8000,
  );
});
