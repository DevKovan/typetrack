// Correctness-only assertions for `internal.bench.ts` (Phase 19 issue 002)
// -- guards against the benchmark script itself silently breaking (e.g.
// from a future `src/` API-shape change), never a comparative timing
// assertion. Per `plan/phase-19-performance-benchmarking/BRIEF.md` Design
// decision 6, no timing number from `benchmarks/` is trustworthy CI trend
// data, so nothing here asserts on how fast anything ran -- only that each
// config actually constructs and that the memory helper's math is sane.
//
// This file is `bun:test`, not part of the `mitata` run itself -- importing
// `internal.bench.ts` here does not trigger a real mitata run as a side
// effect, since that file gates its `bench()`/`group()`/`run()`
// registration behind `import.meta.main` (see that file's own header
// comment).
import { describe, expect, it } from "bun:test";
import {
  createBaselineAnalytics,
  createFanOutAnalytics,
  createMiddlewareAnalytics,
  createReliabilityAnalytics,
  measureHeapGrowth,
} from "./internal.bench";

describe("internal.bench.ts config builders", () => {
  it("(a) noopProvider-only config constructs without throwing", () => {
    expect(() => createBaselineAnalytics()).not.toThrow();
  });

  it("(b) context + middleware config constructs and registers middleware without throwing", () => {
    expect(() => createMiddlewareAnalytics()).not.toThrow();
  });

  it("(c) reliability:true config constructs without throwing", () => {
    expect(() => createReliabilityAnalytics()).not.toThrow();
  });

  it("(d) multi-provider fan-out config constructs without throwing", () => {
    expect(() => createFanOutAnalytics()).not.toThrow();
  });

  it("every config's track() resolves without throwing", async () => {
    // `track()`'s own return type is `void | Promise<void>` (some configs,
    // e.g. the no-middleware baseline, resolve synchronously) -- `await`ing
    // each call directly (rather than asserting on a `Promise` shape via
    // `.resolves`) works for both, and any synchronous or asynchronous
    // throw still fails this test the normal way.
    const results = await Promise.all([
      createBaselineAnalytics().track("smoke-event", { ok: true }),
      createMiddlewareAnalytics().track("smoke-event", { ok: true }),
      createReliabilityAnalytics().track("smoke-event", { ok: true }),
      createFanOutAnalytics().track("smoke-event", { ok: true }),
    ]);
    expect(results).toHaveLength(4);
  });
});

describe("measureHeapGrowth", () => {
  it("returns a sane, non-negative, finite heap delta for a trivial retaining loop", async () => {
    // Deliberately retains every allocation (pushes onto an outer array
    // that outlives the loop) so the forced-GC bracket can't collect it out
    // from under the measurement -- makes the "non-negative" assertion
    // deterministic rather than dependent on GC timing noise.
    const retained: number[][] = [];

    const result = await measureHeapGrowth(() => {
      retained.push(Array.from({ length: 1000 }, () => 0));
    }, 2000);

    expect(Number.isFinite(result.heapUsedDeltaBytes)).toBe(true);
    expect(result.heapUsedDeltaBytes).toBeGreaterThanOrEqual(0);
    // Sanity check that `retained` is actually what's keeping the delta
    // positive, not an unrelated assertion -- the loop above (plus
    // `measureHeapGrowth`'s own warm-up prefix, which also calls `fn`)
    // allocates at least 2000 * 1000 * 8 bytes (~16 MB) of retained
    // `number[]` data.
    expect(retained.length).toBeGreaterThanOrEqual(2000);
  });

  it("works with an async fn (as track() calls are)", async () => {
    const result = await measureHeapGrowth(async () => {
      await Promise.resolve();
    }, 10);

    expect(Number.isFinite(result.heapUsedDeltaBytes)).toBe(true);
  });
});
