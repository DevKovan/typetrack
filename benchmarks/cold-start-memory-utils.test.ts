// Unit tests for `cold-start-memory-utils.ts`'s pure statistics/formatting
// logic -- no browser, no network, no filesystem I/O (the real
// browser-driven measurement lives in `tests/cold-start-memory.spec.ts`,
// exercised as this issue's integration test instead).
import { describe, expect, test } from "bun:test";
import { median, renderResultsReport, summarizeFixtureRuns } from "./cold-start-memory-utils";

describe("median", () => {
  test("returns the middle value for an odd-length array", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  test("averages the two middle values for an even-length array", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  test("returns the value itself for a single-element array", () => {
    expect(median([42])).toBe(42);
  });

  test("does not mutate the input array", () => {
    const values = [5, 1, 3];
    median(values);
    expect(values).toEqual([5, 1, 3]);
  });

  test("throws on an empty array rather than returning NaN silently", () => {
    expect(() => median([])).toThrow(/at least one value/);
  });
});

describe("summarizeFixtureRuns", () => {
  test("computes the median cold-start and heap across every run", () => {
    const result = summarizeFixtureRuns("example", [
      { coldStartMs: 10, heapBytes: 1000 },
      { coldStartMs: 30, heapBytes: 3000 },
      { coldStartMs: 20, heapBytes: 2000 },
    ]);
    expect(result).toEqual({
      fixture: "example",
      runs: 3,
      medianColdStartMs: 20,
      medianHeapBytes: 2000,
    });
  });

  test("reports a null median heap when every run's heap sample is null", () => {
    const result = summarizeFixtureRuns("example", [
      { coldStartMs: 10, heapBytes: null },
      { coldStartMs: 20, heapBytes: null },
    ]);
    expect(result.medianHeapBytes).toBeNull();
  });

  test("computes the heap median only over the runs that did report a sample", () => {
    const result = summarizeFixtureRuns("example", [
      { coldStartMs: 10, heapBytes: 1000 },
      { coldStartMs: 20, heapBytes: null },
      { coldStartMs: 30, heapBytes: 3000 },
    ]);
    expect(result.medianHeapBytes).toBe(2000);
  });

  test("throws on an empty runs array", () => {
    expect(() => summarizeFixtureRuns("example", [])).toThrow(/at least one run/);
  });
});

describe("renderResultsReport", () => {
  const report = renderResultsReport([
    { fixture: "typetrack", runs: 5, medianColdStartMs: 1.23, medianHeapBytes: 1_000_000 },
    { fixture: "posthog", runs: 5, medianColdStartMs: 12.34, medianHeapBytes: null },
  ]);

  test("includes a methodology & fairness caveats section", () => {
    expect(report).toContain("## Methodology & fairness caveats");
    expect(report).toContain("do not represent each vendor SDK's default");
  });

  test("includes a results table row per fixture, with formatted values", () => {
    expect(report).toContain("| typetrack | 5 | 1.23 ms | 1,000,000 B |");
    expect(report).toContain("| posthog | 5 | 12.34 ms | n/a |");
  });

  test("links back to the stub server and fixture files by path", () => {
    expect(report).toContain("../stub-server.ts");
    expect(report).toContain("../fixtures/typetrack.html");
    expect(report).toContain("../fixtures/posthog.html");
    expect(report).toContain("../fixtures/segment.html");
    expect(report).toContain("../fixtures/rudderstack.html");
  });
});
