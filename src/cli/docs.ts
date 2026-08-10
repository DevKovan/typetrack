import { join } from "node:path";
import { buildEventJsonSchemas, ConfigLoadError, loadConfig, renderEventCatalog, resolveConfigPath } from "../devServer";
import { CliArgError } from "./args";
import { parseDocsArgs } from "./docsArgs";

const USAGE = "Usage: typetrack docs [--config <path>] [--out <path>]";
const DEFAULT_OUT_FILE = "EVENTS.md";

export interface RunDocsCommandOptions {
  // Working directory the config search (and the default `--out` path)
  // runs under. Defaults to `process.cwd()`; overridable so tests never
  // depend on (or mutate) the real repo root.
  cwd?: string;
}

// Runs `typetrack docs`, returning the process exit code to use. Every
// recognized failure mode (bad args, no config found, a broken config)
// returns non-zero rather than throwing -- `src/cli/index.ts` is the only
// place that ever calls `process.exit()`. Structurally mirrors issue 001's
// `runSchemaCommand`, except `--out` defaults to `EVENTS.md` in `cwd`
// (rather than stdout) when omitted, and `--out -` explicitly means
// "write to stdout" instead.
export async function runDocsCommand(argv: string[], options: RunDocsCommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();

  let args;
  try {
    args = parseDocsArgs(argv);
  } catch (error) {
    if (!(error instanceof CliArgError)) throw error;
    console.error(`✗ ${error.message}`);
    console.error(USAGE);
    return 1;
  }

  const configPath = resolveConfigPath(cwd, args.configPath);
  if (!configPath) {
    console.error("✗ no typetrack config found -- see typetrack.config.ts documentation");
    return 1;
  }

  let schemas;
  try {
    schemas = (await loadConfig(configPath)).schemas;
  } catch (error) {
    const message = error instanceof ConfigLoadError ? error.message : String(error);
    console.error(`✗ ${message}`);
    return 1;
  }

  const eventJsonSchemas = buildEventJsonSchemas(schemas);
  const markdown = renderEventCatalog(eventJsonSchemas);

  if (args.outPath === "-") {
    console.log(markdown);
    return 0;
  }

  const outPath = args.outPath ?? join(cwd, DEFAULT_OUT_FILE);
  await Bun.write(outPath, markdown);
  console.log(`✓ event catalog written to ${outPath}`);
  return 0;
}
