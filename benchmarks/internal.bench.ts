// typetrack's own cold-start/throughput/memory benchmarks -- Phase 19 issue
// 002 (`plan/phase-19-performance-benchmarking/002-internal-mitata-benchmarks.md`).
//
// This is a *measurement* script, run on demand (`bun run bench`), never a
// CI gate -- see BRIEF.md Design decisions 1 and 6. It is not a replacement
// for `src/index.performance.test.ts` (Phase 16's regression guard, which
// stays exactly as-is): that file asserts two generous, non-comparative
// per-call time budgets inside `bun test`; this script instead reports
// real, precise, comparative-across-config numbers via `mitata` -- cold
// start, throughput, and memory, across a representative matrix of
// `createAnalytics()` configs, with no pass/fail threshold anywhere.
//
// `mitata`'s own current published API (confirmed by reading
// `node_modules/mitata/readme.md` and `src/main.d.mts` directly, not
// assumed from memory) is a plain script built around `bench()`/`group()`/
// `run()`, not a `bun:test` file -- `bench(name, fn)` registers a
// benchmark, `group(name, fn)` scopes a set of `bench()` calls together in
// the printed output, and `await run()` executes everything registered so
// far and prints mitata's own distribution/percentile table.
//
// Config builders and the memory helper are plain exported functions (not
// gated behind `import.meta.main`), so `internal.bench.test.ts` can import
// and exercise them directly for correctness without triggering a real
// mitata run as an import side effect. Only `main()`'s `bench()`/`group()`/
// `run()` registration -- and the memory section that runs after it -- is
// gated behind `import.meta.main`, exactly the way a Bun script guards its
// "only run when executed directly" entry point.
import { bench, do_not_optimize, group, run } from "mitata";
import {
  type Analytics,
  createAnalytics,
  enrichmentMiddleware,
  loggingMiddleware,
  noopProvider,
  redactMiddleware,
} from "typetrack";

// A real, but silenced, `log` override -- `loggingMiddleware`'s default
// sink is `console.log`/`console.warn`, which would otherwise flood the
// terminal across the thousands of `track()` calls mitata's throughput
// benchmarks make per sample. Silencing it here measures the middleware's
// real dispatch-chain overhead without also measuring stdout I/O cost,
// which isn't what this config is meant to represent (an app's own `log`
// override is exactly this scenario -- redirecting output elsewhere -- so
// this isn't measuring a code path real apps don't exercise).
const SILENT_LOG = (): void => {};

// (a) noopProvider only, nothing else enabled -- the cheapest possible
// construction, and the baseline every other config is compared against.
export function createBaselineAnalytics(): Analytics {
  return createAnalytics({ provider: noopProvider });
}

// (b) noopProvider + context:true + three real built-in middleware
// registered via `.use()` -- picked from `src/index.ts`'s actual export
// list (`loggingMiddleware`, `redactMiddleware`, `enrichmentMiddleware`),
// not invented. This is the config `docs/performance.md`'s "opt-in cost"
// section (issue 006) cites real numbers for.
export function createMiddlewareAnalytics(): Analytics {
  const analytics = createAnalytics({ provider: noopProvider, context: true });
  analytics.use(loggingMiddleware({ log: SILENT_LOG }));
  analytics.use(redactMiddleware({ fields: ["email"] }));
  analytics.use(enrichmentMiddleware({ properties: { app: "benchmarks" } }));
  return analytics;
}

// (c) noopProvider + reliability:true -- the offline queue setup path.
export function createReliabilityAnalytics(): Analytics {
  return createAnalytics({ provider: noopProvider, reliability: true });
}

// (d) multi-provider fan-out -- throughput-only (per the issue's own
// scope), confirming the `Promise.allSettled` fan-out path's real overhead
// vs. the single-provider fast path both `src/index.ts` and
// `docs/performance.md` already describe qualitatively.
export function createFanOutAnalytics(): Analytics {
  return createAnalytics({ provider: [noopProvider, noopProvider] });
}

export interface MemoryResult {
  heapUsedDeltaBytes: number;
}

// `Bun.gc(true)` (synchronous, blocking full GC) is confirmed available in
// the installed Bun version (1.3.14, checked directly rather than assumed)
// -- but this helper still degrades gracefully rather than throwing if a
// future/different runtime lacks it, since a forced GC pass is what makes
// the before/after `heapUsed` delta meaningful at all (without it, delta
// includes garbage from previous allocations that just hasn't been
// collected yet, not real retained growth).
function forceGcIfAvailable(): void {
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
    Bun.gc(true);
  }
}

// Measures heap growth across `iterations` calls to `fn`, bracketed by a
// forced GC pass on both sides. Generic over `fn` (not tied to `Analytics`)
// so it doubles as a small, deterministic unit under test
// (`internal.bench.test.ts`) independent of typetrack's own internals --
// the real bench script below calls it with `track()`-calling closures.
export async function measureHeapGrowth(fn: () => void | Promise<void>, iterations: number): Promise<MemoryResult> {
  // Small warm-up prefix, discarded before the measured window -- avoids
  // counting one-time lazy-initialization allocations (e.g. a queue's
  // first internal array) as if they were per-call steady-state growth.
  const warmupIterations = Math.min(iterations, 50);
  for (let i = 0; i < warmupIterations; i++) {
    await fn();
  }

  forceGcIfAvailable();
  const before = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i++) {
    await fn();
  }

  forceGcIfAvailable();
  const after = process.memoryUsage().heapUsed;

  return { heapUsedDeltaBytes: after - before };
}

function formatBytes(bytes: number): string {
  const kb = bytes / 1024;
  return `${bytes.toLocaleString()} B (${kb.toFixed(2)} KB)`;
}

const MEMORY_ITERATIONS = 10_000;

async function runMemorySection(): Promise<void> {
  console.log("\nmemory: heap growth over 10,000 track() calls (Bun.gc(true) forced before/after)\n");

  let payloadCounter = 0;

  const baselineAnalytics = createBaselineAnalytics();
  const baselineResult = await measureHeapGrowth(
    () => baselineAnalytics.track("bench-event", { i: payloadCounter++ }),
    MEMORY_ITERATIONS,
  );
  console.log(`  noopProvider only : ${formatBytes(baselineResult.heapUsedDeltaBytes)}`);

  const reliabilityAnalytics = createReliabilityAnalytics();
  const reliabilityResult = await measureHeapGrowth(
    () => reliabilityAnalytics.track("bench-event", { i: payloadCounter++ }),
    MEMORY_ITERATIONS,
  );
  console.log(`  reliability: true : ${formatBytes(reliabilityResult.heapUsedDeltaBytes)}`);

  // `reliabilityAnalytics` holds a live drain `setInterval` (see the
  // cold-start reliability benchmark's comment above) -- both instances are
  // destroyed after the measured window closes, so `destroy()`'s own cost
  // never counts toward the heap-growth numbers above, but the process can
  // still exit cleanly once this script finishes.
  await Promise.all([baselineAnalytics.destroy(), reliabilityAnalytics.destroy()]);
}

async function main(): Promise<void> {
  group("cold start: createAnalytics() construction", () => {
    bench("(a) noopProvider only", () => {
      do_not_optimize(createBaselineAnalytics());
    });
    bench("(b) context:true + logging/redact/enrichment middleware", () => {
      do_not_optimize(createMiddlewareAnalytics());
    });
    bench("(c) reliability: true", () => {
      const analytics = createReliabilityAnalytics();
      do_not_optimize(analytics);
      // `reliability: true` starts a background drain `setInterval` at
      // construction time (see `src/index.ts`'s `drainIntervalHandle`),
      // cleared only by `destroy()` -- across mitata's thousands of sample
      // iterations for this benchmark, never destroying each constructed
      // instance would leak thousands of live timers and keep the whole
      // script's process alive indefinitely after `run()` returns.
      // `destroy()` clears the interval synchronously, before its first
      // `await` (confirmed by reading `src/index.ts`'s `destroy()` body),
      // so this fire-and-forget call (not awaited -- awaiting here would
      // fold destroy's own provider-flush/destroy cost into what's meant to
      // be a pure construction-cost measurement) reliably clears the timer
      // within the same synchronous tick this bench function runs in.
      void analytics.destroy();
    });
  });

  // Built once, outside the timed benchmark functions -- these benchmarks
  // measure `track()` dispatch cost per call, not construction cost (that's
  // the cold-start group above), same precedent as
  // `src/index.performance.test.ts`.
  const baselineForThroughput = createBaselineAnalytics();
  const middlewareForThroughput = createMiddlewareAnalytics();
  const reliabilityForThroughput = createReliabilityAnalytics();
  const fanOutForThroughput = createFanOutAnalytics();
  let throughputCounter = 0;

  group("throughput: track() calls/sec", () => {
    bench("(a) noopProvider only", async () => {
      await baselineForThroughput.track("bench-event", { i: throughputCounter++ });
    });
    bench("(b) context:true + logging/redact/enrichment middleware", async () => {
      await middlewareForThroughput.track("bench-event", { i: throughputCounter++ });
    });
    bench("(c) reliability: true", async () => {
      await reliabilityForThroughput.track("bench-event", { i: throughputCounter++ });
    });
    bench("(d) multi-provider fan-out ([noopProvider, noopProvider])", async () => {
      await fanOutForThroughput.track("bench-event", { i: throughputCounter++ });
    });
  });

  await run();

  // These four instances were each constructed exactly once (outside the
  // timed throughput benchmarks above), so -- unlike the cold-start
  // reliability benchmark's thousands of short-lived instances -- there's
  // only one drain interval each to clean up here. Destroying all four
  // (not just the reliability one) is just consistent hygiene; only
  // `reliabilityForThroughput` actually holds a live timer.
  await Promise.all([
    baselineForThroughput.destroy(),
    middlewareForThroughput.destroy(),
    reliabilityForThroughput.destroy(),
    fanOutForThroughput.destroy(),
  ]);

  await runMemorySection();
}

if (import.meta.main) {
  await main();
}
