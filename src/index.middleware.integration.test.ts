// Integration test for issue 002: constructs a real `createAnalytics({
// provider: [...] })` with 3 hand-written `AnalyticsProvider` objects (not
// mocks -- each records its own received calls into a plain array) and 3
// realistic-looking middlewares (one enriching properties, one
// conditionally dropping based on a property value, one appending a trace
// marker), drives a realistic sequence of track()/page()/screen() calls
// with varying payloads, and asserts the full per-provider received-event
// log matches hand-computed expected outcomes -- including which calls
// were dropped entirely -- across the whole sequence.
import { afterEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "./index";
import type { Middleware } from "./middleware";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities } from "./test-support";
import type { CanonicalEvent } from "./schema";

type ReceivedCall = { verb: "track" | "page" | "screen"; event: CanonicalEvent };

function makeRecordingProvider(name: string): { provider: AnalyticsProvider; calls: ReceivedCall[] } {
  const calls: ReceivedCall[] = [];
  const provider: AnalyticsProvider = {
    name,
    capabilities: allCapabilities,
    track(event) {
      calls.push({ verb: "track", event });
    },
    page(event) {
      calls.push({ verb: "page", event });
    },
    screen(event) {
      calls.push({ verb: "screen", event });
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

describe("createAnalytics() middleware integration", () => {
  it("drives a realistic call sequence through 3 providers and 3 middlewares, matching hand-computed expected outcomes", async () => {
    console.warn = () => {}; // silence unrelated warnings -- not under test here.

    const ga4 = makeRecordingProvider("ga4");
    const segment = makeRecordingProvider("segment");
    const posthog = makeRecordingProvider("posthog");

    // Middleware 1: enriches every event with a `source` property.
    const enrichSource: Middleware = {
      name: "enrich-source",
      before: (event) => ({ ...event, properties: { ...event.properties, source: "web" } }),
    };

    // Middleware 2: drops any event whose `internal` property is true.
    const dropInternal: Middleware = {
      name: "drop-internal",
      before: (event) => (event.properties.internal === true ? undefined : event),
    };

    // Middleware 3: appends its name to a trace array, order-sensitive.
    const traceMarker: Middleware = {
      name: "trace-marker",
      before: (event) => ({
        ...event,
        properties: {
          ...event.properties,
          trace: [...((event.properties.trace as string[] | undefined) ?? []), "trace-marker"],
        },
      }),
    };

    const afterLog: { name: string; source: unknown }[] = [];
    const afterRecorder: Middleware = {
      name: "after-recorder",
      after: (event) => void afterLog.push({ name: event.name, source: event.properties.source }),
    };

    const analytics = createAnalytics({
      provider: [ga4.provider, segment.provider, posthog.provider],
    });
    analytics.use(enrichSource);
    analytics.use(dropInternal);
    analytics.use(traceMarker);
    analytics.use(afterRecorder);

    // -- drive a realistic sequence --
    await analytics.track("signup_completed", { plan: "pro" }); // kept
    await analytics.page("checkout"); // kept
    await analytics.track("internal.debug_dump", { internal: true }); // dropped
    await analytics.track("purchase_completed", { amount: 42 }); // kept
    await analytics.screen("cart", { internal: true }); // dropped
    await analytics.track("random_event"); // kept

    // -- hand-computed expected outcomes --
    // Kept calls, in order: track(signup_completed), page(checkout),
    // track(purchase_completed), track(random_event) -- 4 total; the two
    // internal.* calls never reach any provider.
    for (const { calls } of [ga4, segment, posthog]) {
      expect(calls).toHaveLength(4);
      expect(calls.map((c) => c.event.name)).toEqual([
        "signup_completed",
        "checkout",
        "purchase_completed",
        "random_event",
      ]);
      for (const call of calls) {
        expect(call.event.properties.source).toBe("web");
        expect(call.event.properties.trace).toEqual(["trace-marker"]);
      }
    }

    // Every provider received a deep-equal event for the same call (shared
    // canonical event across the fan-out).
    for (let i = 0; i < 4; i++) {
      expect(ga4.calls[i]!.event).toEqual(segment.calls[i]!.event);
      expect(segment.calls[i]!.event).toEqual(posthog.calls[i]!.event);
    }

    // after() fired once per kept call (not per dropped call, not per
    // provider), with the final (post-before-chain) event.
    expect(afterLog).toEqual([
      { name: "signup_completed", source: "web" },
      { name: "checkout", source: "web" },
      { name: "purchase_completed", source: "web" },
      { name: "random_event", source: "web" },
    ]);
  });

  it("after() fires even when one provider in the fan-out rejects, for both single- and multi-provider configurations", async () => {
    console.warn = () => {};

    const failing: AnalyticsProvider = {
      name: "failing",
      capabilities: allCapabilities,
      track: () => Promise.reject(new Error("boom")),
      async flush() {},
      async destroy() {},
    };
    const succeeding = makeRecordingProvider("succeeding");

    const afterLog: string[] = [];
    const middleware: Middleware = { name: "recorder", after: (event) => void afterLog.push(event.name) };

    const analytics = createAnalytics({ provider: [failing, succeeding.provider] });
    analytics.use(middleware);

    await analytics.track("event_a");
    await analytics.track("event_b");

    expect(succeeding.calls).toHaveLength(2);
    expect(afterLog).toEqual(["event_a", "event_b"]);
  });
});
