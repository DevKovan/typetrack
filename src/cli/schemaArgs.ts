import { CliArgError } from "./args";

export interface ParsedSchemaArgs {
  configPath?: string;
  outPath?: string;
}

const KNOWN_FLAGS = new Set(["--config", "--out"]);

// Parses `typetrack schema`'s flags in isolation (no I/O, no process
// access) -- `argv` is expected to already have the `typetrack`/`schema`
// tokens stripped (i.e. `process.argv.slice(3)` or equivalent). Mirrors
// `parseDevArgs`'s (`./args`) "unknown flag" / "flag missing its value"
// `CliArgError` behavior exactly.
export function parseSchemaArgs(argv: string[]): ParsedSchemaArgs {
  const result: ParsedSchemaArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];

    if (flag === undefined || !KNOWN_FLAGS.has(flag)) {
      throw new CliArgError(`Unknown argument: "${flag ?? ""}"`);
    }

    i++;
    const value = argv[i];
    if (value === undefined) {
      throw new CliArgError(`${flag} requires a value`);
    }

    switch (flag) {
      case "--config":
        result.configPath = value;
        break;
      case "--out":
        result.outPath = value;
        break;
    }
  }

  return result;
}
