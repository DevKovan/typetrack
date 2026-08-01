import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TYPETRACK_DIR_NAME = ".typetrack";
const PORT_FILE_NAME = "port";

// `.typetrack/` is single-machine, ephemeral runtime data (git-ignored) --
// every helper here defaults to `process.cwd()` but accepts an explicit
// `baseDir` so it stays fully testable against a temp directory.
export function portFilePath(baseDir: string = process.cwd()): string {
  return join(baseDir, TYPETRACK_DIR_NAME, PORT_FILE_NAME);
}

export async function writePortFile(port: number, baseDir: string = process.cwd()): Promise<void> {
  await mkdir(join(baseDir, TYPETRACK_DIR_NAME), { recursive: true });
  await writeFile(portFilePath(baseDir), String(port), "utf8");
}

// Returns `undefined` (never throws) when the file/directory is missing or
// the file's contents aren't a plain integer -- callers treat "no port on
// record" and "garbage on disk" identically.
export async function readPortFile(baseDir: string = process.cwd()): Promise<number | undefined> {
  let contents: string;
  try {
    contents = await readFile(portFilePath(baseDir), "utf8");
  } catch {
    return undefined;
  }

  const trimmed = contents.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;

  return Number(trimmed);
}

// Idempotent: tolerates the file already being absent (used on graceful
// shutdown, where the file may never have been written or was already
// cleaned up).
export async function deletePortFile(baseDir: string = process.cwd()): Promise<void> {
  try {
    await rm(portFilePath(baseDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
