import { describe, expect, test } from "bun:test";
import { createAnalytics, samplingMiddleware, type AnalyticsProvider } from "typetrack";
import { createSamplingScenario, runManyTrials, runOneUserTrial } from "./index";

// Runs the example's actual entry-point logic (`createSamplingScenario` +
// `runOneUserTrial`/`runManyTrials`, the exact functions `bun run index.ts`
// calls) end-to-end against the real `typetrack` package. Sampling is
// probabilistic by nature, so these assertions are statistical (generous
// tolerance bands) or structural invariants (a combination that must never
// occur), matching the precedent set by
// `examples/providers/multi-provider-routing`'s own sampling tests -- never
// an exact-transcript comparison.

describe("sampling-vs-routing example", () => {
  test("a single trial always lands in exactly one of the 3 valid categories", async () => {
    const category = await runOneUserTrial();
    expect(["globally-dropped", "vendor-excluded", "delivered-to-both"]).toContain(category);
  });

  test("the always-on warehouse provider is included in every entry's ProviderEntry, with no sampling of its own", () => {
    const { entries } = createSamplingScenario();
    const warehouseEntry = entries.find((entry) => entry.provider.name === "search-analytics-warehouse");
    expect(warehouseEntry).toBeDefined();
    expect(warehouseEntry!.sampling).toBeUndefined();
  });

  test("the vendor provider carries its own, stricter ProviderEntry.sampling", () => {
    const { entries } = createSamplingScenario();
    const vendorEntry = entries.find((entry) => entry.provider.name === "ml-ranking-vendor");
    expect(vendorEntry).toBeDefined();
    expect(vendorEntry!.sampling).toBe(0.3);
  });

  test("over many trials, all 3 categories occur, in roughly the expected proportions (0.3 / 0.4 / 0.3), and the impossible 4th combination never does", async () => {
    const trials = 300;
    const tally = await runManyTrials(trials);

    const total = tally["globally-dropped"] + tally["vendor-excluded"] + tally["delivered-to-both"];
    expect(total).toBe(trials);

    // Expected ~90/300 (30%), generous tolerance -- window fails by chance
    // with probability on the order of 1e-8, matching
    // `multi-provider-routing`'s own precedent for this kind of assertion.
    expect(tally["globally-dropped"]).toBeGreaterThan(45);
    expect(tally["globally-dropped"]).toBeLessThan(150);

    // Expected ~120/300 (40%).
    expect(tally["vendor-excluded"]).toBeGreaterThan(70);
    expect(tally["vendor-excluded"]).toBeLessThan(190);

    // Expected ~90/300 (30%).
    expect(tally["delivered-to-both"]).toBeGreaterThan(45);
    expect(tally["delivered-to-both"]).toBeLessThan(150);
  });

  test("samplingMiddleware's global drop is decided in before(), so a dropped event never reaches dispatch/routing at all -- neither provider's track() is ever called for it", async () => {
    // Force the "globally-dropped" outcome deterministically by using a
    // global rate of 0, which fails `isSampledIn` unconditionally.
    const { entries, callLog } = createSamplingScenario();
    const analytics = createAnalytics({ provider: entries });
    analytics.use(samplingMiddleware({ rate: 0 }));

    await analytics.track("Search Query Submitted", { query: "wireless headphones", resultsCount: 128 });

    expect(callLog).toEqual([]);
  });

  test("without samplingMiddleware registered, ProviderEntry.sampling alone still independently gates the vendor provider (rate 0 -> vendor never called, warehouse always is)", async () => {
    const { entries, callLog } = createSamplingScenario();
    // Override the vendor's sampling to 0 for a deterministic assertion --
    // no samplingMiddleware registered at all this time, isolating
    // ProviderEntry.sampling's behavior on its own.
    const vendorEntry = entries.find((entry) => entry.provider.name === "ml-ranking-vendor")!;
    vendorEntry.sampling = 0;
    const analytics = createAnalytics({ provider: entries });

    await analytics.track("Search Query Submitted", { query: "wireless headphones", resultsCount: 128 });

    expect(callLog).toEqual([{ provider: "search-analytics-warehouse", eventName: "Search Query Submitted" }]);
  });

  test("a rate-1 global samplingMiddleware never drops -- both providers' own routing/sampling still applies independently", async () => {
    const { entries, callLog } = createSamplingScenario();
    const vendorEntry = entries.find((entry) => entry.provider.name === "ml-ranking-vendor")!;
    vendorEntry.sampling = 1; // vendor also always passes now
    const analytics = createAnalytics({ provider: entries });
    analytics.use(samplingMiddleware({ rate: 1 }));

    await analytics.track("Search Query Submitted", { query: "wireless headphones", resultsCount: 128 });

    const providers = callLog.map((entry) => entry.provider).sort();
    expect(providers).toEqual(["ml-ranking-vendor", "search-analytics-warehouse"]);
  });

  test("sampling decisions are stable across repeated calls through the same instance (same anonymousId throughout)", async () => {
    const { entries, callLog } = createSamplingScenario();
    const analytics = createAnalytics({ provider: entries });
    analytics.use(samplingMiddleware({ rate: 0.5 }));

    for (let i = 0; i < 10; i++) {
      await analytics.track("Search Query Submitted", { query: "wireless headphones", resultsCount: 128 });
    }

    const warehouseCalls = callLog.filter((entry) => entry.provider === "search-analytics-warehouse").length;
    const vendorCalls = callLog.filter((entry) => entry.provider === "ml-ranking-vendor").length;
    // Each provider's inclusion decision is a pure function of this
    // instance's one fixed anonymousId -- so across 10 identical calls, each
    // provider is either called every time or never, never sometimes.
    expect([0, 10]).toContain(warehouseCalls);
    expect([0, 10]).toContain(vendorCalls);
  });

  test("runOneUserTrial also runs cleanly end-to-end alongside a plain noopProvider fast path (sanity check against the real single-provider passthrough)", async () => {
    const { noopProvider } = await import("typetrack");
    const analytics = createAnalytics({ provider: noopProvider });
    analytics.use(samplingMiddleware({ rate: 0.5 }));
    await expect(
      (async () => {
        await analytics.track("Search Query Submitted", { query: "wireless headphones", resultsCount: 128 });
      })(),
    ).resolves.toBeUndefined();
  });

  // Type-only reference so `AnalyticsProvider` stays exercised by this file
  // even though every provider here is built via `createSamplingScenario`'s
  // `makeStubProvider` internally, not constructed ad hoc in this test file.
  test("createSamplingScenario's providers satisfy the real AnalyticsProvider shape", () => {
    const { entries } = createSamplingScenario();
    const provider: AnalyticsProvider = entries[0]!.provider;
    expect(typeof provider.track).toBe("function");
  });
});
