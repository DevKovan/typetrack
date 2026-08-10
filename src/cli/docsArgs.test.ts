import { describe, expect, it } from "bun:test";
import { CliArgError } from "./args";
import { parseDocsArgs } from "./docsArgs";

describe("parseDocsArgs", () => {
  it("returns no configPath/outPath when given no flags at all", () => {
    expect(parseDocsArgs([])).toEqual({});
  });

  it("maps --config to configPath", () => {
    const parsed = parseDocsArgs(["--config", "custom.config.ts"]);
    expect(parsed).toEqual({ configPath: "custom.config.ts" });
  });

  it("maps --out to outPath", () => {
    const parsed = parseDocsArgs(["--out", "EVENTS.md"]);
    expect(parsed).toEqual({ outPath: "EVENTS.md" });
  });

  it("maps --out - to outPath '-' (the parser applies no special meaning to it)", () => {
    const parsed = parseDocsArgs(["--out", "-"]);
    expect(parsed).toEqual({ outPath: "-" });
  });

  it("accepts both flags together, in any order", () => {
    const parsed = parseDocsArgs(["--out", "EVENTS.md", "--config", "my.config.ts"]);
    expect(parsed).toEqual({ configPath: "my.config.ts", outPath: "EVENTS.md" });
  });

  it("rejects a flag with no following value", () => {
    expect(() => parseDocsArgs(["--config"])).toThrow(CliArgError);
  });

  it("rejects an unrecognized flag", () => {
    expect(() => parseDocsArgs(["--bogus", "1"])).toThrow(CliArgError);
  });

  it("throws CliArgError with a message identifying the unknown flag", () => {
    try {
      parseDocsArgs(["--port", "5000"]);
      throw new Error("expected parseDocsArgs to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliArgError);
      expect((error as Error).message).toContain("--port");
    }
  });
});
