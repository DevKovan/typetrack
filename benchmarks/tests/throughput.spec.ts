import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  type FixtureThroughputRunResult,
  type FixtureThroughputSummary,
  renderThroughputReport,
  summarizeThroughputRuns,
} from "../throughput-utils";
import { FIXTURES, gotoFixtureAndWaitForReady } from "./helpers";

// Cross-library throughput comparison -- Phase 19 issue 005
// (`plan/phase-19-performance-benchmarking/005-cross-library-throughput.md`).
// Extends issue 004's same four fixtures (`../fixtures/*.html`) with each
// one's own `window.__runThroughput(n)`, added directly after that
// fixture's ready callback fires -- see each fixture file's own HTML
// comment, right above its `__runThroughput` definition, for the real,
// installed-package-verified per-library behavior (batches client-side vs.
// one request per call, synchronous vs. promise-returning) that
// `../throughput-utils.ts`'s `renderThroughputReport()` documents in the
// generated results file's own methodology section.
//
// N = 1000 calls per run. Per this issue's scope ("start with 1,000, adjust
// upward if a dry run shows high run-to-run variance"): a dry run at
// N = 1000 across all four fixtures (5 runs each, individual raw
// `elapsedMs` values logged by hand) showed every fixture's 5 runs
// clustered tightly around their own median -- segment.html (496-498ms,
// <0.4% spread) and rudderstack.html (2448-2603ms, ~6% spread) were the
// two doing real synchronous-or-network work per call and still stayed
// well clear of run-to-run noise dominating the signal; typetrack.html
// (0.5-0.6ms) and posthog.html (6.2-6.4ms) were both faster and even
// tighter in absolute terms. Nowhere close to the order-of-magnitude
// swings that would call for raising N, so it was kept at 1000.
const N = 1000;
const RUNS_PER_FIXTURE = 5;

declare global {
  interface Window {
    __runThroughput?: (
      n: number,
    ) => { elapsedMs: number; callsPerSecond: number } | Promise<{ elapsedMs: number; callsPerSecond: number }>;
  }
}

test("measures event-dispatch throughput across all four fixtures (typetrack + 3 vendor SDKs)", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const summaries: FixtureThroughputSummary[] = [];

  for (const fixture of FIXTURES) {
    const runs: FixtureThroughputRunResult[] = [];

    for (let i = 0; i < RUNS_PER_FIXTURE; i++) {
      // Fresh context (and fresh page) per run -- no reuse, same discipline
      // as issue 004's cold-start/memory comparison, so no run inherits
      // another run's in-memory SDK state (e.g. a still-queued/still-
      // in-flight batch from a previous run's `__runThroughput` call).
      const context = await browser.newContext();
      const page = await context.newPage();

      await gotoFixtureAndWaitForReady(page, fixture);

      const result = await page.evaluate(async (n) => {
        if (!window.__runThroughput) {
          throw new Error("window.__runThroughput was not defined by this fixture");
        }
        return await window.__runThroughput(n);
      }, N);

      runs.push(result);
      await context.close();
    }

    const summary = summarizeThroughputRuns(fixture, N, runs);
    summaries.push(summary);

    // Sanity-checks the harness itself produced real, well-formed numbers --
    // not a specific throughput threshold (Design decision 6: no pass/fail
    // threshold on comparative numbers here, same as issue 004).
    expect(summary.medianElapsedMs).toBeGreaterThan(0);
    expect(Number.isFinite(summary.medianElapsedMs)).toBe(true);
    expect(summary.medianCallsPerSecond).toBeGreaterThan(0);
    expect(Number.isFinite(summary.medianCallsPerSecond)).toBe(true);
  }

  const report = renderThroughputReport(summaries);
  const outPath = join(import.meta.dirname, "..", "results", "throughput.md");
  writeFileSync(outPath, report);

  console.log(report);
  console.log(`\nWritten to ${outPath}`);
});
