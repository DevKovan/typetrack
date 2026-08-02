// Unit tests for `sortByPriority` (Phase 7 issue 002). Pure logic, no I/O.
import { describe, expect, it } from "bun:test";
import type { AnalyticsProvider } from "./providers";
import { sortByPriority, type ProviderEntry } from "./routing";

function makeProvider(name: string): AnalyticsProvider {
  return {
    name,
    capabilities: {
      identify: true,
      group: true,
      alias: true,
      page: true,
      screen: true,
      batching: true,
      offline: true,
      featureFlags: true,
      sessionReplay: true,
      heatmaps: true,
    },
    track() {},
  };
}

describe("sortByPriority", () => {
  it("sorts entries with priorities [3, 1, 2] into [1, 2, 3] order", () => {
    const entries: ProviderEntry[] = [
      { provider: makeProvider("p3"), priority: 3 },
      { provider: makeProvider("p1"), priority: 1 },
      { provider: makeProvider("p2"), priority: 2 },
    ];
    const sorted = sortByPriority(entries);
    expect(sorted.map((e) => e.priority)).toEqual([1, 2, 3]);
    expect(sorted.map((e) => e.provider.name)).toEqual(["p1", "p2", "p3"]);
  });

  it("treats entries with no priority set as 0, sorting before positive-priority entries", () => {
    const entries: ProviderEntry[] = [
      { provider: makeProvider("positive"), priority: 5 },
      { provider: makeProvider("unset") },
    ];
    const sorted = sortByPriority(entries);
    expect(sorted.map((e) => e.provider.name)).toEqual(["unset", "positive"]);
  });

  it("preserves original relative order for entries with equal/tied priority, including multiple entries all lacking priority", () => {
    const entries: ProviderEntry[] = [
      { provider: makeProvider("first") },
      { provider: makeProvider("second") },
      { provider: makeProvider("third"), priority: 1 },
      { provider: makeProvider("fourth"), priority: 1 },
    ];
    const sorted = sortByPriority(entries);
    expect(sorted.map((e) => e.provider.name)).toEqual(["first", "second", "third", "fourth"]);
  });

  it("does not mutate the input array (same element order before/after the call, checked by reference)", () => {
    const p3 = { provider: makeProvider("p3"), priority: 3 };
    const p1 = { provider: makeProvider("p1"), priority: 1 };
    const p2 = { provider: makeProvider("p2"), priority: 2 };
    const entries: ProviderEntry[] = [p3, p1, p2];
    const original = [...entries];

    const sorted = sortByPriority(entries);

    expect(entries).toEqual(original);
    expect(entries[0]).toBe(p3);
    expect(entries[1]).toBe(p1);
    expect(entries[2]).toBe(p2);
    // The returned array is a distinct array instance from the input.
    expect(sorted).not.toBe(entries);
  });
});
