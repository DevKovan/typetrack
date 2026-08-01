// Defaults mirror `startDevServer`'s own defaults (`src/devServer/server.ts`)
// so a bare `typetrack dev` behaves identically to `startDevServer()` called
// with no options.
export const DEFAULT_PORT = 4318;
export const DEFAULT_BUFFER_SIZE = 500;

export interface ParsedDevArgs {
  configPath?: string;
  port: number;
  bufferSize: number;
}

// Thrown for any malformed `typetrack dev` invocation -- an unknown flag, a
// flag missing its value, or a value that fails validation (e.g. a
// non-numeric `--port`). Always carries a human-readable, already-final
// message; callers print it as-is rather than a raw stack trace.
export class CliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgError";
  }
}

const KNOWN_FLAGS = new Set(["--config", "--port", "--buffer-size"]);

// Parses `typetrack dev`'s flags in isolation (no I/O, no process access) --
// `argv` is expected to already have the `typetrack`/`dev` tokens stripped
// (i.e. `process.argv.slice(3)` or equivalent). Unrecognized flags and
// missing/invalid values throw `CliArgError` rather than silently producing
// `NaN` or swallowing the mistake.
export function parseDevArgs(argv: string[]): ParsedDevArgs {
  const result: ParsedDevArgs = { port: DEFAULT_PORT, bufferSize: DEFAULT_BUFFER_SIZE };

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
      case "--port":
        result.port = parsePositiveInt(flag, value);
        break;
      case "--buffer-size":
        result.bufferSize = parsePositiveInt(flag, value);
        break;
    }
  }

  return result;
}

function parsePositiveInt(flag: string, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new CliArgError(`${flag} must be a positive integer, got "${value}"`);
  }
  return Number(value);
}
