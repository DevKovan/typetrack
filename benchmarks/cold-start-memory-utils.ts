// Pure statistics/formatting helpers for Phase 19 issue 004
// (`plan/phase-19-performance-benchmarking/004-cross-library-cold-start-
// memory.md`), factored out of `tests/cold-start-memory.spec.ts` so they can
// be unit-tested (`cold-start-memory-utils.test.ts`) in isolation from real
// browser/network I/O -- same "pure logic exported, `main()`'s I/O gated
// separately" split `bundle-size-report.ts`/`tree-shake-report.ts` (issue
// 003) already use, adapted here for a Playwright spec rather than a
// standalone `main()` script (the real measurement in this issue can only
// happen inside a real browser, i.e. inside the spec itself, not here).

export interface FixtureRunResult {
  coldStartMs: number;
  heapBytes: number | null;
}

export interface FixtureMedianResult {
  fixture: string;
  runs: number;
  medianColdStartMs: number;
  medianHeapBytes: number | null;
}

// Standard median: average of the two middle values for an even-length
// input, the middle value for odd -- deliberately not a mean, since a mean
// is more sensitive to a single slow/GC-paused outlier run, and BRIEF's own
// "at least 5 repeated navigations... to reduce single-run noise" framing
// (issue 004's scope) is explicitly about resisting exactly that kind of
// outlier.
export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error("median() requires at least one value");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

// `heapBytes` is nullable per-run (not every browser/flag combination
// reliably exposes `performance.memory`) -- the median is computed only over
// whatever samples were actually collected, and is itself `null` if none
// were (rather than throwing), so one fixture's missing memory data never
// prevents reporting every other fixture's real numbers.
export function summarizeFixtureRuns(fixture: string, runs: FixtureRunResult[]): FixtureMedianResult {
  if (runs.length === 0) {
    throw new Error(`summarizeFixtureRuns("${fixture}") requires at least one run`);
  }
  const heapSamples = runs.map((run) => run.heapBytes).filter((value): value is number => value !== null);
  return {
    fixture,
    runs: runs.length,
    medianColdStartMs: median(runs.map((run) => run.coldStartMs)),
    medianHeapBytes: heapSamples.length > 0 ? median(heapSamples) : null,
  };
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function formatBytes(bytes: number | null): string {
  return bytes === null ? "n/a" : `${bytes.toLocaleString()} B`;
}

export function renderResultsReport(results: FixtureMedianResult[]): string {
  const lines: string[] = [];
  lines.push("# Cross-library cold-start + memory comparison");
  lines.push("");
  lines.push(
    "Produced by running `cd benchmarks && bun run bench:browser` (Playwright/Chromium, `tests/cold-start-memory.spec.ts`). See `plan/phase-19-performance-benchmarking/BRIEF.md` Design decision 4 for the overall approach.",
  );
  lines.push("");
  lines.push("## Methodology & fairness caveats");
  lines.push("");
  lines.push(
    "- Every fixture (`../fixtures/typetrack.html`, `../fixtures/posthog.html`, `../fixtures/segment.html`, `../fixtures/rudderstack.html`) is measured against this workspace's own local stub server (`../stub-server.ts`, Bun.serve()), never live vendor infrastructure -- no network call in this run leaves `localhost`.",
  );
  lines.push(
    "- Each vendor SDK fixture has its heaviest optional init-time features (autocapture, session recording, feature-flag polling / remote config fetch, destination-plugin auto-loading) explicitly disabled -- the exact options and why are documented in an HTML comment block at the top of each vendor fixture file.",
  );
  lines.push(
    "- **These numbers do not represent each vendor SDK's default, out-of-the-box configuration.** A default-configured install of any of these three SDKs would cost measurably more than what's reported here -- see BRIEF.md's \"Research grounding\" section for why measuring the true default isn't reachable without live vendor infrastructure.",
  );
  lines.push(
    "- Cold-start ms is `window.__readyAt` (`performance.now()` at the moment each fixture's own real ready callback/promise fires), captured from a fresh browser context (no reuse) for every single navigation, per fixture, and reduced via median across all runs.",
  );
  lines.push(
    "- Heap bytes is `performance.memory.usedJSHeapSize` (Chromium launched with `--enable-precise-memory-info`, see `../playwright.config.ts`), sampled once `window.__ready` is observed, same fresh-context-per-run methodology.",
  );
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| Library | Runs | Median cold-start | Median heap |");
  lines.push("|---|---|---|---|");
  for (const result of results) {
    lines.push(
      `| ${result.fixture} | ${result.runs} | ${formatMs(result.medianColdStartMs)} | ${formatBytes(result.medianHeapBytes)} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}
