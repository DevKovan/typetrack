import { describe, expect, test } from "bun:test";
import { runAnonymousAndCookielessFlow } from "./index";

// Runs the example's actual entry-point logic
// (`runAnonymousAndCookielessFlow`, the exact function `bun run index.ts`
// calls) end-to-end against the real `typetrack` package and a hand-written
// stub `AnalyticsProvider` (never a real `packages/provider-*` adapter), so
// every assertion below can never silently drift out of sync with what
// `README.md`/`expected-output.txt` document -- mirrors
// `examples/plugins/landing-page-engagement/index.integration.test.ts`'s
// convention of asserting against the flow's own recorded call log rather
// than re-implementing the scenario.
//
// No unit test file exists in this directory: `index.ts`'s own header
// comment explains why (no non-trivial pure logic is defined here -- every
// scenario is a direct `typetrack`/`autoUTM()` API call, a stub-provider
// construction, or minimal `globalThis` stubbing, all of which this
// integration test already exercises for real).

describe("anonymous-and-cookieless-tracking example", () => {
  test("step 1-2: autoUTM()'s Campaign Landing still fires under cookieless: true, but sessionStorage.setItem is never called", async () => {
    const { callLog, setItemCalls } = await runAnonymousAndCookielessFlow();

    const landingEvents = callLog.filter((entry) => entry.name === "Campaign Landing");
    expect(landingEvents.length).toBe(1);
    expect(landingEvents[0]!.properties).toEqual({ source: "newsletter", medium: "email", campaign: "spring-sale" });
    expect(setItemCalls).toEqual([]);
  });

  test("step 3: identify() is a no-op under anonymousMode -- no identify() call reaches the provider, and userId is never set", async () => {
    const { callLog } = await runAnonymousAndCookielessFlow();

    expect(callLog.some((entry) => entry.verb === "identify")).toBe(false);

    const pricingViewed = callLog.find((entry) => entry.name === "Pricing Page Viewed");
    expect(pricingViewed).toBeDefined();
    expect(pricingViewed!.eventUserId).toBeUndefined();
  });

  test('step 4: a second page load with no UTM params fires no further "Campaign Landing" event', async () => {
    const { callLog } = await runAnonymousAndCookielessFlow();

    const landingEvents = callLog.filter((entry) => entry.name === "Campaign Landing");
    expect(landingEvents.length).toBe(1);
  });

  test("step 5: destroy() completes without throwing for both instances", async () => {
    const { sink } = await runAnonymousAndCookielessFlow();

    expect(sink).toContain("[flow] destroy() completed for both instances without throwing");
  });

  test("runAnonymousAndCookielessFlow resolves without throwing", async () => {
    await expect(runAnonymousAndCookielessFlow()).resolves.toBeDefined();
  });
});
