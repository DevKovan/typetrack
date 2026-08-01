import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { deletePortFile, findFreePort, portFilePath, readPortFile, writePortFile } from "./index";

const HOSTNAME = "127.0.0.1";
const REPO_ROOT = join(import.meta.dir, "..", "..");

describe("devServer port discovery, in a real temp directory", () => {
  let baseDir: string;
  let held: Server | undefined;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "typetrack-devserver-"));
  });

  afterEach(async () => {
    if (held) await new Promise<void>((resolve) => held!.close(() => resolve()));
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("scans, writes, reads, and deletes a port file end-to-end", async () => {
    const busyPort = 4500;
    held = await new Promise<Server>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(busyPort, HOSTNAME, () => resolve(server));
    });

    const freePort = await findFreePort({ startPort: busyPort, hostname: HOSTNAME });
    expect(freePort).toBe(busyPort + 1);

    await writePortFile(freePort, baseDir);
    expect(existsSync(portFilePath(baseDir))).toBe(true);

    const readBack = await readPortFile(baseDir);
    expect(readBack).toBe(freePort);

    await deletePortFile(baseDir);
    expect(existsSync(portFilePath(baseDir))).toBe(false);
  });
});

describe(".typetrack/ gitignore", () => {
  it("is listed in the repo's root .gitignore", async () => {
    const gitignore = await Bun.file(join(REPO_ROOT, ".gitignore")).text();
    expect(gitignore).toMatch(/^\.typetrack\/$/m);
  });

  it("reports a file under a real .typetrack/ in the repo checkout as git-ignored", async () => {
    const typetrackDir = join(REPO_ROOT, ".typetrack");
    try {
      await writePortFile(4318, REPO_ROOT);

      const output = execSync("git check-ignore .typetrack/port", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).trim();

      expect(output).toBe(".typetrack/port");
    } finally {
      rmSync(typetrackDir, { recursive: true, force: true });
    }
  });
});
