// Unit tests for Phase 10 issue 003's `computeScrollPercent` (pure
// percent-of-page-scrolled computation, exercised against hand-constructed
// numeric state -- no `createAnalytics()`, no providers, no browser
// globals). `autoScroll()`'s full setup/scroll/threshold/teardown round
// trip is exercised by `autoScroll.integration.test.ts` instead.
import { describe, expect, it } from "bun:test";
import { computeScrollPercent } from "./autoScroll";

describe("computeScrollPercent", () => {
  it("computes ((scrollY + innerHeight) / scrollHeight) * 100", () => {
    const percent = computeScrollPercent({ scrollY: 300, innerHeight: 700, scrollHeight: 2000 });
    expect(percent).toBe(50);
  });

  it("clamps above 100 down to 100", () => {
    const percent = computeScrollPercent({ scrollY: 5000, innerHeight: 800, scrollHeight: 1000 });
    expect(percent).toBe(100);
  });

  it("clamps below 0 up to 0 (negative scrollY, defensive)", () => {
    const percent = computeScrollPercent({ scrollY: -100, innerHeight: -100, scrollHeight: 1000 });
    expect(percent).toBe(0);
  });

  it("returns 0 when scrollHeight is 0 (avoids division by zero / NaN)", () => {
    const percent = computeScrollPercent({ scrollY: 0, innerHeight: 0, scrollHeight: 0 });
    expect(percent).toBe(0);
  });

  it("computes exactly 100 at the bottom of the page", () => {
    const percent = computeScrollPercent({ scrollY: 1200, innerHeight: 800, scrollHeight: 2000 });
    expect(percent).toBe(100);
  });

  it("computes exactly 0 at the top of a page taller than the viewport", () => {
    const percent = computeScrollPercent({ scrollY: 0, innerHeight: 0, scrollHeight: 2000 });
    expect(percent).toBe(0);
  });
});
