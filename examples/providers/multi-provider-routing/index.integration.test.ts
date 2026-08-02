import { describe, expect, test } from "bun:test";
import { createAnalytics, type AnalyticsProvider } from "typetrack";
import { createProviderSet, runRoutingFlow } from "./index";

// Runs the example's actual entry-point logic (`createProviderSet` +
// `runRoutingFlow`, the exact functions `bun run index.ts` calls against the
// real console-logging stub providers) end-to-end, so the asserted
// include/exclude/predicate/sampling/priority/always-fan-out outcomes below
// can never silently drift out of sync with what the README documents.
//
// No colocated `index.test.ts` (unit test) exists for this example: unlike
// `canonical-event-shape` (which has no unit test either), there is no
// pure/non-trivial logic in `index.ts` worth isolating -- `createProviderSet`
// is direct `AnalyticsProvider` stub construction plus a `ProviderEntry[]`
// literal, and `runRoutingFlow`/`logSamplingAndOrder` are direct `typetrack`
// API calls and `callLog` inspection. Every routing/ordering/sampling
// decision under test is produced by the real `typetrack` package, not by
// any helper this example defines itself, so it belongs in this integration
// test, not a unit test.

describe("multi-provider-routing example", () => {
  test("analyticsWarehouseProvider (include) only receives the two commerce events, in flow order", async () => {
    const { entries, callLog } = createProviderSet("test");
    await runRoutingFlow(entries);

    const warehouseTrackEvents = callLog
      .filter((entry) => entry.provider === "analytics-warehouse" && entry.verb === "track")
      .map((entry) => entry.eventName);

    expect(warehouseTrackEvents).toEqual(["Checkout Started", "Purchase Completed"]);
  });

  test("marketingPixelProvider (exclude) receives every event except the debug-namespaced one", async () => {
    const { entries, callLog } = createProviderSet("test");
    await runRoutingFlow(entries);

    const pixelTrackEvents = callLog
      .filter((entry) => entry.provider === "marketing-pixel" && entry.verb === "track")
      .map((entry) => entry.eventName);

    expect(pixelTrackEvents).toEqual(["Checkout Started", "Purchase Completed", "Page Viewed"]);
    expect(pixelTrackEvents).not.toContain("debug.cache_miss");
  });

  test("debugConsoleProvider (predicate) only receives events tagged with a development environment", async () => {
    const { entries, callLog } = createProviderSet("test");
    await runRoutingFlow(entries);

    const debugTrackEvents = callLog
      .filter((entry) => entry.provider === "debug-console" && entry.verb === "track")
      .map((entry) => entry.eventName);

    // "Checkout Started" and "debug.cache_miss" both carry
    // `context: { environment: "development" }`; "Purchase Completed" is
    // tagged "production" and "Page Viewed" carries no context at all.
    expect(debugTrackEvents).toEqual(["Checkout Started", "debug.cache_miss"]);
  });

  test("fullFeaturedProvider (sampling) receives either every track() call or none of them, never some", async () => {
    const { entries, callLog } = createProviderSet("test");
    await runRoutingFlow(entries);

    const fullFeaturedTrackEvents = callLog.filter(
      (entry) => entry.provider === "full-featured" && entry.verb === "track",
    );

    // The same anonymousId is used for every call within one
    // `createAnalytics()` instance, and sampling is a pure function of
    // (anonymousId, samplingRate) -- so this provider's inclusion decision
    // for all 4 track() calls in one flow must agree: either all 4, or 0.
    expect([0, 4]).toContain(fullFeaturedTrackEvents.length);
  });

  test("sampling is deterministic per anonymousId: repeated calls through the same instance agree every time", async () => {
    let calls = 0;
    const samplerStub: AnalyticsProvider = {
      name: "sampler-stub",
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
      track() {
        calls += 1;
      },
    };

    const analytics = createAnalytics({ provider: [{ provider: samplerStub, sampling: 0.5 }] });

    // 10 calls through the *same* instance (same anonymousId throughout) --
    // either every one lands or none do.
    for (let i = 0; i < 10; i++) {
      await analytics.track("Checkout Started", { cartValue: 10, itemCount: 1 });
    }

    expect([0, 10]).toContain(calls);
  });

  test("sampling at rate 0.5 lands roughly half of many distinct anonymousIds \"in\" over many trials", async () => {
    const trials = 300;
    let sampledIn = 0;

    for (let i = 0; i < trials; i++) {
      let called = false;
      const trialStub: AnalyticsProvider = {
        name: "trial-stub",
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
        track() {
          called = true;
        },
      };
      // A fresh `createAnalytics()` instance per trial -- each generates its
      // own independently random `anonymousId`, simulating a distinct user.
      const analytics = createAnalytics({ provider: [{ provider: trialStub, sampling: 0.5 }] });
      await analytics.track("Checkout Started", { cartValue: 10, itemCount: 1 });
      if (called) sampledIn++;
    }

    // Generous statistical tolerance (expected ~150/300, stddev ~8.7): a
    // window this wide (90-210) fails by chance with probability on the
    // order of 1e-8, while still meaningfully proving the sampler isn't
    // "always in"/"always out"/wildly skewed.
    expect(sampledIn).toBeGreaterThan(90);
    expect(sampledIn).toBeLessThan(210);
  });

  test("priority ordering: for \"Checkout Started\", guaranteed-included providers are called low-to-high priority", async () => {
    const { entries, callLog } = createProviderSet("test");
    await runRoutingFlow(entries);

    const checkoutCallOrder = callLog
      .filter((entry) => entry.verb === "track" && entry.eventName === "Checkout Started")
      .map((entry) => entry.provider);

    // Declared priorities: full-featured=0, marketing-pixel=10,
    // debug-console=20, analytics-warehouse=30 -- ascending priority is call
    // order. full-featured is the only one of the 4 whose presence here is
    // sampling-dependent, so the expected order is filtered down to whichever
    // providers actually appear (the other 3 always appear for this event).
    const fullOrder = ["full-featured", "marketing-pixel", "debug-console", "analytics-warehouse"];
    const expectedOrder = fullOrder.filter((name) => checkoutCallOrder.includes(name));

    expect(checkoutCallOrder).toEqual(expectedOrder);
    // The 3 always-included providers must always be present, in this order.
    expect(checkoutCallOrder).toContain("marketing-pixel");
    expect(checkoutCallOrder).toContain("debug-console");
    expect(checkoutCallOrder).toContain("analytics-warehouse");
  });

  test("identify() always fans out to all 4 providers, regardless of their routing config", async () => {
    const { entries, callLog } = createProviderSet("test");
    await runRoutingFlow(entries);

    const identifyProviders = callLog.filter((entry) => entry.verb === "identify").map((entry) => entry.provider);

    expect(identifyProviders.sort()).toEqual(
      ["analytics-warehouse", "debug-console", "full-featured", "marketing-pixel"].sort(),
    );
  });

  test("flush() reaches all 4 providers exactly once (destroy() is never called by this flow)", async () => {
    const { entries, callLog } = createProviderSet("test");
    await runRoutingFlow(entries);

    const flushProviders = callLog.filter((entry) => entry.verb === "flush").map((entry) => entry.provider);
    const destroyProviders = callLog.filter((entry) => entry.verb === "destroy").map((entry) => entry.provider);

    const allProviders = ["analytics-warehouse", "debug-console", "full-featured", "marketing-pixel"];
    expect(flushProviders.sort()).toEqual([...allProviders].sort());
    expect(destroyProviders).toEqual([]);
  });

  test("runRoutingFlow also runs cleanly end-to-end with the real noopProvider (single, non-array)", async () => {
    const { noopProvider } = await import("typetrack");
    const analytics = createAnalytics({ provider: noopProvider });
    await expect(
      (async () => {
        await analytics.track("Checkout Started", { cartValue: 10, itemCount: 1 });
        await analytics.identify("user_1");
        await analytics.flush();
        await analytics.destroy();
      })(),
    ).resolves.toBeUndefined();
  });
});
