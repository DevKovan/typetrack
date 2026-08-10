// Tree-shaking measurement for Phase 19 issue 003
// (`plan/phase-19-performance-benchmarking/
// 003-bundle-size-tree-shaking-comparison.md`, Part B). Builds
// `tree-shake-fixture/entry.ts` (imports only `createAnalytics` +
// `noopProvider` from the real installed `typetrack` package -- nothing
// else) with `esbuild` (bundled + minified), measures its real gzip size,
// and compares it against the full `dist/index.js` gzip size to produce a
// real, measured percentage reduction -- not an estimate.
//
// Uses `bunx esbuild` (confirmed reachable without adding a new root/
// `benchmarks` `package.json` dependency -- `bunx` fetches and caches the
// binary on demand, the same way `bunx playwright install` already works
// elsewhere in this repo's tooling, without writing to `package.json` or
// `bun.lock`) rather than going through `tsup`, since `tsup`'s own
// `defineConfig` shape is tuned for building `typetrack` itself (multiple
// entries, a CLI shebang plugin, a `.d.ts` pass) and a single ad-hoc
// bundle+minify of one fixture file is exactly esbuild's own plain CLI use
// case -- `tsup` would still shell out to the same esbuild binary
// underneath for this.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSizeOfFile, type VendorSizesSnapshot } from "./bundle-size-report";

const fixtureDir = join(import.meta.dir, "tree-shake-fixture");
const fixtureEntry = join(fixtureDir, "entry.ts");
const fixtureOutDir = join(fixtureDir, "dist");
const fixtureOutFile = join(fixtureOutDir, "entry.min.js");
const fullBuildPath = join(import.meta.dir, "..", "dist", "index.js");

export function buildFixture(): void {
  mkdirSync(fixtureOutDir, { recursive: true });
  const result = spawnSync(
    "bunx",
    ["esbuild", fixtureEntry, "--bundle", "--minify", "--format=esm", "--platform=browser", `--outfile=${fixtureOutFile}`],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`esbuild failed (exit ${result.status}):\n${result.stderr}`);
  }
}

// Rounds to one decimal place, e.g. `0.6234` -> `"62.3%"`.
export function formatPercentReduction(fixtureGzipBytes: number, fullGzipBytes: number): string {
  if (fullGzipBytes === 0) {
    throw new Error("fullGzipBytes must be non-zero to compute a percentage reduction");
  }
  const reduction = 1 - fixtureGzipBytes / fullGzipBytes;
  return `${(reduction * 100).toFixed(1)}%`;
}

export function renderReport(
  fixture: { rawBytes: number; gzipBytes: number },
  full: { rawBytes: number; gzipBytes: number },
  vendorSnapshot: VendorSizesSnapshot,
): string {
  const lines: string[] = [];
  lines.push("# Tree-shaking comparison");
  lines.push("");
  lines.push(
    "Produced by running `cd benchmarks && bun run tree-shake-report.ts`. Part 1 is a real, measured build; Part 2 is static inspection only (see `plan/phase-19-performance-benchmarking/BRIEF.md` Design decision 7 -- no vendor SDK minimal-import fixture is built).",
  );
  lines.push("");
  lines.push("## Part 1 -- typetrack's own minimal-import fixture (measured)");
  lines.push("");
  lines.push(
    "`benchmarks/tree-shake-fixture/entry.ts` imports **only** `createAnalytics` and `noopProvider` from the real, installed `typetrack` package (this workspace's own `node_modules/typetrack`, a `file:..` dependency resolving to the actually-built `dist/` output) -- no middleware, no plugins, no schemas. Bundled + minified with `esbuild` (`--bundle --minify --format=esm --platform=browser`), then gzip'd, and compared against the full `dist/index.js` gzip size (same measurement as `benchmarks/results/bundle-size.md`).",
  );
  lines.push("");
  lines.push("| Build | Raw (minified) | Gzip |");
  lines.push("|---|---|---|");
  lines.push(`| Minimal fixture (\`createAnalytics\` + \`noopProvider\` only) | ${fixture.rawBytes.toLocaleString()} B | ${fixture.gzipBytes.toLocaleString()} B |`);
  lines.push(`| Full \`dist/index.js\` (everything exported) | ${full.rawBytes.toLocaleString()} B | ${full.gzipBytes.toLocaleString()} B |`);
  lines.push("");
  lines.push(
    `Importing only \`createAnalytics\` + \`noopProvider\` produces a gzipped bundle **${formatPercentReduction(fixture.gzipBytes, full.gzipBytes)} smaller** than importing everything typetrack exports, because every middleware, plugin, and provider-adapter helper is a separate named export in \`src/index.ts\` (e.g. \`export { redactMiddleware } from "./middleware/redact"\`, \`export { autoPage } from "./plugins/autoPage"\`, and so on through that file's full export list) that a tree-shaking bundler can statically eliminate when unused -- this is a measured number, not a claim (mirrors \`docs/performance.md\`'s existing "What's free when unused" section).`,
  );
  lines.push("");
  lines.push("## Part 2 -- vendor SDKs (static inspection only, no build attempted)");
  lines.push("");
  lines.push(
    `Source: ${vendorSnapshot.source}, fetched ${vendorSnapshot.fetchedAt} (see \`benchmarks/vendor-sizes.json\`). Per BRIEF Design decision 7, no minimal-import fixture is built against any vendor SDK -- these are whole-SDK browser libraries with side-effectful global initialization by design (feature-flag fetches, autocapture wiring, session-recording setup, etc. at import/init time), and forcing a "minimal import" through them would test something fictional, not how any real app actually uses them.`,
  );
  lines.push("");
  lines.push("| Package | `hasSideEffects` | Implication |");
  lines.push("|---|---|---|");
  for (const [pkg, size] of Object.entries(vendorSnapshot.packages)) {
    const implication =
      size.hasSideEffects === true
        ? "A bundler cannot safely eliminate unused exports from this package without it explicitly opting in via a `sideEffects` allowlist in its own `package.json` -- unused imports are not guaranteed to be tree-shaken."
        : size.hasSideEffects === false
          ? "Declares itself side-effect-free -- a bundler can safely eliminate unused exports."
          : "`hasSideEffects` unknown/unreported -- a bundler must conservatively assume the package may have side effects, the same practical outcome as `true`.";
    lines.push(`| \`${pkg}\` | ${String(size.hasSideEffects)} | ${implication} |`);
  }
  lines.push("");

  return lines.join("\n");
}

function main(): void {
  buildFixture();

  const fixture = gzipSizeOfFile(fixtureOutFile);
  const full = gzipSizeOfFile(fullBuildPath);

  const snapshotPath = join(import.meta.dir, "vendor-sizes.json");
  const vendorSnapshot: VendorSizesSnapshot = JSON.parse(readFileSync(snapshotPath, "utf-8"));

  const report = renderReport(fixture, full, vendorSnapshot);

  const outPath = join(import.meta.dir, "results", "tree-shaking.md");
  writeFileSync(outPath, report);
  console.log(report);
  console.log(`\nWritten to ${outPath}`);
}

if (import.meta.main) {
  main();
}
