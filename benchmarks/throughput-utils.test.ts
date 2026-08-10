// Unit tests for `throughput-utils.ts`'s pure statistics/formatting logic --
// no browser, no network, no filesystem I/O (the real browser-driven
// measurement lives in `tests/throughput.spec.ts`, exercised as this issue's
// integration test instead).
import { describe, expect, test } from "bun:test";
import { renderThroughputReport, summarizeThroughputRuns } from "./throughput-utils";

describe("summarizeThroughputRuns", () => {
  test("computes the median elapsed ms and calls/sec across every run", () => {
    const result = summarizeThroughputRuns("example", 1000, [
      { elapsedMs: 100, callsPerSecond: 10_000 },
      { elapsedMs: 300, callsPerSecond: 3_333 },
      { elapsedMs: 200, callsPerSecond: 5_000 },
    ]);
    expect(result).toEqual({
      fixture: "example",
      n: 1000,
      runs: 3,
      medianElapsedMs: 200,
      medianCallsPerSecond: 5_000,
    });
  });

  test("averages the two middle values for an even-length runs array", () => {
    const result = summarizeThroughputRuns("example", 1000, [
      { elapsedMs: 100, callsPerSecond: 10_000 },
      { elapsedMs: 200, callsPerSecond: 5_000 },
      { elapsedMs: 300, callsPerSecond: 3_333 },
      { elapsedMs: 400, callsPerSecond: 2_500 },
    ]);
    expect(result.medianElapsedMs).toBe(250);
    expect(result.medianCallsPerSecond).toBe(4_166.5);
  });

  test("throws on an empty runs array", () => {
    expect(() => summarizeThroughputRuns("example", 1000, [])).toThrow(/at least one run/);
  });
});

describe("renderThroughputReport", () => {
  const report = renderThroughputReport([
    { fixture: "typetrack", n: 1000, runs: 5, medianElapsedMs: 1.23, medianCallsPerSecond: 813_008 },
    { fixture: "segment", n: 1000, runs: 5, medianElapsedMs: 456.78, medianCallsPerSecond: 2_189 },
  ]);

  test("includes a methodology & fairness caveats section", () => {
    expect(report).toContain("## Methodology & fairness caveats");
    expect(report).toContain("not measuring the same kind of work");
  });

  test("explains each library's real dispatch/batching behavior", () => {
    expect(report).toContain("noopProvider");
    expect(report).toContain("RequestQueue");
    expect(report).toContain("standard (non-batching) dispatcher");
    expect(report).toContain("/v1/batch");
  });

  test("includes a results table row per fixture, with formatted values", () => {
    expect(report).toContain("| typetrack | 1000 | 1.23 ms | 813,008 |");
    expect(report).toContain("| segment | 1000 | 456.78 ms | 2,189 |");
  });

  test("links back to the stub server and cold-start-memory results by path", () => {
    expect(report).toContain("../stub-server.ts");
    expect(report).toContain("../results/cold-start-memory.md");
  });
});
