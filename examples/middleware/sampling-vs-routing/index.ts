import { createAnalytics, samplingMiddleware, type AnalyticsProvider, type ProviderEntry } from "typetrack";

// Clarifies the two-layer sampling distinction `src/middleware/sampling.ts`'s
// own doc comment flags: `samplingMiddleware` (this phase) is a *global,
// pre-dispatch* gate -- one drop decision per event, made before dispatch
// even starts evaluating routing for any provider. `ProviderEntry.sampling`
// (Phase 7, `src/routing.ts`) is a *per-provider* gate, evaluated later, once
// per provider, only for events that already survived every registered
// middleware's `before()`. The two are independent and compose: dropping an
// event globally means *no* provider ever sees it, regardless of that
// provider's own `include`/`exclude`/`predicate`/`sampling`; passing the
// global gate only makes an event a *candidate* for each provider's own
// routing decision.
//
// Both layers key on the exact same deterministic
// `hashToUnitInterval(anonymousId)` (see `src/routing.ts`), so for a given
// `anonymousId`, "does it pass a 0.7 global gate" and "does it pass a 0.3
// per-provider gate" are both pure functions of the *same* underlying value
// -- which is what makes the 3-way split below ("globally dropped" /
// "delivered to the always-on provider only" / "delivered to both") exactly
// reproducible in its *structure* (always exactly one of these 3 outcomes
// per simulated user), even though *which* outcome a given run's randomly
// generated `anonymousId` lands in is not.

export type SamplingCategory = "globally-dropped" | "vendor-excluded" | "delivered-to-both";

export interface CallLogEntry {
  provider: string;
  eventName: string;
}

// Global, pre-dispatch gate: at 0.7, roughly 70% of anonymousIds pass this
// middleware at all. Any anonymousId that fails it means *no* provider in
// the list below (regardless of that provider's own sampling) ever sees the
// event.
const GLOBAL_SAMPLING_RATE = 0.7;
// Per-provider gate, narrower than the global rate on purpose: this is what
// makes the "delivered to the always-on provider only" outcome observable
// -- an anonymousId that passes the 0.7 global gate can still fail this
// stricter 0.3 provider-level gate.
const VENDOR_SAMPLING_RATE = 0.3;

function makeStubProvider(name: string, callLog: CallLogEntry[]): AnalyticsProvider {
  return {
    name,
    capabilities: {
      identify: false,
      group: false,
      alias: false,
      page: false,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },
    track(event) {
      callLog.push({ provider: name, eventName: event.name });
    },
  };
}

export interface SamplingScenario {
  entries: ProviderEntry[];
  callLog: CallLogEntry[];
}

// Builds one fresh (fresh `anonymousId`, since it's a new `createAnalytics()`
// instance) 2-provider scenario: `search-analytics-warehouse` has no
// per-provider sampling at all (only subject to the global
// `samplingMiddleware`), and `ml-ranking-vendor` additionally has its own,
// stricter `ProviderEntry.sampling`.
export function createSamplingScenario(): SamplingScenario {
  const callLog: CallLogEntry[] = [];

  const warehouseProvider = makeStubProvider("search-analytics-warehouse", callLog);
  const vendorProvider = makeStubProvider("ml-ranking-vendor", callLog);

  const entries: ProviderEntry[] = [
    { provider: warehouseProvider },
    { provider: vendorProvider, sampling: VENDOR_SAMPLING_RATE },
  ];

  return { entries, callLog };
}

// Categorizes one already-run scenario's outcome purely by observing which
// providers were actually called -- `typetrack` deliberately does not expose
// *why* a provider was/wasn't called (see `multi-provider-routing`'s own
// `logSamplingAndOrder` for the same pattern), so this is exactly what a real
// caller could introspect too. Pure function, no I/O -- unit-tested directly
// in `index.test.ts`.
//
// The 4th boolean combination (`warehouseCalled: false, vendorCalled: true`)
// can never occur given `GLOBAL_SAMPLING_RATE` (0.7) and
// `VENDOR_SAMPLING_RATE` (0.3): both gates key on the exact same
// `hashToUnitInterval(anonymousId)` value, and 0.3 is strictly narrower than
// 0.7, so passing the *stricter* per-provider gate implies passing the
// *looser* global gate. This function doesn't assume that invariant blindly,
// though -- it throws if it's ever violated, rather than silently
// mis-categorizing, which is exactly the behavior `index.test.ts` asserts.
export function categorizeOutcome(warehouseCalled: boolean, vendorCalled: boolean): SamplingCategory {
  if (!warehouseCalled && !vendorCalled) return "globally-dropped";
  if (warehouseCalled && !vendorCalled) return "vendor-excluded";
  if (warehouseCalled && vendorCalled) return "delivered-to-both";
  throw new Error(
    "categorizeOutcome: unreachable combination (vendor received an event the always-on warehouse provider did not) -- " +
      "this would mean the per-provider sampling gate is *looser* than the global middleware gate for this run's anonymousId, " +
      "which should never happen given VENDOR_SAMPLING_RATE < GLOBAL_SAMPLING_RATE.",
  );
}

// Runs one simulated user's single search query through a fresh
// `createAnalytics()` instance (fresh anonymousId) with `samplingMiddleware`
// registered globally, and reports which of the 3 outcomes it landed in.
// Exported (rather than only run inline) so `index.integration.test.ts` runs
// this exact function.
export async function runOneUserTrial(): Promise<SamplingCategory> {
  const { entries, callLog } = createSamplingScenario();
  const analytics = createAnalytics({ provider: entries });
  analytics.use(samplingMiddleware({ rate: GLOBAL_SAMPLING_RATE }));

  await analytics.track("Search Query Submitted", { query: "wireless headphones", resultsCount: 128 });

  const warehouseCalled = callLog.some((entry) => entry.provider === "search-analytics-warehouse");
  const vendorCalled = callLog.some((entry) => entry.provider === "ml-ranking-vendor");
  return categorizeOutcome(warehouseCalled, vendorCalled);
}

// Runs `trials` independent simulated users (each its own `createAnalytics()`
// instance, hence its own fresh, independently random `anonymousId`) and
// tallies how many landed in each of the 3 outcome categories.
export async function runManyTrials(trials: number): Promise<Record<SamplingCategory, number>> {
  const tally: Record<SamplingCategory, number> = {
    "globally-dropped": 0,
    "vendor-excluded": 0,
    "delivered-to-both": 0,
  };
  for (let i = 0; i < trials; i++) {
    const category = await runOneUserTrial();
    tally[category]++;
  }
  return tally;
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  const trials = 12;
  console.log(`Running ${trials} simulated users, each submitting one "Search Query Submitted" event...\n`);

  const tally: Record<SamplingCategory, number> = {
    "globally-dropped": 0,
    "vendor-excluded": 0,
    "delivered-to-both": 0,
  };
  for (let i = 1; i <= trials; i++) {
    const category = await runOneUserTrial();
    tally[category]++;
    console.log(`user-${i}: ${category}`);
  }

  console.log("\nTally across all simulated users:");
  console.log(`  globally-dropped (samplingMiddleware dropped it -- neither provider saw it): ${tally["globally-dropped"]}`);
  console.log(`  vendor-excluded (passed the global gate, but ml-ranking-vendor's own ProviderEntry.sampling excluded it): ${tally["vendor-excluded"]}`);
  console.log(`  delivered-to-both (passed both gates): ${tally["delivered-to-both"]}`);
}
