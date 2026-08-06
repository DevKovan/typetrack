import { describe, expect, test } from "bun:test";
import { createCheckoutMigrationScenario, runCheckoutMigrationDemo, trackLegacyCheckoutStart } from "./index";

// Runs the example's actual entry-point logic (`createCheckoutMigrationScenario`,
// `trackLegacyCheckoutStart`, `runCheckoutMigrationDemo` -- the exact
// functions `bun run index.ts` calls) end-to-end against the real
// `typetrack` package and a hand-written stub `AnalyticsProvider`, so these
// assertions can never silently drift out of sync with what
// README.md/expected-output.txt document.

describe("deprecated-event-rename example", () => {
  test("the old call site (unmodified) delivers the event to the provider under the NEW, resolved name", async () => {
    const { analytics, callLog } = createCheckoutMigrationScenario();

    await trackLegacyCheckoutStart(analytics, 42);

    expect(callLog).toHaveLength(1);
    expect(callLog[0]!.eventName).toBe("Checkout Started");
    expect(callLog[0]!.payload).toEqual({ cartValue: 42 });
  });

  test("the console warning fires exactly once, even across multiple calls to the old call site", async () => {
    const { warnCount } = await runCheckoutMigrationDemo();
    expect(warnCount).toBe(1);
  });

  test("all 3 calls in the demo still deliver to the provider under the resolved name, with their own distinct payloads", async () => {
    const { callLog } = await runCheckoutMigrationDemo();

    expect(callLog).toHaveLength(3);
    for (const entry of callLog) {
      expect(entry.eventName).toBe("Checkout Started");
      expect(entry.provider).toBe("checkout-warehouse");
    }
    expect(callLog.map((entry) => entry.payload)).toEqual([{ cartValue: 42 }, { cartValue: 89 }, { cartValue: 15 }]);
  });

  test("a brand-new instance's warn state is independent -- a fresh scenario warns again on its own first call", async () => {
    const { analytics, callLog } = createCheckoutMigrationScenario();

    let warnCount = 0;
    const originalWarn = console.warn.bind(console);
    console.warn = (...args: Parameters<typeof console.warn>) => {
      warnCount++;
      originalWarn(...args);
    };
    try {
      await trackLegacyCheckoutStart(analytics, 5);
    } finally {
      console.warn = originalWarn;
    }

    expect(warnCount).toBe(1);
    expect(callLog[0]!.eventName).toBe("Checkout Started");
  });

  test("an event name outside deprecatedEventsConfig fires under its own name, with no warning", async () => {
    const { analytics, callLog } = createCheckoutMigrationScenario();

    let warnCount = 0;
    const originalWarn = console.warn.bind(console);
    console.warn = () => {
      warnCount++;
    };
    try {
      await analytics.track("Pricing Page Viewed", { plan: "pro" });
    } finally {
      console.warn = originalWarn;
    }

    expect(warnCount).toBe(0);
    expect(callLog[0]!.eventName).toBe("Pricing Page Viewed");
  });
});
