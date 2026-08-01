import type { z } from "zod";
import {
  ConfigLoadError,
  readPortFile,
  resolveConfigPath,
  startDevServer,
  loadConfig,
  waitForHealthy,
  watchConfig,
} from "../devServer";
import { CliArgError, parseDevArgs } from "./args";
import { checkPortFileStatus, type HealthCheck } from "./portStatus";

const USAGE = "Usage: typetrack dev [--config <path>] [--port <n>] [--buffer-size <n>]";

// Short-timeout probe used to decide whether an on-disk `.typetrack/port`
// file still belongs to a live `typetrack dev` process -- deliberately far
// shorter than `waitForHealthy`'s post-bind default (a genuinely running dev
// server answers near-instantly; a crashed one's port is either unbound
// entirely or squatted by something unrelated, neither of which is worth
// waiting 2s to rule out).
const STALE_CHECK_TIMEOUT_MS = 300;

const defaultHealthCheck: HealthCheck = async (port) => {
  await waitForHealthy(`http://127.0.0.1:${port}/health`, {
    timeoutMs: STALE_CHECK_TIMEOUT_MS,
    intervalMs: 50,
  });
};

export interface RunDevCommandOptions {
  // Working directory `.typetrack/port` and the config search live under.
  // Defaults to `process.cwd()`; overridable so tests never depend on (or
  // mutate) the real repo root.
  cwd?: string;
  // Injectable so tests can simulate a live/stale port file without a real
  // second process listening.
  healthCheck?: HealthCheck;
}

// Runs `typetrack dev`, returning the process exit code to use. Every
// recognized failure mode (bad args, another instance already running, a
// broken config) returns non-zero rather than throwing -- `src/cli/index.ts`
// is the only place that ever calls `process.exit()`. On success this
// resolves only once a shutdown signal has been handled (see below); the
// process otherwise stays alive serving requests indefinitely.
export async function runDevCommand(argv: string[], options: RunDevCommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const healthCheck = options.healthCheck ?? defaultHealthCheck;

  let args;
  try {
    args = parseDevArgs(argv);
  } catch (error) {
    if (!(error instanceof CliArgError)) throw error;
    console.error(`✗ ${error.message}`);
    console.error(USAGE);
    return 1;
  }

  const existingPort = await readPortFile(cwd);
  if (existingPort !== undefined) {
    const status = await checkPortFileStatus(existingPort, healthCheck);
    if (status === "live") {
      console.error(`✗ typetrack dev is already running on port ${existingPort}`);
      return 1;
    }
    // Stale: a crashed/killed process's leftover port file. Fall through and
    // let `startDevServer()` overwrite it once it binds for real.
  }

  const configPath = resolveConfigPath(cwd, args.configPath);
  let schemas: Record<string, z.ZodType> | undefined;

  if (configPath) {
    try {
      schemas = (await loadConfig(configPath)).schemas;
    } catch (error) {
      const message = error instanceof ConfigLoadError ? error.message : String(error);
      console.error(`✗ ${message}`);
      return 1;
    }
  } else {
    console.log("• no typetrack config found -- events will be recorded unvalidated");
  }

  const handle = await startDevServer({ startPort: args.port, bufferSize: args.bufferSize, hostname: "127.0.0.1" });
  handle.setSchemas(schemas);

  const watcher = configPath
    ? watchConfig(configPath, {
        onReload: (nextSchemas) => handle.setSchemas(nextSchemas),
      })
    : undefined;

  console.log(`✓ typetrack dev ready at ${handle.url}`);

  let shuttingDown: Promise<void> | undefined;
  function shutdown(): Promise<void> {
    if (!shuttingDown) {
      shuttingDown = (async () => {
        await watcher?.close();
        await handle.stop();
      })();
    }
    return shuttingDown;
  }

  return new Promise<number>((resolve) => {
    const onSignal = (): void => {
      void shutdown().then(() => resolve(0));
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
