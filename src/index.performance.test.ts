// Phase 16 issue 005: a narrow performance *regression* smoke test, not the
// comparative benchmarking suite Phase 19 owns (see
// `plan/phase-16-testing-infrastructure/BRIEF.md`'s Design decision 3 and
// `plan/phase-16-testing-infrastructure/005-performance-smoke-tests.md`).
// Plain `performance.now()` timing inside `bun:test` -- no new dependency.
//
// Both cases use `noopProvider` with no middleware/routing/reliability/
// context/schemas enabled, so the measured cost is core's own
// `createAnalytics()`/`track()` dispatch overhead, not a provider's, Zod's,
// or any optional feature's.
//
// Thresholds below were derived empirically (see the two comments further
// down for the observed local numbers), then set at 0.1ms/call for both --
// ~100-300x the observed local average, not just the 5-10x floor the issue
// names as a minimum. A tighter multiplier (e.g. ~12-14x, which was this
// file's first draft) was verified during QA to leave as little as ~1.35x
// headroom under a simulated loaded-CI scenario (heavy parallel load +
// slower hardware combined) -- comfortably within range of a single GC
// pause (routinely 10-100 microseconds) tripping a false failure. 0.1ms is
// still "well under 1ms/call" per this issue's own guidance, while keeping
// real margin even on a genuinely loaded CI runner.
import { describe, expect, it } from "bun:test";
import { createAnalytics, noopProvider } from "./index";

// Small warm-up prefix discarded before timing starts, standard
// microbenchmarking practice to avoid JIT warm-up skewing the measured
// average -- observed to make the very first few iterations of each loop
// noticeably slower than steady state.
const WARMUP_ITERATIONS = 100;
const TIMED_ITERATIONS = 1000;

// Observed locally (Apple Silicon, `bun test`, 10 repeated runs): average
// ~0.0008ms/call, remarkably stable run to run.
const CONSTRUCTION_AVG_THRESHOLD_MS = 0.1;

// Observed locally: average ~0.00035ms/call, similarly stable.
const TRACK_AVG_THRESHOLD_MS = 0.1;

describe("performance smoke tests", () => {
  it("createAnalytics() construction stays within a generous per-call time budget", () => {
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      createAnalytics({ provider: noopProvider });
    }

    const start = performance.now();
    for (let i = 0; i < TIMED_ITERATIONS; i++) {
      createAnalytics({ provider: noopProvider });
    }
    const elapsedMs = performance.now() - start;
    const avgMs = elapsedMs / TIMED_ITERATIONS;

    expect(avgMs).toBeLessThan(CONSTRUCTION_AVG_THRESHOLD_MS);
  });

  it("track() dispatch stays within a generous per-call time budget", async () => {
    // Constructed once, outside the timed loop -- this measures dispatch
    // cost per call, not construction cost (that's the test above).
    const analytics = createAnalytics({ provider: noopProvider });

    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      await analytics.track("event");
    }

    const start = performance.now();
    for (let i = 0; i < TIMED_ITERATIONS; i++) {
      await analytics.track("event");
    }
    const elapsedMs = performance.now() - start;
    const avgMs = elapsedMs / TIMED_ITERATIONS;

    expect(avgMs).toBeLessThan(TRACK_AVG_THRESHOLD_MS);
  });
});
