// Unit tests for Phase 10 issue 004's `computePagePerformanceProperties`
// (pure duration-field computation, exercised against a hand-constructed
// fake `PerformanceNavigationTiming`-shaped entry -- no `createAnalytics()`,
// no providers, no `performance` global). `autoPerformance()`'s full setup/
// load/teardown round trip is exercised by `telemetry.integration.test.ts`
// instead.
import { describe, expect, it } from "bun:test";
import { computePagePerformanceProperties } from "./autoPerformance";

describe("computePagePerformanceProperties", () => {
  it("computes every duration field from a fully-populated fake navigation timing entry", () => {
    const entry = {
      startTime: 0,
      domainLookupStart: 10,
      domainLookupEnd: 20,
      connectStart: 20,
      connectEnd: 35,
      requestStart: 35,
      responseStart: 60,
      responseEnd: 90,
      domContentLoadedEventEnd: 150,
      loadEventEnd: 220,
    };

    expect(computePagePerformanceProperties(entry)).toEqual({
      ttfb: 25, // responseStart - requestStart = 60 - 35
      domContentLoaded: 150, // domContentLoadedEventEnd - startTime = 150 - 0
      loadComplete: 220, // loadEventEnd - startTime = 220 - 0
      dnsMs: 10, // domainLookupEnd - domainLookupStart = 20 - 10
      tcpMs: 15, // connectEnd - connectStart = 35 - 20
      requestMs: 25, // responseStart - requestStart = 60 - 35 (same as ttfb)
      responseMs: 30, // responseEnd - responseStart = 90 - 60
    });
  });

  it("computes correctly when startTime is non-zero (navigation entry timestamps are relative to it)", () => {
    const entry = {
      startTime: 1000,
      domainLookupStart: 1010,
      domainLookupEnd: 1015,
      connectStart: 1015,
      connectEnd: 1025,
      requestStart: 1025,
      responseStart: 1040,
      responseEnd: 1055,
      domContentLoadedEventEnd: 1200,
      loadEventEnd: 1300,
    };

    expect(computePagePerformanceProperties(entry)).toEqual({
      ttfb: 15,
      domContentLoaded: 200,
      loadComplete: 300,
      dnsMs: 5,
      tcpMs: 10,
      requestMs: 15,
      responseMs: 15,
    });
  });

  it("defaults missing fields to 0 (defensive against a malformed/partial entry)", () => {
    expect(computePagePerformanceProperties({})).toEqual({
      ttfb: 0,
      domContentLoaded: 0,
      loadComplete: 0,
      dnsMs: 0,
      tcpMs: 0,
      requestMs: 0,
      responseMs: 0,
    });
  });
});
