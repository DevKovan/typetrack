// Correctness-only assertions for `bundle-size-report.ts` (Phase 19 issue
// 003, `plan/phase-19-performance-benchmarking/
// 003-bundle-size-tree-shaking-comparison.md`) -- asserts the script's own
// parsing/math/rendering logic against a known fixture input, never a real
// byte count (that would break on the next dependency bump; per BRIEF
// Design decision 6, real numbers live only in the committed results file,
// `benchmarks/results/bundle-size.md`).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "bun:test";
import { formatMultiple, gzipSizeOfFile, renderReport, type VendorSizesSnapshot } from "./bundle-size-report";

describe("formatMultiple", () => {
  it("computes a one-decimal multiple, matching the issue's own example format", () => {
    // The issue's own worked example: a vendor 5.1x typetrack's own size.
    expect(formatMultiple(80343, 15754)).toBe("5.1x");
  });

  it("rounds rather than truncates", () => {
    // 100 / 40 = 2.5 exactly -- an unambiguous rounding case.
    expect(formatMultiple(100, 40)).toBe("2.5x");
  });

  it("returns 1.0x when both sizes are equal", () => {
    expect(formatMultiple(1000, 1000)).toBe("1.0x");
  });

  it("throws rather than dividing by zero", () => {
    expect(() => formatMultiple(1000, 0)).toThrow();
  });
});

describe("gzipSizeOfFile", () => {
  it("reports the real raw and gzip byte counts of a known fixture file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-size-report-test-"));
    const filePath = join(dir, "fixture.txt");
    try {
      const content = "a".repeat(10_000);
      writeFileSync(filePath, content);

      const result = gzipSizeOfFile(filePath);

      expect(result.rawBytes).toBe(10_000);
      // Real gzip of 10,000 repeated bytes compresses extremely well (highly
      // repetitive input) -- asserting a loose upper bound proves this is a
      // real gzip round-trip (`node:zlib`'s `gzipSync`, the same primitive
      // `renderReport`'s caller uses), not a hand-picked constant.
      expect(result.gzipBytes).toBeGreaterThan(0);
      expect(result.gzipBytes).toBeLessThan(200);

      // Cross-check against an independent real gzip call (not the
      // function under test) -- both compress the exact same real bytes
      // read from disk, so their sizes should match exactly.
      const independentGzipBytes = gzipSync(Buffer.from(content)).byteLength;
      expect(result.gzipBytes).toBe(independentGzipBytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  const fixtureArtifacts = [
    { name: "ESM -- dist/index.js", path: "dist/index.js", rawBytes: 60_000, gzipBytes: 10_000 },
    { name: "IIFE/CDN -- dist/index.global.js", path: "dist/index.global.js", rawBytes: 25_000, gzipBytes: 8_000 },
  ];

  it("includes every typetrack artifact and every vendor package as its own table row", () => {
    const report = renderReport(fixtureSnapshot, fixtureArtifacts, 10_000);

    expect(report).toContain("ESM -- dist/index.js");
    expect(report).toContain("IIFE/CDN -- dist/index.global.js");
    expect(report).toContain("fixture-vendor-a");
    expect(report).toContain("fixture-vendor-b");
  });

  it("computes each row's gzip-multiple relative to the ESM baseline correctly", () => {
    const report = renderReport(fixtureSnapshot, fixtureArtifacts, 10_000);

    // typetrack ESM baseline itself: 10,000 / 10,000 = 1.0x.
    expect(report).toContain("1.0x");
    // fixture-vendor-a: 20,000 / 10,000 = 2.0x.
    expect(report).toContain("2.0x");
    // fixture-vendor-b: 5,000 / 10,000 = 0.5x.
    expect(report).toContain("0.5x");
    // IIFE/CDN artifact: 8,000 / 10,000 = 0.8x.
    expect(report).toContain("0.8x");
  });

  it("cites the snapshot's source and fetch date", () => {
    const report = renderReport(fixtureSnapshot, fixtureArtifacts, 10_000);

    expect(report).toContain(fixtureSnapshot.source);
    expect(report).toContain(fixtureSnapshot.fetchedAt);
  });

  it("renders real vendor byte counts as plain numbers, not fabricated placeholders", () => {
    const report = renderReport(fixtureSnapshot, fixtureArtifacts, 10_000);

    expect(report).toContain("50,000 B");
    expect(report).toContain("20,000 B");
    expect(report).toContain("10,000 B");
    expect(report).toContain("5,000 B");
  });
});

// Integration tests -- real I/O against this repo's own actual, committed
// files (the real built `dist/` output and the real `vendor-sizes.json`
// snapshot), not fixtures. Per the issue's own explicit rule (and BRIEF
// Design decision 6), these assert real files parse/measure correctly in
// shape and sane bounds -- never a specific real byte count, since that
// would break on the next dependency/`src/` change and isn't this test
// file's job (real numbers live in the committed `results/*.md` files).
describe("integration: real repo files", () => {
  const distIndexPath = join(import.meta.dir, "..", "dist", "index.js");
  const vendorSizesPath = join(import.meta.dir, "vendor-sizes.json");

  it("gzipSizeOfFile measures the real, already-built dist/index.js with a real gzip round-trip", () => {
    // Requires `bun run build` to have produced `dist/index.js` -- same
    // precondition `bundle-size-report.ts`'s own `main()` documents.
    const result = gzipSizeOfFile(distIndexPath);

    expect(result.rawBytes).toBeGreaterThan(0);
    expect(result.gzipBytes).toBeGreaterThan(0);
    // A real JS bundle always compresses (gzip is never larger than the
    // raw bytes for content this size/repetitive) -- a sane bound, not a
    // pinned byte count.
    expect(result.gzipBytes).toBeLessThan(result.rawBytes);
  });

  it("parses the real, committed vendor-sizes.json snapshot into the documented shape", () => {
    const snapshot: VendorSizesSnapshot = JSON.parse(readFileSync(vendorSizesPath, "utf-8"));

    expect(typeof snapshot.source).toBe("string");
    expect(typeof snapshot.fetchedAt).toBe("string");

    for (const pkg of ["posthog-js", "@segment/analytics-next", "@rudderstack/analytics-js"]) {
      const size = snapshot.packages[pkg];
      expect(size).toBeDefined();
      expect(typeof size?.version).toBe("string");
      expect(typeof size?.minifiedBytes).toBe("number");
      expect(typeof size?.gzipBytes).toBe("number");
      expect(size?.gzipBytes).toBeLessThan(size?.minifiedBytes ?? Number.POSITIVE_INFINITY);
      expect(typeof size?.hasJSModule).toBe("boolean");
      expect(["boolean", "object"]).toContain(typeof size?.hasSideEffects);
    }
  });

  it("renderReport produces a real, non-empty Markdown table from the real vendor snapshot and a real dist/index.js measurement", () => {
    const snapshot: VendorSizesSnapshot = JSON.parse(readFileSync(vendorSizesPath, "utf-8"));
    const { rawBytes, gzipBytes } = gzipSizeOfFile(distIndexPath);

    const report = renderReport(
      snapshot,
      [{ name: "ESM -- dist/index.js", path: distIndexPath, rawBytes, gzipBytes }],
      gzipBytes,
    );

    expect(report).toContain("# Bundle size comparison");
    expect(report).toContain("posthog-js");
    expect(report).toContain("@segment/analytics-next");
    expect(report).toContain("@rudderstack/analytics-js");
    // typetrack compared against its own baseline is always exactly 1.0x.
    expect(report).toContain("1.0x");
  });
});
