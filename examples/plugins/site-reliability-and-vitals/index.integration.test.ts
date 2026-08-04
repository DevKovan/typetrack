import { describe, expect, test } from "bun:test";
import { runSiteReliabilityAndVitalsFlow } from "./index";

// Runs the example's actual entry-point logic
// (`runSiteReliabilityAndVitalsFlow`, the exact function `bun run index.ts`
// calls) end-to-end against the real `typetrack` package, so every
// assertion below can never silently drift out of sync with what
// `README.md`/`expected-output.txt` document. Mirrors
// `../landing-page-engagement/index.integration.test.ts`'s convention of
// asserting against the flow's own recorded call log rather than
// re-implementing the scenario.
//
// No unit test file exists alongside this one: per the issue's "a unit
// test is required only where non-trivial pure logic exists inside the
// example's own code" rule, `index.ts` here defines no pure logic worth
// isolating -- `StubPerformanceObserver`/`installStubBrowser()` are
// scenario-driving plumbing with no interesting branching of their own
// (they're a near-direct port of
// `src/plugins/telemetry.integration.test.ts`'s established stub), and
// every fixture fed into the flow (the fake `PerformanceEntry`/navigation-
// timing objects) is a fixed literal, not computed by anything worth
// testing in isolation. Contrast `../landing-page-engagement`, whose
// `elementMatchesSelector()` genuinely branches on selector shape and gets
// its own `index.test.ts`.

describe("site-reliability-and-vitals example", () => {
  test("setup: all 3 plugins are listener-only -- zero provider calls at construction time", async () => {
    const { sink } = await runSiteReliabilityAndVitalsFlow();
    expect(sink).toContain("[flow] setup produced 0 provider call(s) (all 3 plugins are listener-only at setup)");
  });

  test("autoErrors(): a window 'error' event is tracked as 'Error Occurred' with message/filename/lineno/colno/stack", async () => {
    const { callLog } = await runSiteReliabilityAndVitalsFlow();

    const errorEvent = callLog.find((entry) => entry.name === "Error Occurred");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.properties).toEqual({
      message: "TypeError: Cannot read properties of undefined (reading 'total')",
      filename: "checkout-summary.js",
      lineno: 42,
      colno: 17,
      stack: "TypeError: Cannot read properties of undefined (reading 'total')\n  at renderSummary (checkout-summary.js:42:17)",
    });
  });

  test("autoErrors(): an unhandledrejection with a non-Error (string) reason is tracked with the string-coercion fallback", async () => {
    const { callLog } = await runSiteReliabilityAndVitalsFlow();

    const rejectionEvent = callLog.find((entry) => entry.name === "Unhandled Rejection");
    expect(rejectionEvent).toBeDefined();
    expect(rejectionEvent!.properties).toEqual({ reason: "Network request timed out" });
  });

  test("autoWebVitals(): FCP/LCP/CLS each fire exactly once, covering good/poor/needs-improvement across the three vitals", async () => {
    const { callLog } = await runSiteReliabilityAndVitalsFlow();

    const vitalEvents = callLog.filter((entry) => entry.name === "Web Vital Measured");
    expect(vitalEvents.length).toBe(3);

    const fcp = vitalEvents.find((entry) => entry.properties.name === "FCP");
    expect(fcp!.properties).toEqual({ name: "FCP", value: 1200, rating: "good" });

    const lcp = vitalEvents.find((entry) => entry.properties.name === "LCP");
    expect(lcp!.properties).toEqual({ name: "LCP", value: 4200, rating: "poor" });

    const cls = vitalEvents.find((entry) => entry.properties.name === "CLS");
    expect(cls!.properties!.rating).toBe("needs-improvement");
    // 0.07 + 0.08, ignoring the 0.5 entry with hadRecentInput: true --
    // asserted with toBeCloseTo (not toBe) since IEEE-754 floating-point
    // summation of 0.07 + 0.08 does not land on exactly 0.15.
    expect(cls!.properties!.value as number).toBeCloseTo(0.15, 10);
  });

  test("autoPerformance(): the navigation entry fed before the load event produces 'Page Performance Measured' with the correctly-computed duration fields", async () => {
    const { callLog } = await runSiteReliabilityAndVitalsFlow();

    const performanceEvent = callLog.find((entry) => entry.name === "Page Performance Measured");
    expect(performanceEvent).toBeDefined();
    expect(performanceEvent!.properties).toEqual({
      ttfb: 25,
      domContentLoaded: 150,
      loadComplete: 220,
      dnsMs: 10,
      tcpMs: 15,
      requestMs: 25,
      responseMs: 30,
    });
  });

  test("exactly 6 provider calls happen before destroy(), one per tracked event across steps 2-5", async () => {
    const { callLog } = await runSiteReliabilityAndVitalsFlow();
    expect(callLog.length).toBe(6);
  });

  test("destroy(): autoErrors()'s listeners are removed -- a further simulated error/rejection produces no further provider calls", async () => {
    const { sink } = await runSiteReliabilityAndVitalsFlow();
    expect(sink).toContain("[flow] 0 provider call(s) after destroy() (expected: 0, was 6 before)");
  });

  test("runSiteReliabilityAndVitalsFlow resolves without throwing", async () => {
    await expect(runSiteReliabilityAndVitalsFlow()).resolves.toBeDefined();
  });
});
