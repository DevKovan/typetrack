// Unit tests for Phase 10 issue 004's `rateWebVital` (pure rating-threshold
// computation, exercised against hand-constructed numeric values -- no
// `createAnalytics()`, no providers, no `PerformanceObserver`).
// `autoWebVitals()`'s full setup/observe/finalize/teardown round trip is
// exercised by `telemetry.integration.test.ts` instead.
import { describe, expect, it } from "bun:test";
import { rateWebVital } from "./autoWebVitals";

describe("rateWebVital", () => {
  describe("LCP (good <= 2500, needs-improvement <= 4000, else poor, ms)", () => {
    it("rates a value at the good boundary as good", () => {
      expect(rateWebVital("LCP", 2500)).toBe("good");
    });
    it("rates a value just below the good boundary as good", () => {
      expect(rateWebVital("LCP", 1000)).toBe("good");
    });
    it("rates a value just above the good boundary as needs-improvement", () => {
      expect(rateWebVital("LCP", 2501)).toBe("needs-improvement");
    });
    it("rates a value at the needs-improvement boundary as needs-improvement", () => {
      expect(rateWebVital("LCP", 4000)).toBe("needs-improvement");
    });
    it("rates a value above the needs-improvement boundary as poor", () => {
      expect(rateWebVital("LCP", 4001)).toBe("poor");
    });
    it("rates a very large value as poor", () => {
      expect(rateWebVital("LCP", 10000)).toBe("poor");
    });
  });

  describe("CLS (good <= 0.1, needs-improvement <= 0.25, else poor, unitless)", () => {
    it("rates a value at the good boundary as good", () => {
      expect(rateWebVital("CLS", 0.1)).toBe("good");
    });
    it("rates a value just below the good boundary as good", () => {
      expect(rateWebVital("CLS", 0.05)).toBe("good");
    });
    it("rates a value just above the good boundary as needs-improvement", () => {
      expect(rateWebVital("CLS", 0.11)).toBe("needs-improvement");
    });
    it("rates a value at the needs-improvement boundary as needs-improvement", () => {
      expect(rateWebVital("CLS", 0.25)).toBe("needs-improvement");
    });
    it("rates a value above the needs-improvement boundary as poor", () => {
      expect(rateWebVital("CLS", 0.26)).toBe("poor");
    });
    it("rates a very large value as poor", () => {
      expect(rateWebVital("CLS", 1)).toBe("poor");
    });
  });

  describe("FCP (good <= 1800, needs-improvement <= 3000, else poor, ms)", () => {
    it("rates a value at the good boundary as good", () => {
      expect(rateWebVital("FCP", 1800)).toBe("good");
    });
    it("rates a value just below the good boundary as good", () => {
      expect(rateWebVital("FCP", 900)).toBe("good");
    });
    it("rates a value just above the good boundary as needs-improvement", () => {
      expect(rateWebVital("FCP", 1801)).toBe("needs-improvement");
    });
    it("rates a value at the needs-improvement boundary as needs-improvement", () => {
      expect(rateWebVital("FCP", 3000)).toBe("needs-improvement");
    });
    it("rates a value above the needs-improvement boundary as poor", () => {
      expect(rateWebVital("FCP", 3001)).toBe("poor");
    });
    it("rates a very large value as poor", () => {
      expect(rateWebVital("FCP", 6000)).toBe("poor");
    });
  });

  it("rates a value of 0 as good for every vital", () => {
    expect(rateWebVital("LCP", 0)).toBe("good");
    expect(rateWebVital("CLS", 0)).toBe("good");
    expect(rateWebVital("FCP", 0)).toBe("good");
  });
});
