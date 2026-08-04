import { describe, expect, test } from "bun:test";
import { runConsentGatedTrackingFlow } from "./index";

// Runs the example's actual entry-point logic (`runConsentGatedTrackingFlow`,
// the exact function `bun run index.ts` calls) end-to-end against the real
// `typetrack` package and hand-written stub `AnalyticsProvider`s (never a
// real `packages/provider-*` adapter), so every assertion below can never
// silently drift out of sync with what `README.md`/`expected-output.txt`
// document -- mirrors `examples/middleware/pipeline-basics/index
// .integration.test.ts`'s convention of asserting against the flow's own
// recorded call log rather than re-implementing the scenario.
//
// No unit test file exists in this directory: `index.ts`'s own header
// comment explains why (no non-trivial pure logic is defined here -- every
// scenario is a direct `typetrack` API call, a stub-provider construction,
// or minimal `globalThis` stubbing, all of which this integration test
// already exercises for real).

describe("consent-gated-tracking example", () => {
  test("step 2: pre-consent track() is fully blocked by the global requiredCategories gate -- neither provider called", async () => {
    const { analyticsCallLog, marketingCallLog } = await runConsentGatedTrackingFlow();

    // The first two calls recorded ever (across the whole flow) belong to
    // step 3's "Product Viewed" (product-analytics only) and step 4's
    // "Newsletter Subscribed" -- step 2 contributed zero calls to either log.
    expect(analyticsCallLog.filter((entry) => entry.eventName === "Product Viewed").length).toBe(1);
    expect(marketingCallLog.filter((entry) => entry.eventName === "Product Viewed").length).toBe(0);
  });

  test('step 3: granting "analytics" only reaches the analytics-consent provider, with email redacted by piiFilterMiddleware', async () => {
    const { analyticsCallLog, marketingCallLog } = await runConsentGatedTrackingFlow();

    const productViewed = analyticsCallLog.find((entry) => entry.eventName === "Product Viewed");
    expect(productViewed).toBeDefined();
    expect(productViewed!.properties).toEqual({ sku: "TT-PLAN-PRO", email: "[REDACTED]" });
    expect(marketingCallLog.some((entry) => entry.eventName === "Product Viewed")).toBe(false);
  });

  test('step 4: granting "marketing" too reaches both providers for "Newsletter Subscribed", each redacted', async () => {
    const { analyticsCallLog, marketingCallLog } = await runConsentGatedTrackingFlow();

    const analyticsNewsletter = analyticsCallLog.find((entry) => entry.eventName === "Newsletter Subscribed");
    const marketingNewsletter = marketingCallLog.find((entry) => entry.eventName === "Newsletter Subscribed");
    expect(analyticsNewsletter).toBeDefined();
    expect(marketingNewsletter).toBeDefined();
    expect(analyticsNewsletter!.properties).toEqual({ email: "[REDACTED]" });
    expect(marketingNewsletter!.properties).toEqual({ email: "[REDACTED]" });
  });

  test("step 5: a second instance with respectBrowserSignals + a stubbed GPC signal fails closed immediately at construction", async () => {
    const { gpcCallLog, sink } = await runConsentGatedTrackingFlow();

    expect(gpcCallLog.length).toBe(0);
    expect(sink).toContain(
      '[flow] gpcAnalytics.consent.hasConsent("analytics") === false (fail-closed default applied immediately at construction -- no grant()/deny() call has been made yet)',
    );
  });

  test("step 6: disable() blocks a further track() even though consent remains granted; enable() restores it", async () => {
    const { analyticsCallLog, marketingCallLog } = await runConsentGatedTrackingFlow();

    // Total "Newsletter Subscribed" deliveries: step 4 (1 each) + the
    // post-enable() call in step 6 (1 each) = 2 each. The disable()'d call
    // in between contributed zero to both logs.
    expect(analyticsCallLog.filter((entry) => entry.eventName === "Newsletter Subscribed").length).toBe(2);
    expect(marketingCallLog.filter((entry) => entry.eventName === "Newsletter Subscribed").length).toBe(2);
  });

  test("final call counts match the fully-composed flow: product-analytics=3, marketing-pixel=2, gpc-instance-analytics=0", async () => {
    const { analyticsCallLog, marketingCallLog, gpcCallLog } = await runConsentGatedTrackingFlow();

    expect(analyticsCallLog.length).toBe(3);
    expect(marketingCallLog.length).toBe(2);
    expect(gpcCallLog.length).toBe(0);
  });

  test("runConsentGatedTrackingFlow resolves without throwing", async () => {
    await expect(runConsentGatedTrackingFlow()).resolves.toBeDefined();
  });
});
