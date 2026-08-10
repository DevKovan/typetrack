import { buildEventJsonSchemas, ConfigLoadError, loadConfig, resolveConfigPath } from "../devServer";
import { CliArgError } from "./args";
import { parseSchemaArgs } from "./schemaArgs";

const USAGE = "Usage: typetrack schema [--config <path>] [--out <path>]";

export interface RunSchemaCommandOptions {
  // Working directory the config search runs under. Defaults to
  // `process.cwd()`; overridable so tests never depend on (or mutate) the
  // real repo root.
  cwd?: string;
}

// Runs `typetrack schema`, returning the process exit code to use. Every
// recognized failure mode (bad args, no config found, a broken config)
// returns non-zero rather than throwing -- `src/cli/index.ts` is the only
// place that ever calls `process.exit()`.
export async function runSchemaCommand(argv: string[], options: RunSchemaCommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();

  let args;
  try {
    args = parseSchemaArgs(argv);
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

  const result = buildEventJsonSchemas(schemas);
  const json = JSON.stringify(result, null, 2);

  if (args.outPath) {
    await Bun.write(args.outPath, json);
    console.log(`✓ schema written to ${args.outPath}`);
    return 0;
  }

  console.log(json);
  return 0;
}
