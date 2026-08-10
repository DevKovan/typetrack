// Correctness-only assertions for `tree-shake-report.ts` (Phase 19 issue
// 003, Part B) -- pure-logic unit tests for the percentage-reduction math
// and Markdown rendering against known fixture input, plus a real
// integration test that actually invokes `esbuild` (via `bunx esbuild`,
// same as the production script) to bundle+minify the real
// `tree-shake-fixture/entry.ts` and measures its real output -- not
// asserting a specific real byte count (that would break on the next
// `typetrack` dependency change; real numbers live only in the committed
// `benchmarks/results/tree-shaking.md`), only that a real build actually
// happened and produced a plausibly-smaller-than-the-full-build result.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { gzipSizeOfFile, type VendorSizesSnapshot } from "./bundle-size-report";
import { buildFixture, formatPercentReduction, renderReport } from "./tree-shake-report";

describe("formatPercentReduction", () => {
  it("computes a one-decimal percentage reduction", () => {
    // Fixture is 40% the size of the full build -> 60% reduction.
    expect(formatPercentReduction(4000, 10_000)).toBe("60.0%");
  });

  it("returns 0.0% when the fixture is exactly the same size as the full build", () => {
    expect(formatPercentReduction(10_000, 10_000)).toBe("0.0%");
  });

  it("throws rather than dividing by zero", () => {
    expect(() => formatPercentReduction(100, 0)).toThrow();
  });
});

describe("renderReport", () => {
  const fixtureSnapshot: VendorSizesSnapshot = {
    source: "https://bundlephobia.com/api/size?package=<name>",
    fetchedAt: "2026-01-01",
    packages: {
      "fixture-vendor-a": { version: "1.0.0", minifiedBytes: 50_000, gzipBytes: 20_000, hasSideEffects: true, hasJSModule: true },
      "fixture-vendor-b": { version: "2.0.0", minifiedBytes: 10_000, gzipBytes: 5_000, hasSideEffects: false, hasJSModule: true },
    },
  };

  it("includes the real measured percentage reduction, computed from the given sizes", () => {
    const report = renderReport({ rawBytes: 3000, gzipBytes: 4000 }, { rawBytes: 68_000, gzipBytes: 16_000 }, fixtureSnapshot);

    expect(report).toContain(formatPercentReduction(4000, 16_000));
  });

  it("reports each vendor's hasSideEffects value and a bundler-tree-shakability implication", () => {
    const report = renderReport({ rawBytes: 3000, gzipBytes: 4000 }, { rawBytes: 68_000, gzipBytes: 16_000 }, fixtureSnapshot);

    expect(report).toContain("fixture-vendor-a");
    expect(report).toContain("fixture-vendor-b");
    // vendor-a: hasSideEffects true -> "cannot safely eliminate" implication.
    expect(report).toContain("cannot safely eliminate unused exports");
    // vendor-b: hasSideEffects false -> "safely eliminate" implication.
    expect(report).toContain("side-effect-free");
  });

  it("cites src/index.ts's export-list evidence for why tree-shaking works", () => {
    const report = renderReport({ rawBytes: 3000, gzipBytes: 4000 }, { rawBytes: 68_000, gzipBytes: 16_000 }, fixtureSnapshot);

    expect(report).toContain("separate named export");
  });
});

describe("integration: real esbuild build of the real fixture", () => {
  it("buildFixture() actually invokes esbuild and produces a real, non-empty, minified file smaller than the full dist/index.js build", () => {
    buildFixture();

    const fixtureOutFile = join(import.meta.dir, "tree-shake-fixture", "dist", "entry.min.js");
    expect(existsSync(fixtureOutFile)).toBe(true);

    const fixtureContents = readFileSync(fixtureOutFile, "utf-8");
    // `createAnalytics`'s own implementation is a large, monolithic
    // function (not split into further tree-shakeable pieces) -- a real
    // bundle of it is substantial, not near-empty. A near-empty/broken
    // build (e.g. esbuild silently resolving to a stub) would fail this
    // bound.
    expect(fixtureContents.length).toBeGreaterThan(1000);

    const fixtureGzip = gzipSizeOfFile(fixtureOutFile);
    const fullBuildPath = join(import.meta.dir, "..", "dist", "index.js");
    const fullGzip = gzipSizeOfFile(fullBuildPath);

    expect(fixtureGzip.gzipBytes).toBeGreaterThan(0);
    expect(fixtureGzip.gzipBytes).toBeLessThan(fullGzip.gzipBytes);
  });
});
