import { describe, expect, it } from "bun:test";
import { CliArgError } from "./args";
import { parseSchemaArgs } from "./schemaArgs";

describe("parseSchemaArgs", () => {
  it("returns no configPath/outPath when given no flags at all", () => {
    expect(parseSchemaArgs([])).toEqual({});
  });

  it("maps --config to configPath", () => {
    const parsed = parseSchemaArgs(["--config", "custom.config.ts"]);
    expect(parsed).toEqual({ configPath: "custom.config.ts" });
  });

  it("maps --out to outPath", () => {
    const parsed = parseSchemaArgs(["--out", "schema.json"]);
    expect(parsed).toEqual({ outPath: "schema.json" });
  });

  it("accepts both flags together, in any order", () => {
    const parsed = parseSchemaArgs(["--out", "schema.json", "--config", "my.config.ts"]);
    expect(parsed).toEqual({ configPath: "my.config.ts", outPath: "schema.json" });
  });

  it("rejects a flag with no following value", () => {
    expect(() => parseSchemaArgs(["--config"])).toThrow(CliArgError);
  });

  it("rejects an unrecognized flag", () => {
    expect(() => parseSchemaArgs(["--bogus", "1"])).toThrow(CliArgError);
  });

  it("throws CliArgError with a message identifying the unknown flag", () => {
    try {
      parseSchemaArgs(["--port", "5000"]);
      throw new Error("expected parseSchemaArgs to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliArgError);
      expect((error as Error).message).toContain("--port");
    }
  });
});
