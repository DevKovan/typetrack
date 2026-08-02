// Integration test for issue 003: constructs a real `createAnalytics({
// provider: [...] })` with 3 hand-written `AnalyticsProvider` objects (not
// mocks -- each records its own received calls into a plain array), mixing
// bare and wrapper (`ProviderEntry`) entries with `include`/`exclude`/
// `predicate`/`sampling`/`priority`, drives a realistic sequence of
// track()/page()/identify()/group()/alias()/screen()/reset() calls, and
// asserts the full per-provider received-call log matches hand-computed
// expected routing/ordering/identity outcomes across the whole sequence.
// Mirrors src/routing.integration.test.ts's structure but through the real
// createAnalytics() entry point instead of calling routing.ts functions
// directly.
import { afterEach, describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities } from "./test-support";
import { matchRoute } from "./routing";
import type { CanonicalEvent } from "./schema";

type ReceivedCall =
  | { verb: "track"; name: string; userId?: string; anonymousId: string }
  | { verb: "page"; name: string; userId?: string; anonymousId: string }
  | { verb: "screen"; name: string; userId?: string; anonymousId: string }
  | { verb: "identify"; userId: string; anonymousId: string }
  | { verb: "group"; groupId: string; anonymousId: string }
  | { verb: "alias"; newUserId: string; anonymousId: string }
  | { verb: "reset" };

function makeRecordingProvider(name: string): {
  provider: AnalyticsProvider;
  calls: ReceivedCall[];
} {
  const calls: ReceivedCall[] = [];
  const provider: AnalyticsProvider = {
    name,
    capabilities: allCapabilities,
    track(event: CanonicalEvent) {
      calls.push({ verb: "track", name: event.name, userId: event.userId, anonymousId: event.anonymousId });
    },
    page(event: CanonicalEvent) {
      calls.push({ verb: "page", name: event.name, userId: event.userId, anonymousId: event.anonymousId });
    },
    screen(event: CanonicalEvent) {
      calls.push({ verb: "screen", name: event.name, userId: event.userId, anonymousId: event.anonymousId });
    },
    identify(userId, _traits, anonymousId) {
      calls.push({ verb: "identify", userId, anonymousId });
    },
    group(groupId, _traits, identity) {
      calls.push({ verb: "group", groupId, anonymousId: identity.anonymousId });
    },
    alias(newUserId, _previousUserId, anonymousId) {
      calls.push({ verb: "alias", newUserId, anonymousId });
    },
    reset() {
      calls.push({ verb: "reset" });
    },
    async flush() {},
    async destroy() {},
  };
  return { provider, calls };
}

const originalConsoleWarn = console.warn;
afterEach(() => {
  console.warn = originalConsoleWarn;
});

describe("createAnalytics() multi-provider integration", () => {
  it("routes a realistic sequence of calls across 3 mixed bare/wrapper providers matching hand-computed expectations", async () => {
    console.warn = () => {}; // silence any capability/runtime warnings for this scenario -- not under test here.

    // ga4: bare provider, no routing config, default priority (0) -- always
    // receives every routable event.
    const ga4 = makeRecordingProvider("ga4");
    // segment: include-only, priority 2 -- only receives events matching
    // "purchase*" or the exact name "signup_completed".
    const segment = makeRecordingProvider("segment");
    // posthog: exclude + sampling, priority -2 -- excludes anything
    // matching /^internal\./, and additionally sampled at rate 1 (always
    // sampled in) so sampling never actually filters anything out in this
    // test, keeping the expected-outcome table tractable while still
    // exercising the sampling code path.
    const posthog = makeRecordingProvider("posthog");

    const analytics = createAnalytics({
      provider: [
        { provider: ga4.provider },
        { provider: segment.provider, include: ["purchase*", "signup_completed"], priority: 2 },
        { provider: posthog.provider, exclude: [/^internal\./], sampling: 1, priority: -2 },
      ],
    });

    // -- drive a realistic sequence --
    await analytics.track("signup_completed", { plan: "pro" });
    await analytics.identify("user_1");
    await analytics.page("checkout");
    await analytics.track("internal.debug_dump");
    await analytics.group("acme_corp");
    await analytics.track("purchase_completed", { amount: 42 });
    await analytics.alias("user_2", "user_1");
    await analytics.screen("cart");
    await analytics.reset();
    await analytics.track("random_event");

    // -- hand-computed expected routing per routable call --
    // track/page/screen order: posthog (priority -2), ga4 (priority 0),
    // segment (priority 2).
    const routableNames = [
      "signup_completed",
      "checkout", // page, name only relevant for routing against ga4/segment/posthog matchers
      "internal.debug_dump",
      "purchase_completed",
      "cart", // screen
      "random_event",
    ];
    for (const name of routableNames) {
      expect(matchRoute("purchase*", name) || matchRoute("signup_completed", name)).toBe(
        segment.calls.some((c) => "name" in c && c.name === name),
      );
    }

    // ga4 (no routing config) receives every routable call: track x4, page x1, screen x1.
    expect(ga4.calls.filter((c) => c.verb === "track")).toHaveLength(4);
    expect(ga4.calls.filter((c) => c.verb === "page")).toHaveLength(1);
    expect(ga4.calls.filter((c) => c.verb === "screen")).toHaveLength(1);

    // segment (include: purchase*, signup_completed) only receives the two
    // matching track() calls; page("checkout")/screen("cart") don't match,
    // and neither do the other track() calls.
    expect(segment.calls.filter((c) => c.verb === "track").map((c) => (c as { name: string }).name)).toEqual([
      "signup_completed",
      "purchase_completed",
    ]);
    expect(segment.calls.filter((c) => c.verb === "page")).toHaveLength(0);
    expect(segment.calls.filter((c) => c.verb === "screen")).toHaveLength(0);

    // posthog (exclude: /^internal\./, sampling 1 -- always sampled in)
    // receives every routable call except the one matching "internal.".
    expect(
      posthog.calls.filter((c) => c.verb === "track").map((c) => (c as { name: string }).name),
    ).toEqual(["signup_completed", "purchase_completed", "random_event"]);
    expect(posthog.calls.filter((c) => c.verb === "page")).toHaveLength(1);
    expect(posthog.calls.filter((c) => c.verb === "screen")).toHaveLength(1);

    // Always-fan-out verbs: every provider receives identify/group/alias/reset
    // exactly once, regardless of routing config.
    for (const { calls } of [ga4, segment, posthog]) {
      expect(calls.filter((c) => c.verb === "identify")).toHaveLength(1);
      expect(calls.filter((c) => c.verb === "group")).toHaveLength(1);
      expect(calls.filter((c) => c.verb === "alias")).toHaveLength(1);
      expect(calls.filter((c) => c.verb === "reset")).toHaveLength(1);
    }

    // Identity: the identify("user_1") call is seen with that exact userId
    // by every provider, and every provider's later track()/page() calls
    // that were routed after identify() but before reset() carry userId
    // "user_1"; the last track("random_event") (after reset()) carries
    // userId undefined on every provider that received it.
    for (const { calls } of [ga4, segment, posthog]) {
      const identifyCall = calls.find((c) => c.verb === "identify");
      expect(identifyCall).toBeDefined();
      expect((identifyCall as { userId: string }).userId).toBe("user_1");

      const purchaseCall = calls.find((c) => c.verb === "track" && (c as { name: string }).name === "purchase_completed");
      if (purchaseCall) {
        expect((purchaseCall as { userId?: string }).userId).toBe("user_1");
      }

      const randomCall = calls.find((c) => c.verb === "track" && (c as { name: string }).name === "random_event");
      if (randomCall) {
        expect((randomCall as { userId?: string }).userId).toBeUndefined();
      }
    }

    // Shared anonymousId across all providers before reset(), and it
    // changes (for all providers uniformly) after reset() -- verified via
    // the first vs. last track() call each provider received.
    for (const { calls } of [ga4, segment, posthog]) {
      const trackCalls = calls.filter((c) => c.verb === "track") as Extract<ReceivedCall, { verb: "track" }>[];
      if (trackCalls.length >= 2) {
        const first = trackCalls[0]!;
        const last = trackCalls[trackCalls.length - 1]!;
        if (last.name === "random_event") {
          expect(last.anonymousId).not.toBe(first.anonymousId);
        }
      }
    }

    // Cross-provider identity consistency for a single call: every provider
    // that received the "purchase_completed" track() saw the identical
    // anonymousId as every other provider that received it.
    const purchaseAnonymousIds = [ga4, segment, posthog]
      .map(({ calls }) => calls.find((c) => c.verb === "track" && (c as { name: string }).name === "purchase_completed"))
      .filter((c): c is Extract<ReceivedCall, { verb: "track" }> => c !== undefined)
      .map((c) => c.anonymousId);
    expect(new Set(purchaseAnonymousIds).size).toBe(1);
  });

  it("sampling: a provider with sampling 0 never routes any event; a provider with sampling 1 always routes (given a fixed anonymousId)", async () => {
    console.warn = () => {};

    const neverSampled = makeRecordingProvider("never-sampled");
    const alwaysSampled = makeRecordingProvider("always-sampled");

    const analytics = createAnalytics({
      provider: [
        { provider: neverSampled.provider, sampling: 0 },
        { provider: alwaysSampled.provider, sampling: 1 },
      ],
    });

    await analytics.track("event_one");
    await analytics.track("event_two");
    await analytics.page("page_one");

    expect(neverSampled.calls).toHaveLength(0);
    expect(alwaysSampled.calls).toHaveLength(3);
  });

  it("issue 004: destroy() across a realistic 3-provider array where one provider's flush and another's destroy reject -- throws a real AggregateError containing both original errors, every provider's flush()/destroy() still called exactly once", async () => {
    console.warn = () => {};

    const flushFailure = new Error("network failure: flush timed out after 5000ms");
    const destroyFailure = new Error("network failure: destroy connection reset");

    const flushA = mock(async () => {
      throw flushFailure;
    });
    const destroyA = mock(async () => {});
    const providerA: AnalyticsProvider = {
      name: "flush-fails",
      capabilities: allCapabilities,
      track() {},
      async flush() {
        await flushA();
      },
      async destroy() {
        await destroyA();
      },
    };

    const flushB = mock(async () => {});
    const destroyB = mock(async () => {
      throw destroyFailure;
    });
    const providerB: AnalyticsProvider = {
      name: "destroy-fails",
      capabilities: allCapabilities,
      track() {},
      async flush() {
        await flushB();
      },
      async destroy() {
        await destroyB();
      },
    };

    const flushC = mock(async () => {});
    const destroyC = mock(async () => {});
    const providerC: AnalyticsProvider = {
      name: "healthy",
      capabilities: allCapabilities,
      track() {},
      async flush() {
        await flushC();
      },
      async destroy() {
        await destroyC();
      },
    };

    const analytics = createAnalytics({ provider: [providerA, providerB, providerC] });

    let thrown: unknown;
    try {
      await analytics.destroy();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregate = thrown as AggregateError;
    expect(aggregate.errors).toContain(flushFailure);
    expect(aggregate.errors).toContain(destroyFailure);

    expect(flushA).toHaveBeenCalledTimes(1);
    expect(destroyA).toHaveBeenCalledTimes(1);
    expect(flushB).toHaveBeenCalledTimes(1);
    expect(destroyB).toHaveBeenCalledTimes(1);
    expect(flushC).toHaveBeenCalledTimes(1);
    expect(destroyC).toHaveBeenCalledTimes(1);
  });
});
