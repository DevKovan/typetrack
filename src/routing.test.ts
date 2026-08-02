// Unit tests for `matchRoute`, `normalizeProviders`, `hashToUnitInterval`,
// and `isSampledIn` (Phase 7 issue 001). Pure logic, no I/O.
import { describe, expect, it } from "bun:test";
import type { AnalyticsProvider } from "./providers";
import {
  hashToUnitInterval,
  isSampledIn,
  matchRoute,
  normalizeProviders,
} from "./routing";

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

describe("matchRoute", () => {
  it("exact string match is case-sensitive equality", () => {
    expect(matchRoute("checkout_started", "checkout_started")).toBe(true);
    expect(matchRoute("checkout_started", "Checkout_Started")).toBe(false);
    expect(matchRoute("checkout_started", "checkout_started_extra")).toBe(false);
  });

  it("glob prefix: literal '.' is escaped, does not become 'any char'", () => {
    expect(matchRoute("checkout.*", "checkout.started")).toBe(true);
    expect(matchRoute("checkout.*", "checkoutXstarted")).toBe(false);
  });

  it("glob suffix matches events ending with the literal tail", () => {
    expect(matchRoute("*.completed", "order.completed")).toBe(true);
    expect(matchRoute("*.completed", "order.completed.extra")).toBe(false);
    expect(matchRoute("*.completed", "completed")).toBe(false);
  });

  it("glob middle matches events with the literal head and tail", () => {
    expect(matchRoute("order.*.completed", "order.123.completed")).toBe(true);
    expect(matchRoute("order.*.completed", "order..completed")).toBe(true);
    expect(matchRoute("order.*.completed", "order.completed")).toBe(false);
  });

  it("bare '*' matches everything, including the empty string", () => {
    expect(matchRoute("*", "")).toBe(true);
    expect(matchRoute("*", "anything")).toBe(true);
    expect(matchRoute("*", "User Signed Up")).toBe(true);
  });

  it("a RegExp instance is used as-is, including flags", () => {
    expect(matchRoute(/^user_/i, "USER_signed_up")).toBe(true);
    expect(matchRoute(/^user_/, "USER_signed_up")).toBe(false);
  });

  it("returns false for a non-matching matcher", () => {
    expect(matchRoute("checkout_started", "signup_completed")).toBe(false);
    expect(matchRoute("checkout.*", "signup_completed")).toBe(false);
    expect(matchRoute(/^checkout_/, "signup_completed")).toBe(false);
  });
});

describe("normalizeProviders", () => {
  it("normalizes a bare AnalyticsProvider to a single wrapped entry, isMulti: false", () => {
    const provider = makeProvider("segment");
    expect(normalizeProviders(provider)).toEqual({
      entries: [{ provider }],
      isMulti: false,
    });
  });

  it("normalizes a lone ProviderEntry object, isMulti: true", () => {
    const provider = makeProvider("posthog");
    const entry = { provider, priority: 5 };
    expect(normalizeProviders(entry)).toEqual({
      entries: [entry],
      isMulti: true,
    });
  });

  it("normalizes an array of length 1, isMulti: true", () => {
    const provider = makeProvider("ga4");
    expect(normalizeProviders([provider])).toEqual({
      entries: [{ provider }],
      isMulti: true,
    });
  });

  it("normalizes a mixed bare/wrapper array, each element normalized correctly", () => {
    const bare = makeProvider("bare");
    const wrappedProvider = makeProvider("wrapped");
    const wrapped = { provider: wrappedProvider, sampling: 0.5 };
    const result = normalizeProviders([bare, wrapped]);
    expect(result).toEqual({
      entries: [{ provider: bare }, wrapped],
      isMulti: true,
    });
  });

  it("normalizes an empty array to zero entries, isMulti: true", () => {
    expect(normalizeProviders([])).toEqual({ entries: [], isMulti: true });
  });

  it("throws synchronously when an entry has both include and exclude", () => {
    const provider = makeProvider("dual-config");
    expect(() =>
      normalizeProviders({
        provider,
        include: ["a"],
        exclude: ["b"],
      }),
    ).toThrow(/dual-config/);
    expect(() =>
      normalizeProviders({
        provider,
        include: ["a"],
        exclude: ["b"],
      }),
    ).toThrow(/include/);
    expect(() =>
      normalizeProviders({
        provider,
        include: ["a"],
        exclude: ["b"],
      }),
    ).toThrow(/exclude/);
  });

  it("throws even when both include and exclude are present as empty arrays", () => {
    const provider = makeProvider("empty-arrays");
    expect(() =>
      normalizeProviders({ provider, include: [], exclude: [] }),
    ).toThrow(/empty-arrays/);
  });

  it("does not throw when only include is present", () => {
    const provider = makeProvider("include-only");
    expect(() => normalizeProviders({ provider, include: ["a"] })).not.toThrow();
  });

  it("does not throw when only exclude is present", () => {
    const provider = makeProvider("exclude-only");
    expect(() => normalizeProviders({ provider, exclude: ["a"] })).not.toThrow();
  });

  it("does not throw when neither include nor exclude is present", () => {
    const provider = makeProvider("neither");
    expect(() => normalizeProviders({ provider })).not.toThrow();
  });

  it("throws for a conflicting entry inside an array", () => {
    const ok = makeProvider("ok");
    const bad = makeProvider("bad");
    expect(() =>
      normalizeProviders([{ provider: ok }, { provider: bad, include: ["x"], exclude: ["y"] }]),
    ).toThrow(/bad/);
  });
});

describe("hashToUnitInterval", () => {
  it("is deterministic across repeated calls with the same input", () => {
    const first = hashToUnitInterval("user-123");
    const second = hashToUnitInterval("user-123");
    expect(first).toBe(second);
  });

  it("always returns a value in [0, 1) across varied inputs", () => {
    const inputs = ["", "a", "user-123", "6f2a9c3d-1b4e-4d5a-9f8e-1234567890ab", "🎉 unicode", "a".repeat(500)];
    for (const input of inputs) {
      const result = hashToUnitInterval(input);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(1);
    }
  });

  it("matches an independently-computed FNV-1a-32 value for a fixed string", () => {
    // FNV-1a-32("hello") = 0x4f9f2cab = 1335831723 (independently verified).
    const expectedRawHash = 0x4f9f2cab;
    expect(hashToUnitInterval("hello")).toBeCloseTo(expectedRawHash / 2 ** 32, 12);
  });
});

describe("isSampledIn", () => {
  it("is always false when samplingRate is 0", () => {
    const ids = ["a", "b", "user-1", "6f2a9c3d-1b4e-4d5a-9f8e-1234567890ab", ""];
    for (const id of ids) {
      expect(isSampledIn(id, 0)).toBe(false);
    }
  });

  it("is always true when samplingRate is 1", () => {
    const ids = ["a", "b", "user-1", "6f2a9c3d-1b4e-4d5a-9f8e-1234567890ab", ""];
    for (const id of ids) {
      expect(isSampledIn(id, 1)).toBe(true);
    }
  });

  it("is deterministic for a fixed (id, rate) pair", () => {
    const first = isSampledIn("stable-id", 0.5);
    const second = isSampledIn("stable-id", 0.5);
    expect(first).toBe(second);
  });

  it("lands within a loose tolerance band across ~1000 UUID-shaped ids at rate 0.5", () => {
    function fakeUuid(i: number): string {
      const hex = i.toString(16).padStart(8, "0");
      return `${hex}-0000-4000-8000-000000000000`;
    }

    const total = 1000;
    let sampledInCount = 0;
    for (let i = 0; i < total; i++) {
      if (isSampledIn(fakeUuid(i), 0.5)) {
        sampledInCount++;
      }
    }

    const fraction = sampledInCount / total;
    expect(fraction).toBeGreaterThan(0.35);
    expect(fraction).toBeLessThan(0.65);
  });
});
