import { describe, expect, it } from "bun:test";
import { CliArgError, DEFAULT_BUFFER_SIZE, DEFAULT_PORT, parseDevArgs } from "./args";

describe("parseDevArgs", () => {
  it("returns the default port and buffer size, and no config path, when given no flags at all", () => {
    expect(parseDevArgs([])).toEqual({ port: DEFAULT_PORT, bufferSize: DEFAULT_BUFFER_SIZE });
  });

  it("maps --config to configPath", () => {
    const parsed = parseDevArgs(["--config", "custom.config.ts"]);
    expect(parsed.configPath).toBe("custom.config.ts");
    expect(parsed.port).toBe(DEFAULT_PORT);
    expect(parsed.bufferSize).toBe(DEFAULT_BUFFER_SIZE);
  });

  it("maps --port to a parsed number, overriding the default", () => {
    const parsed = parseDevArgs(["--port", "5000"]);
    expect(parsed.port).toBe(5000);
  });

  it("maps --buffer-size to a parsed number, overriding the default", () => {
    const parsed = parseDevArgs(["--buffer-size", "10"]);
    expect(parsed.bufferSize).toBe(10);
  });

  it("accepts all three flags together, in any order", () => {
    const parsed = parseDevArgs(["--port", "5001", "--config", "my.config.ts", "--buffer-size", "20"]);
    expect(parsed).toEqual({ configPath: "my.config.ts", port: 5001, bufferSize: 20 });
  });

  it("rejects a non-numeric --port with a CliArgError rather than propagating NaN", () => {
    expect(() => parseDevArgs(["--port", "not-a-number"])).toThrow(CliArgError);
    try {
      parseDevArgs(["--port", "not-a-number"]);
      throw new Error("expected parseDevArgs to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliArgError);
      expect((error as Error).message).not.toContain("NaN");
      expect((error as Error).message).toContain("--port");
    }
  });

  it("rejects a non-numeric --buffer-size with a CliArgError", () => {
    expect(() => parseDevArgs(["--buffer-size", "lots"])).toThrow(CliArgError);
  });

  it("rejects a negative --port (not matching the positive-integer pattern)", () => {
    expect(() => parseDevArgs(["--port", "-1"])).toThrow(CliArgError);
  });

  it("rejects a flag with no following value", () => {
    expect(() => parseDevArgs(["--port"])).toThrow(CliArgError);
  });

  it("rejects an unrecognized flag", () => {
    expect(() => parseDevArgs(["--bogus", "1"])).toThrow(CliArgError);
  });
});
