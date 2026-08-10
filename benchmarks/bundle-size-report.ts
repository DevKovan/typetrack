// Bundle-size comparison report for Phase 19 issue 003
// (`plan/phase-19-performance-benchmarking/
// 003-bundle-size-tree-shaking-comparison.md`, Part A). Reads the committed,
// dated `vendor-sizes.json` snapshot (Design decision 5 -- not re-fetched
// live here), measures typetrack's own real, already-built `dist/index.js`
// (ESM) and `dist/index.global.js` (IIFE/CDN) gzip sizes directly from disk
// (not `.size-limit.json`'s *budget* numbers -- the real built output, same
// as this phase's BRIEF did by hand), and renders a Markdown comparison
// table to `benchmarks/results/bundle-size.md`.
//
// Pure formatting/parsing functions are exported (not gated behind
// `import.meta.main`) so `bundle-size-report.test.ts` can exercise their
// correctness against a known fixture input without this script's own
// `main()` (which touches the real filesystem) running as an import side
// effect -- same pattern as `internal.bench.ts`.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

export interface VendorPackageSize {
  version: string;
  minifiedBytes: number;
  gzipBytes: number;
  hasSideEffects: boolean | null;
  hasJSModule: boolean;
}

export interface VendorSizesSnapshot {
  source: string;
  fetchedAt: string;
  packages: Record<string, VendorPackageSize>;
}

export interface TypetrackArtifactSize {
  name: string;
  path: string;
  rawBytes: number;
  gzipBytes: number;
}

// Real gzip of the actual built file bytes on disk -- `Bun.gzipSync`/
// `zlib.gzipSync` both implement the same DEFLATE-based gzip format `gzip -c`
// does, but calling the Node/Bun-compatible `node:zlib` API in-process
// avoids a child-process shell-out for a measurement this small, and is
// exercised (via a real gzip round-trip) by this file's own unit test below.
export function gzipSizeOfFile(path: string): { rawBytes: number; gzipBytes: number } {
  const contents = readFileSync(path);
  return { rawBytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength };
}

// Rounds to one decimal place, e.g. `5.123` -> `"5.1x"` -- matches the
// issue's own example format ("5.1x" for a vendor 5.1 times typetrack's core
// ESM gzip size).
export function formatMultiple(vendorGzipBytes: number, typetrackGzipBytes: number): string {
  if (typetrackGzipBytes === 0) {
    throw new Error("typetrackGzipBytes must be non-zero to compute a multiple");
  }
  return `${(vendorGzipBytes / typetrackGzipBytes).toFixed(1)}x`;
}

function formatBytes(bytes: number): string {
  return bytes.toLocaleString();
}

export function renderReport(
  snapshot: VendorSizesSnapshot,
  typetrackArtifacts: TypetrackArtifactSize[],
  esmBaselineGzipBytes: number,
): string {
  const lines: string[] = [];
  lines.push("# Bundle size comparison");
  lines.push("");
  lines.push(
    `Produced by running \`cd benchmarks && bun run bundle-size-report.ts\`. Vendor numbers sourced from ${snapshot.source}, fetched ${snapshot.fetchedAt} (see \`benchmarks/vendor-sizes.json\`, Design decision 5 -- a dated snapshot, not re-fetched live). typetrack's own numbers are measured directly from this repo's real, already-built \`dist/\` output (\`bun run build\`, then gzip'd in-process), not \`.size-limit.json\`'s budget numbers.`,
  );
  lines.push("");
  lines.push("| Package | Version | Minified (raw) | Minified+gzip | gzip vs. typetrack core ESM |");
  lines.push("|---|---|---|---|---|");

  for (const artifact of typetrackArtifacts) {
    lines.push(
      `| \`typetrack\` (${artifact.name}) | (workspace) | ${formatBytes(artifact.rawBytes)} B | ${formatBytes(artifact.gzipBytes)} B | ${formatMultiple(artifact.gzipBytes, esmBaselineGzipBytes)} |`,
    );
  }

  for (const [pkg, size] of Object.entries(snapshot.packages)) {
    lines.push(
      `| \`${pkg}\` | ${size.version} | ${formatBytes(size.minifiedBytes)} B | ${formatBytes(size.gzipBytes)} B | ${formatMultiple(size.gzipBytes, esmBaselineGzipBytes)} |`,
    );
  }

  lines.push("");
  lines.push(
    "The last column expresses every row's gzip size as a multiple of typetrack's own core ESM (`dist/index.js`) gzip size -- e.g. \"5.1x\" means that row is 5.1 times larger, gzipped, than typetrack's core build.",
  );
  lines.push("");

  return lines.join("\n");
}

const distDir = join(import.meta.dir, "..", "dist");

function main(): void {
  const snapshotPath = join(import.meta.dir, "vendor-sizes.json");
  const snapshot: VendorSizesSnapshot = JSON.parse(readFileSync(snapshotPath, "utf-8"));

  const esmPath = join(distDir, "index.js");
  const iifePath = join(distDir, "index.global.js");

  // `dist/` must already reflect the current `src/` (run `bun run build` at
  // the repo root first) -- this script measures whatever is actually on
  // disk, it does not rebuild it itself, mirroring `.size-limit.json`'s own
  // "no re-bundling, checks already-built output" behavior.
  statSync(esmPath);
  statSync(iifePath);

  const esm = gzipSizeOfFile(esmPath);
  const iife = gzipSizeOfFile(iifePath);

  const artifacts: TypetrackArtifactSize[] = [
    { name: "ESM -- dist/index.js", path: esmPath, rawBytes: esm.rawBytes, gzipBytes: esm.gzipBytes },
    { name: "IIFE/CDN -- dist/index.global.js", path: iifePath, rawBytes: iife.rawBytes, gzipBytes: iife.gzipBytes },
  ];

  const report = renderReport(snapshot, artifacts, esm.gzipBytes);

  const outPath = join(import.meta.dir, "results", "bundle-size.md");
  writeFileSync(outPath, report);
  console.log(report);
  console.log(`\nWritten to ${outPath}`);
}

if (import.meta.main) {
  main();
}
