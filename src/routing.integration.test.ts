// Integration test for `normalizeProviders` + `matchRoute` (Phase 7 issue
// 001): builds a realistic mixed `provider` input against real
// `AnalyticsProvider` stubs, normalizes it, then for a handful of realistic
// event names manually combines `matchRoute` over each entry's
// `include`/`exclude` and asserts the outcome matches hand-computed
// expectations.
import { describe, expect, it } from "bun:test";
import type { AnalyticsProvider } from "./providers";
import {
  isSampledIn,
  matchRoute,
  normalizeProviders,
  shouldRouteToProvider,
  sortByPriority,
  type ProviderEntry,
} from "./routing";
import type { CanonicalEvent } from "./schema";

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

// Integration test for `sortByPriority` + `shouldRouteToProvider` (Phase 7
// issue 002): builds a realistic multi-entry `ProviderEntry[]` mixing
// `include`, `exclude`, `predicate`, `sampling`, `priority`, and one entry
// with no routing config at all, runs several realistic `CanonicalEvent`s
// through `sortByPriority` then `shouldRouteToProvider` for each sorted
// entry -- the exact sequence issue 003 will perform inside
// `track()`/`page()`/`screen()` -- and asserts both the call order and the
// routed/skipped outcome per provider match hand-computed expectations.
describe("sortByPriority + shouldRouteToProvider integration", () => {
  function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
    return {
      name: "generic_event",
      properties: {},
      timestamp: 1_700_000_000_000,
      anonymousId: "anon",
      sessionId: "session",
      ...overrides,
    };
  }

  const ga4 = makeProvider("ga4"); // bare-equivalent: no routing config, priority unset (0)
  const segment = makeProvider("segment"); // include, priority 2
  const posthog = makeProvider("posthog"); // exclude, priority -1
  const mixpanel = makeProvider("mixpanel"); // predicate + sampling, priority 1

  const rawEntries: ProviderEntry[] = [
    { provider: ga4 },
    { provider: segment, include: ["purchase*", "signup_completed"], priority: 2 },
    { provider: posthog, exclude: [/^internal\./], priority: -1 },
    {
      provider: mixpanel,
      predicate: (event) => event.properties.plan === "pro",
      sampling: 0.5,
      priority: 1,
    },
  ];

  it("sorts entries into ascending priority order: posthog(-1), ga4(0), mixpanel(1), segment(2)", () => {
    const sorted = sortByPriority(rawEntries);
    expect(sorted.map((e) => e.provider.name)).toEqual(["posthog", "ga4", "mixpanel", "segment"]);
    // Original array order is untouched.
    expect(rawEntries.map((e) => e.provider.name)).toEqual([
      "ga4",
      "segment",
      "posthog",
      "mixpanel",
    ]);
  });

  it.each([
    // eventName, anonymousId, properties
    ["purchase_completed", "user-A", { plan: "pro" } as Record<string, unknown>],
    ["internal.debug", "user-B", {} as Record<string, unknown>],
    ["signup_completed", "user-C", { plan: "free" } as Record<string, unknown>],
  ] as const)(
    "routes %s through the sorted entries in priority order with hand-computed per-provider outcomes",
    (eventName, anonymousId, properties) => {
      const event = makeEvent({ name: eventName, anonymousId, properties });
      const sorted = sortByPriority(rawEntries);

      const decisions = sorted.map((entry) => ({
        provider: entry.provider.name,
        routed: shouldRouteToProvider(entry, event),
      }));

      const expectedMixpanelPredicate = properties.plan === "pro";
      const expectedMixpanelSampling = isSampledIn(anonymousId, 0.5);

      const expected = [
        { provider: "posthog", routed: !matchRoute(/^internal\./, eventName) },
        { provider: "ga4", routed: true },
        {
          provider: "mixpanel",
          routed: expectedMixpanelPredicate && expectedMixpanelSampling,
        },
        {
          provider: "segment",
          routed: ["purchase*", "signup_completed"].some((matcher) =>
            matchRoute(matcher, eventName),
          ),
        },
      ];

      expect(decisions).toEqual(expected);
      // Call order matches the sorted priority order regardless of routing
      // outcome -- sortByPriority never drops entries.
      expect(decisions.map((d) => d.provider)).toEqual(["posthog", "ga4", "mixpanel", "segment"]);
    },
  );

  it("hand-computed: 'purchase_completed' from 'user-A' routes to ga4, posthog, segment, and to mixpanel only if both predicate and sampling pass", () => {
    const event = makeEvent({
      name: "purchase_completed",
      anonymousId: "user-A",
      properties: { plan: "pro" },
    });
    const sorted = sortByPriority(rawEntries);

    expect(shouldRouteToProvider(sorted[0]!, event)).toBe(true); // posthog: not excluded
    expect(shouldRouteToProvider(sorted[1]!, event)).toBe(true); // ga4: no config
    expect(shouldRouteToProvider(sorted[2]!, event)).toBe(isSampledIn("user-A", 0.5)); // mixpanel: predicate passes, AND sampling
    expect(shouldRouteToProvider(sorted[3]!, event)).toBe(true); // segment: matches "purchase*"
  });

  it("hand-computed: 'internal.debug' is blocked from posthog (exclude) and segment (no include match), routes to ga4, blocked from mixpanel (predicate fails)", () => {
    const event = makeEvent({ name: "internal.debug", anonymousId: "user-B", properties: {} });
    const sorted = sortByPriority(rawEntries);

    expect(shouldRouteToProvider(sorted[0]!, event)).toBe(false); // posthog: excluded
    expect(shouldRouteToProvider(sorted[1]!, event)).toBe(true); // ga4: no config
    expect(shouldRouteToProvider(sorted[2]!, event)).toBe(false); // mixpanel: predicate fails (no plan)
    expect(shouldRouteToProvider(sorted[3]!, event)).toBe(false); // segment: no include match
  });
});
