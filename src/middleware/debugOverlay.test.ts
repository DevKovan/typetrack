// Unit tests for Phase 18 issue 004's pure, DOM-independent helpers
// (`formatOverlayTimestamp`/`appendWithEviction`) -- exercised directly, no
// `document`/browser globals involved. `debugOverlayMiddleware()`'s full
// mount/render/eviction round trip against a stubbed DOM is exercised by
// `debugOverlay.integration.test.ts` instead.
import { describe, expect, it } from "bun:test";
import { appendWithEviction, formatOverlayTimestamp } from "./debugOverlay";

describe("formatOverlayTimestamp", () => {
  it("formats midnight as 00:00:00", () => {
    const date = new Date(2024, 0, 1, 0, 0, 0);
    expect(formatOverlayTimestamp(date.getTime())).toBe("00:00:00");
  });

  it("zero-pads single-digit hours/minutes/seconds", () => {
    const date = new Date(2024, 0, 1, 3, 5, 9);
    expect(formatOverlayTimestamp(date.getTime())).toBe("03:05:09");
  });

  it("formats a typical afternoon time in 24-hour form", () => {
    const date = new Date(2024, 5, 15, 14, 32, 47);
    expect(formatOverlayTimestamp(date.getTime())).toBe("14:32:47");
  });

  it("formats one second before midnight as 23:59:59", () => {
    const date = new Date(2024, 0, 1, 23, 59, 59);
    expect(formatOverlayTimestamp(date.getTime())).toBe("23:59:59");
  });
});

describe("appendWithEviction", () => {
  it("appends to an empty buffer without evicting anything", () => {
    const result = appendWithEviction<string>([], "a", 3);
    expect(result).toEqual({ buffer: ["a"], evicted: undefined });
  });

  it("appends without evicting while under maxEvents", () => {
    const result = appendWithEviction(["a", "b"], "c", 3);
    expect(result).toEqual({ buffer: ["a", "b", "c"], evicted: undefined });
  });

  it("evicts the oldest (front) entry once maxEvents is exceeded", () => {
    const result = appendWithEviction(["a", "b", "c"], "d", 3);
    expect(result.buffer).toEqual(["b", "c", "d"]);
    expect(result.evicted).toBe("a");
  });

  it("never grows the buffer beyond maxEvents across repeated appends", () => {
    let buffer: number[] = [];
    for (let i = 0; i < 10; i++) {
      const result = appendWithEviction(buffer, i, 4);
      buffer = result.buffer;
    }
    expect(buffer).toEqual([6, 7, 8, 9]);
    expect(buffer.length).toBeLessThanOrEqual(4);
  });

  it("with a non-positive maxEvents, evicts the just-pushed item immediately and leaves an empty buffer", () => {
    const result = appendWithEviction(["a"], "b", 0);
    expect(result.buffer).toEqual([]);
    expect(result.evicted).toBe("b");
  });

  it("does not mutate the input buffer", () => {
    const input = ["a", "b"];
    appendWithEviction(input, "c", 5);
    expect(input).toEqual(["a", "b"]);
  });
});
