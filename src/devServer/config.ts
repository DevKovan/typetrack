import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { watch, type FSWatcher } from "chokidar";
import type { z } from "zod";

// Search order for `typetrack dev`'s config file convention -- first match
// in this exact sequence wins. An explicit override path (the CLI's
// `--config <path>`, wired in 005) bypasses this search entirely.
export const CONFIG_FILE_CANDIDATES = [
  "typetrack.config.ts",
  "typetrack.config.mts",
  "typetrack.config.js",
  "typetrack.config.mjs",
] as const;

// Resolves the on-disk config path to load. `overridePath`, when supplied,
// always wins regardless of what's present in `dir` -- it is assumed to
// already be a usable path (005's CLI owns turning `--config <path>` into
// this parameter; this function does no further resolution of it).
// Otherwise scans `dir` for the first `CONFIG_FILE_CANDIDATES` entry that
// exists on disk. Returns `undefined` when neither is found.
export function resolveConfigPath(dir: string, overridePath?: string): string | undefined {
  if (overridePath) return overridePath;

  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const full = join(dir, candidate);
    if (existsSync(full)) return full;
  }

  return undefined;
}

export interface LoadedConfig {
  schemas: Record<string, z.ZodType>;
}

// Thrown by `loadConfig()` for every failure mode: a missing default
// export, a default export whose `schemas` isn't an object, or the module
// throwing during import/evaluation (syntax error, thrown exception,
// etc). Always carries the offending file's path so callers can print a
// clear, actionable message instead of a bare stack trace.
export class ConfigLoadError extends Error {
  readonly path: string;

  constructor(path: string, cause: unknown) {
    super(`Failed to load typetrack config at "${path}": ${describeCause(cause)}`);
    this.name = "ConfigLoadError";
    this.path = path;
    this.cause = cause;
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

// Monotonic counter appended (alongside a timestamp) to the cache-busting
// shadow file's name -- guards against two reloads landing in the same
// millisecond and colliding on the same "unique" path.
let cacheBustCounter = 0;

// Dynamically imports `path` and validates its default export is shaped
// `{ schemas: Record<string, z.ZodType> }` (the same shape `createAnalytics`
// accepts, so a user's config and app code can share one object). Set
// `cacheBust: true` on every *reload* of an already-imported path.
//
// Bun's dynamic-`import()` cache is keyed on the resolved file path alone --
// appending a `?query` or `#fragment` suffix (the usual Node.js trick) does
// *not* defeat it; a bare re-`import()` of the same path keeps serving the
// first-ever import's contents forever, even after the file changes on
// disk. What *does* work is importing a path Bun has never seen before, so
// on a cache-busted reload this copies the file's current on-disk source
// into a throwaway "shadow" file next to it (same directory, so any bare or
// relative imports inside the config still resolve exactly as they would
// from the original path) and imports that instead, deleting it again
// once the import has settled either way.
export async function loadConfig(path: string, options: { cacheBust?: boolean } = {}): Promise<LoadedConfig> {
  const { cacheBust = false } = options;

  let moduleExports: unknown;
  let shadowPath: string | undefined;

  try {
    if (cacheBust) {
      const source = await readFile(path, "utf8");
      shadowPath = join(
        dirname(path),
        `.typetrack.config.reload-${Date.now()}-${cacheBustCounter++}${extname(path)}`,
      );
      await Bun.write(shadowPath, source);
      moduleExports = await import(pathToFileURL(shadowPath).href);
    } else {
      moduleExports = await import(pathToFileURL(path).href);
    }
  } catch (error) {
    throw new ConfigLoadError(path, error);
  } finally {
    if (shadowPath) {
      await rm(shadowPath, { force: true }).catch(() => {
        // Best-effort cleanup only -- a leftover shadow file never affects
        // correctness (it's never a candidate in `CONFIG_FILE_CANDIDATES`
        // and chokidar here only ever watches the original, exact `path`).
      });
    }
  }

  const defaultExport = (moduleExports as { default?: unknown }).default;

  if (!isLoadedConfigShape(defaultExport)) {
    throw new ConfigLoadError(
      path,
      new Error("default export must be an object shaped `{ schemas: Record<string, z.ZodType> }`"),
    );
  }

  return { schemas: defaultExport.schemas };
}

function isLoadedConfigShape(value: unknown): value is LoadedConfig {
  if (typeof value !== "object" || value === null) return false;
  const schemas = (value as { schemas?: unknown }).schemas;
  return typeof schemas === "object" && schemas !== null;
}

export interface WatchConfigOptions {
  // Called with the newly loaded schemas after a successful reload.
  onReload: (schemas: Record<string, z.ZodType>) => void;
  // Called (in addition to the printed error) when a reload fails. The
  // previously-loaded schemas are left untouched either way -- this hook
  // never itself has the power to clear them.
  onError?: (error: ConfigLoadError) => void;
}

// Watches `path` (a single, already-resolved file -- never a glob) via
// chokidar and re-runs `loadConfig()` with cache-busting on every `change`
// event. A successful reload invokes `onReload()` and prints a one-line
// confirmation; a failed reload (syntax error, thrown exception, malformed
// shape) prints a path-inclusive error and leaves the caller's
// previously-loaded schemas exactly as they were -- `onReload()` is not
// called in that case.
export function watchConfig(path: string, options: WatchConfigOptions): FSWatcher {
  const { onReload, onError } = options;

  const watcher = watch(path);

  watcher.on("change", () => {
    void reload();
  });

  async function reload(): Promise<void> {
    try {
      const { schemas } = await loadConfig(path, { cacheBust: true });
      onReload(schemas);
      console.log(`✓ config reloaded (${path})`);
    } catch (error) {
      const loadError = error instanceof ConfigLoadError ? error : new ConfigLoadError(path, error);
      console.error(`✗ ${loadError.message}`);
      onError?.(loadError);
    }
  }

  return watcher;
}
