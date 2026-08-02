// Integration test for `normalizeProviders` + `matchRoute` (Phase 7 issue
// 001): builds a realistic mixed `provider` input against real
// `AnalyticsProvider` stubs, normalizes it, then for a handful of realistic
// event names manually combines `matchRoute` over each entry's
// `include`/`exclude` and asserts the outcome matches hand-computed
// expectations.
import { describe, expect, it } from "bun:test";
import type { AnalyticsProvider } from "./providers";
import { matchRoute, normalizeProviders, type ProviderEntry } from "./routing";

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

// Combines an entry's `include`/`exclude` matchers into a single pass/fail
// decision for a given event name -- mirrors the (not-yet-built, issue 002)
// runtime decision logic just enough to exercise `matchRoute` against real
// route lists.
function entryAcceptsEvent(entry: ProviderEntry, eventName: string): boolean {
  if (entry.include !== undefined) {
    return entry.include.some((matcher) => matchRoute(matcher, eventName));
  }
  if (entry.exclude !== undefined) {
    return !entry.exclude.some((matcher) => matchRoute(matcher, eventName));
  }
  return true;
}

describe("normalizeProviders + matchRoute integration", () => {
  const bareProvider = makeProvider("ga4");
  const includeProvider = makeProvider("segment");
  const excludeProvider = makeProvider("posthog");

  const rawInput = [
    bareProvider,
    { provider: includeProvider, include: ["User Signed Up", "check*"] },
    { provider: excludeProvider, exclude: [/^debug\./] },
  ];

  const { entries, isMulti } = normalizeProviders(rawInput);

  it("normalizes the mixed input into three entries and reports isMulti: true", () => {
    expect(isMulti).toBe(true);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ provider: bareProvider });
    expect(entries[1]).toEqual({
      provider: includeProvider,
      include: ["User Signed Up", "check*"],
    });
    expect(entries[2]).toEqual({
      provider: excludeProvider,
      exclude: [/^debug\./],
    });
  });

  it.each([
    // eventName, expected [bare, include-provider, exclude-provider]
    ["User Signed Up", [true, true, true]],
    ["Checkout Started", [true, false, true]],
    ["debug.internal", [true, false, false]],
  ] as const)("routes %s as expected across all three entries", (eventName, expected) => {
    const actual = entries.map((entry) => entryAcceptsEvent(entry, eventName));
    expect(actual).toEqual([...expected]);
  });

  it("hand-computed: 'Checkout Started' matches the include provider's glob 'check*' case-insensitively-anchored (still requires prefix match)", () => {
    // "check*" glob: literal "check" prefix, anchored -- "Checkout Started"
    // does NOT match because matching is case-sensitive and the event name
    // starts with uppercase "C", not lowercase "c".
    expect(matchRoute("check*", "Checkout Started")).toBe(false);
    expect(matchRoute("check*", "checkout_started")).toBe(true);
  });

  it("hand-computed: 'debug.internal' is excluded only by the exclude-provider's RegExp", () => {
    expect(matchRoute(/^debug\./, "debug.internal")).toBe(true);
    expect(matchRoute("User Signed Up", "debug.internal")).toBe(false);
    expect(matchRoute("check*", "debug.internal")).toBe(false);
  });
});
