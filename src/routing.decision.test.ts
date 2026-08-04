// Unit tests for `shouldRouteToProvider` (Phase 7 issue 002). Pure logic,
// no I/O.
import { describe, expect, it } from "bun:test";
import type { AnalyticsProvider } from "./providers";
import { shouldRouteToProvider, type ProviderEntry } from "./routing";
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

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "generic_event",
    properties: {},
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    sessionId: "session-1",
    ...overrides,
  };
}

// Phase 11 issue 005: `shouldRouteToProvider`'s 3rd parameter
// (`hasConsentFn`) is now required. `alwaysConsented`/`neverConsented` are
// used throughout the pre-existing (Phase 7) tests below, which don't care
// about consent at all -- `alwaysConsented` preserves their exact prior
// behavior (no `requiresConsent` on any of those entries, so the consent
// check is vacuously `true` regardless of the function supplied).
const alwaysConsented = () => true;
const neverConsented = () => false;

describe("shouldRouteToProvider", () => {
  it("routes always (true) when no routing config is set, for any event name/anonymousId", () => {
    const entry: ProviderEntry = { provider: makeProvider("bare") };
    expect(
      shouldRouteToProvider(entry, makeEvent({ name: "anything", anonymousId: "a" }), alwaysConsented),
    ).toBe(true);
    expect(
      shouldRouteToProvider(
        entry,
        makeEvent({ name: "checkout_started", anonymousId: "b" }),
        alwaysConsented,
      ),
    ).toBe(true);
  });

  it("include: exact-match list routes matching names, blocks non-matching names", () => {
    const entry: ProviderEntry = { provider: makeProvider("include"), include: ["A", "B"] };
    expect(shouldRouteToProvider(entry, makeEvent({ name: "A" }), alwaysConsented)).toBe(true);
    expect(shouldRouteToProvider(entry, makeEvent({ name: "C" }), alwaysConsented)).toBe(false);
  });

  it("include: glob matcher routes matching names, blocks non-matching names", () => {
    const entry: ProviderEntry = { provider: makeProvider("include-glob"), include: ["check*"] };
    expect(shouldRouteToProvider(entry, makeEvent({ name: "checkout_started" }), alwaysConsented)).toBe(
      true,
    );
    expect(shouldRouteToProvider(entry, makeEvent({ name: "other" }), alwaysConsented)).toBe(false);
  });

  it("exclude: RegExp matcher blocks matching names, routes non-matching names", () => {
    const entry: ProviderEntry = { provider: makeProvider("exclude"), exclude: [/^debug\./] };
    expect(shouldRouteToProvider(entry, makeEvent({ name: "debug.internal" }), alwaysConsented)).toBe(
      false,
    );
    expect(shouldRouteToProvider(entry, makeEvent({ name: "real_event" }), alwaysConsented)).toBe(true);
  });

  it("predicate returning false blocks routing even with no include/exclude/sampling set", () => {
    const entry: ProviderEntry = { provider: makeProvider("pred-false"), predicate: () => false };
    expect(shouldRouteToProvider(entry, makeEvent(), alwaysConsented)).toBe(false);
  });

  it("predicate returning true with no other config routes", () => {
    const entry: ProviderEntry = { provider: makeProvider("pred-true"), predicate: () => true };
    expect(shouldRouteToProvider(entry, makeEvent(), alwaysConsented)).toBe(true);
  });

  it("predicate true combined with sampling: 0 blocks routing (AND semantics)", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("pred-and-sampling"),
      predicate: () => true,
      sampling: 0,
    };
    expect(shouldRouteToProvider(entry, makeEvent(), alwaysConsented)).toBe(false);
  });

  it("sampling: 1 combined with predicate: () => false blocks routing", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("sampling-and-pred"),
      predicate: () => false,
      sampling: 1,
    };
    expect(shouldRouteToProvider(entry, makeEvent(), alwaysConsented)).toBe(false);
  });

  it("include matching plus sampling: 0 blocks routing (include does not bypass sampling)", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("include-and-sampling"),
      include: ["A"],
      sampling: 0,
    };
    expect(shouldRouteToProvider(entry, makeEvent({ name: "A" }), alwaysConsented)).toBe(false);
  });

  it("passes the exact CanonicalEvent object to entry.predicate", () => {
    let received: CanonicalEvent | undefined;
    const entry: ProviderEntry = {
      provider: makeProvider("predicate-spy"),
      predicate: (event) => {
        received = event;
        return true;
      },
    };
    const event = makeEvent({ name: "spy_event", anonymousId: "spy-anon" });
    shouldRouteToProvider(entry, event, alwaysConsented);
    // This implementation passes the same object reference straight through
    // (no copying/wrapping), so reference equality holds in addition to
    // field-by-field equality.
    expect(received).toBe(event);
    expect(received).toEqual(event);
  });
});

// Phase 11 issue 005: `requiresConsent` crossed with `hasConsentFn`, and
// crossed with an existing include/exclude rule to confirm AND composition.
describe("shouldRouteToProvider: requiresConsent", () => {
  it("no requiresConsent set: routes regardless of hasConsentFn (vacuously consented)", () => {
    const entry: ProviderEntry = { provider: makeProvider("no-consent-requirement") };
    expect(shouldRouteToProvider(entry, makeEvent(), alwaysConsented)).toBe(true);
    expect(shouldRouteToProvider(entry, makeEvent(), neverConsented)).toBe(true);
  });

  it("requiresConsent: [] behaves identically to undefined (vacuously consented)", () => {
    const entry: ProviderEntry = { provider: makeProvider("empty-consent-requirement"), requiresConsent: [] };
    expect(shouldRouteToProvider(entry, makeEvent(), neverConsented)).toBe(true);
  });

  it("requiresConsent set, hasConsentFn grants every listed category: routes", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("consented"),
      requiresConsent: ["marketing"],
    };
    expect(shouldRouteToProvider(entry, makeEvent(), alwaysConsented)).toBe(true);
  });

  it("requiresConsent set, hasConsentFn denies: blocks routing entirely", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("denied"),
      requiresConsent: ["marketing"],
    };
    expect(shouldRouteToProvider(entry, makeEvent(), neverConsented)).toBe(false);
  });

  it("requiresConsent with multiple categories: every category must be granted", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("multi-category"),
      requiresConsent: ["analytics", "marketing"],
    };
    const onlyAnalyticsGranted = (category: string) => category === "analytics";
    expect(shouldRouteToProvider(entry, makeEvent(), onlyAnalyticsGranted)).toBe(false);
    const bothGranted = (category: string) => category === "analytics" || category === "marketing";
    expect(shouldRouteToProvider(entry, makeEvent(), bothGranted)).toBe(true);
  });

  it("AND composition: consent-denied blocks routing even when include matches (consent-denied always wins)", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("include-and-consent"),
      include: ["checkout_started"],
      requiresConsent: ["marketing"],
    };
    // include matches, but consent denied -> blocked.
    expect(
      shouldRouteToProvider(entry, makeEvent({ name: "checkout_started" }), neverConsented),
    ).toBe(false);
    // include matches AND consent granted -> routed.
    expect(
      shouldRouteToProvider(entry, makeEvent({ name: "checkout_started" }), alwaysConsented),
    ).toBe(true);
  });

  it("AND composition: consent granted but exclude matches still blocks routing", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("exclude-and-consent"),
      exclude: [/^debug\./],
      requiresConsent: ["analytics"],
    };
    expect(
      shouldRouteToProvider(entry, makeEvent({ name: "debug.internal" }), alwaysConsented),
    ).toBe(false);
    expect(
      shouldRouteToProvider(entry, makeEvent({ name: "real_event" }), alwaysConsented),
    ).toBe(true);
  });

  it("consent check short-circuits before include/exclude/predicate/sampling: predicate is never invoked when consent is denied", () => {
    let predicateCalled = false;
    const entry: ProviderEntry = {
      provider: makeProvider("short-circuit"),
      requiresConsent: ["marketing"],
      predicate: () => {
        predicateCalled = true;
        return true;
      },
    };
    expect(shouldRouteToProvider(entry, makeEvent(), neverConsented)).toBe(false);
    expect(predicateCalled).toBe(false);
  });
});
