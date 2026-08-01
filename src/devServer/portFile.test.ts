import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { deletePortFile, portFilePath, readPortFile, writePortFile } from "./portFile";

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "typetrack-portfile-"));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("writePortFile / readPortFile", () => {
  it("creates .typetrack/ when absent and writes the correct number", async () => {
    expect(existsSync(join(baseDir, ".typetrack"))).toBe(false);

    await writePortFile(4318, baseDir);

    expect(existsSync(portFilePath(baseDir))).toBe(true);
  });

  it("round-trips the written port back as a number", async () => {
    await writePortFile(4321, baseDir);

    const port = await readPortFile(baseDir);
    expect(port).toBe(4321);
  });

  it("returns undefined for a missing file", async () => {
    const port = await readPortFile(baseDir);
    expect(port).toBeUndefined();
  });

  it("returns undefined for a file containing non-numeric garbage", async () => {
    await writePortFile(4318, baseDir);
    await Bun.write(portFilePath(baseDir), "not-a-port");

    const port = await readPortFile(baseDir);
    expect(port).toBeUndefined();
  });
});

describe("deletePortFile", () => {
  it("removes the file", async () => {
    await writePortFile(4318, baseDir);
    expect(existsSync(portFilePath(baseDir))).toBe(true);

    await deletePortFile(baseDir);

    expect(existsSync(portFilePath(baseDir))).toBe(false);
  });

  it("does not throw when called twice (idempotent)", async () => {
    await writePortFile(4318, baseDir);

    await deletePortFile(baseDir);
    await expect(deletePortFile(baseDir)).resolves.toBeUndefined();
  });

  it("does not throw when the file was never created", async () => {
    await expect(deletePortFile(baseDir)).resolves.toBeUndefined();
  });
});
