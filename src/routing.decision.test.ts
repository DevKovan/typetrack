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

describe("shouldRouteToProvider", () => {
  it("routes always (true) when no routing config is set, for any event name/anonymousId", () => {
    const entry: ProviderEntry = { provider: makeProvider("bare") };
    expect(shouldRouteToProvider(entry, makeEvent({ name: "anything", anonymousId: "a" }))).toBe(
      true,
    );
    expect(
      shouldRouteToProvider(entry, makeEvent({ name: "checkout_started", anonymousId: "b" })),
    ).toBe(true);
  });

  it("include: exact-match list routes matching names, blocks non-matching names", () => {
    const entry: ProviderEntry = { provider: makeProvider("include"), include: ["A", "B"] };
    expect(shouldRouteToProvider(entry, makeEvent({ name: "A" }))).toBe(true);
    expect(shouldRouteToProvider(entry, makeEvent({ name: "C" }))).toBe(false);
  });

  it("include: glob matcher routes matching names, blocks non-matching names", () => {
    const entry: ProviderEntry = { provider: makeProvider("include-glob"), include: ["check*"] };
    expect(shouldRouteToProvider(entry, makeEvent({ name: "checkout_started" }))).toBe(true);
    expect(shouldRouteToProvider(entry, makeEvent({ name: "other" }))).toBe(false);
  });

  it("exclude: RegExp matcher blocks matching names, routes non-matching names", () => {
    const entry: ProviderEntry = { provider: makeProvider("exclude"), exclude: [/^debug\./] };
    expect(shouldRouteToProvider(entry, makeEvent({ name: "debug.internal" }))).toBe(false);
    expect(shouldRouteToProvider(entry, makeEvent({ name: "real_event" }))).toBe(true);
  });

  it("predicate returning false blocks routing even with no include/exclude/sampling set", () => {
    const entry: ProviderEntry = { provider: makeProvider("pred-false"), predicate: () => false };
    expect(shouldRouteToProvider(entry, makeEvent())).toBe(false);
  });

  it("predicate returning true with no other config routes", () => {
    const entry: ProviderEntry = { provider: makeProvider("pred-true"), predicate: () => true };
    expect(shouldRouteToProvider(entry, makeEvent())).toBe(true);
  });

  it("predicate true combined with sampling: 0 blocks routing (AND semantics)", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("pred-and-sampling"),
      predicate: () => true,
      sampling: 0,
    };
    expect(shouldRouteToProvider(entry, makeEvent())).toBe(false);
  });

  it("sampling: 1 combined with predicate: () => false blocks routing", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("sampling-and-pred"),
      predicate: () => false,
      sampling: 1,
    };
    expect(shouldRouteToProvider(entry, makeEvent())).toBe(false);
  });

  it("include matching plus sampling: 0 blocks routing (include does not bypass sampling)", () => {
    const entry: ProviderEntry = {
      provider: makeProvider("include-and-sampling"),
      include: ["A"],
      sampling: 0,
    };
    expect(shouldRouteToProvider(entry, makeEvent({ name: "A" }))).toBe(false);
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
    shouldRouteToProvider(entry, event);
    // This implementation passes the same object reference straight through
    // (no copying/wrapping), so reference equality holds in addition to
    // field-by-field equality.
    expect(received).toBe(event);
    expect(received).toEqual(event);
  });
});
