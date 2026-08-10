import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  type FixtureMedianResult,
  type FixtureRunResult,
  renderResultsReport,
  summarizeFixtureRuns,
} from "../cold-start-memory-utils";
import { FIXTURES, gotoFixtureAndWaitForReady } from "./helpers";

// Cross-library cold-start + memory comparison -- Phase 19 issue 004
// (`plan/phase-19-performance-benchmarking/004-cross-library-cold-start-
// memory.md`). See each fixture file's own top-of-file HTML comment for
// exactly which optional features are disabled per vendor SDK and why, and
// `../cold-start-memory-utils.ts` for the pure median/report-formatting
// logic this spec calls (exercised in isolation by
// `../cold-start-memory-utils.test.ts`).
//
// Memory-capture method: `performance.memory.usedJSHeapSize`, not a CDP
// `Performance.getMetrics()`/`Runtime.getHeapUsage()` session. Confirmed by
// hand (temporarily logging both side by side against this same set of
// fixtures) that `performance.memory.usedJSHeapSize` returns a real,
// distinctly different value per fixture (materially larger for
// `posthog.html` -- the largest of the three vendor bundles per
// `../results/bundle-size.md` -- than for `typetrack.html`) once Chromium is
// launched with `--enable-precise-memory-info` (`../playwright.config.ts`'s
// `launchOptions.args`) -- without that flag, Chromium quantizes the value
// into large fixed buckets that don't move between fixtures at all, which
// would make a comparison meaningless. `Runtime.getHeapUsage()` was also
// tried by hand via `page.context().newCDPSession(page)` and returns a real
// number too, but it's a *process-wide* V8 isolate figure (shared across
// whatever else Chromium's renderer process is doing), not scoped to this
// page's own document the way `performance.memory` is -- `performance.memory`
// is the more direct, standard measurement for "how much heap does this one
// page's own script use," so it's what's used below.
//
// Each fixture is measured across `RUNS_PER_FIXTURE` (>= 5, per issue 004's
// scope) completely fresh browser *contexts* -- not page reloads inside one
// shared context -- so no fixture run inherits another run's cookies/
// storage/in-memory SDK state. Note this does not fully eliminate the
// browser *process*'s own V8 code cache: the very first navigation to a
// given fixture's script in this run may include one-time bytecode-compile
// cost subsequent same-process navigations to that same script skip. That
// effect is identical across all four fixtures within a single spec run
// (every fixture gets the same "first navigation may be relatively slower"
// treatment), so it does not bias the *cross-library* comparison this issue
// cares about, only the absolute numbers slightly below a genuine
// once-ever "first visit."
const RUNS_PER_FIXTURE = 5;

test("measures cold-start time and JS heap size across all four fixtures (typetrack + 3 vendor SDKs)", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const summaries: FixtureMedianResult[] = [];
  // Populated across every run of every fixture below -- asserted against
  // once, at the very end, so a single failure message reports every
  // offending request rather than aborting the whole 20-navigation run at
  // the first one. This is this spec's own programmatic version of this
  // issue's "no network calls leaving localhost" acceptance criterion,
  // rather than relying solely on a by-hand check.
  const nonLocalRequestUrls: string[] = [];

  for (const fixture of FIXTURES) {
    const runs: FixtureRunResult[] = [];

    for (let i = 0; i < RUNS_PER_FIXTURE; i++) {
      // Fresh context (and fresh page) per run -- no reuse, matching issue
      // 004's scope ("fresh page context each time, no reuse") so no run
      // inherits another run's localStorage/cookies/in-memory SDK state.
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on("request", (request) => {
        const hostname = new URL(request.url()).hostname;
        if (hostname !== "localhost" && hostname !== "127.0.0.1") {
          nonLocalRequestUrls.push(`${fixture}.html: ${request.url()}`);
        }
      });

      await gotoFixtureAndWaitForReady(page, fixture);

      const result = await page.evaluate(() => ({
        coldStartMs: window.__readyAt as number,
        heapBytes: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
      }));

      runs.push(result);
      await context.close();
    }

    const summary = summarizeFixtureRuns(fixture, runs);
    summaries.push(summary);

    // Sanity-checks the harness itself produced real, well-formed numbers --
    // not a specific timing/memory threshold (Design decision 6: no
    // pass/fail threshold on comparative numbers here).
    expect(summary.medianColdStartMs).toBeGreaterThan(0);
    expect(Number.isFinite(summary.medianColdStartMs)).toBe(true);
    if (summary.medianHeapBytes !== null) {
      expect(summary.medianHeapBytes).toBeGreaterThan(0);
    }
  }

  expect(nonLocalRequestUrls).toEqual([]);

  const report = renderResultsReport(summaries);
  const outPath = join(import.meta.dirname, "..", "results", "cold-start-memory.md");
  writeFileSync(outPath, report);

  console.log(report);
  console.log(`\nWritten to ${outPath}`);
});
