// Integration tests for `loggingMiddleware`, `enrichmentMiddleware`,
// `versionMiddleware`, and `timingMiddleware` (Phase 8 issue 005): constructs
// real `createAnalytics({ provider: [...] })` instances with hand-written
// `AnalyticsProvider` stubs (recording received events, no mocks), registers
// a realistic combination of these built-ins via real `.use()` calls, and
// drives a realistic `track()`/`page()` sequence -- asserting on what the
// providers actually received and that the `onTiming`/logging side effects
// fired as expected.
import { afterEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "../index";
import { enrichmentMiddleware } from "./enrichment";
import { loggingMiddleware } from "./logging";
import { timingMiddleware } from "./timing";
import { versionMiddleware } from "./version";
import type { AnalyticsProvider } from "../providers";
import type { CanonicalEvent } from "../schema";
import { allCapabilities } from "../test-support";

function makeRecordingProvider(name: string): { provider: AnalyticsProvider; events: CanonicalEvent[] } {
  const events: CanonicalEvent[] = [];
  const provider: AnalyticsProvider = {
    name,
    capabilities: allCapabilities,
    track(event) {
      events.push(event);
    },
    page(event) {
      events.push(event);
    },
  };
  return { provider, events };
}

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
afterEach(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
});

describe("builtin middleware (logging/enrichment/version/timing) integration", () => {
  it("versionMiddleware + enrichmentMiddleware + timingMiddleware + loggingMiddleware together, across track() and page()", async () => {
    console.log = () => {};
    console.warn = () => {};

    const segment = makeRecordingProvider("segment");
    const posthog = makeRecordingProvider("posthog");

    const analytics = createAnalytics({ provider: [segment.provider, posthog.provider] });

    const clockValues = [1000, 1200, 2000, 2400];
    let callIndex = 0;
    const now = () => clockValues[callIndex++]!;

    const timings: { name: string; durationMs: number }[] = [];

    // Registration order: transformers (version, enrichment) first, then
    // timing (which needs to see the fully-transformed pre-dispatch event
    // reference so its before()/after() pairing lines up), then logging
    // (a pure observer -- safe anywhere, placed last here).
    analytics.use(versionMiddleware({ appVersion: "2.1.0", buildId: "build-77" }));
    analytics.use(enrichmentMiddleware({ properties: { environment: "production" } }));
    analytics.use(
      timingMiddleware({
        now,
        onTiming: (event, durationMs) => {
          timings.push({ name: event.name, durationMs });
        },
      }),
    );
    analytics.use(loggingMiddleware());

    await analytics.track("checkout_started", { cartValue: 42 });
    await analytics.page("pricing", { plan: "pro" });

    // Both providers received both events, with version metadata and
    // enrichment properties applied.
    for (const { events } of [segment, posthog]) {
      expect(events).toHaveLength(2);

      const [trackEvent, pageEvent] = events;
      expect(trackEvent!.name).toBe("checkout_started");
      expect(trackEvent!.properties).toEqual({ cartValue: 42, environment: "production" });
      expect(trackEvent!.metadata).toEqual({ appVersion: "2.1.0", buildId: "build-77" });

      expect(pageEvent!.name).toBe("pricing");
      expect(pageEvent!.properties).toEqual({ plan: "pro", environment: "production" });
      expect(pageEvent!.metadata).toEqual({ appVersion: "2.1.0", buildId: "build-77" });
    }

    // Timing fired once per event, each paired with its own controlled
    // clock values (not cross-contaminated between the two calls).
    expect(timings).toHaveLength(2);
    expect(timings[0]).toEqual({ name: "checkout_started", durationMs: 200 });
    expect(timings[1]).toEqual({ name: "pricing", durationMs: 400 });
  });

  it("loggingMiddleware's custom `log` override observes real before/after activity from a full track() round-trip", async () => {
    const stub = makeRecordingProvider("stub");
    const analytics = createAnalytics({ provider: stub.provider });

    const logCalls: { message: string; data: unknown }[] = [];
    analytics.use(loggingMiddleware({ log: (message, data) => logCalls.push({ message, data }) }));

    await analytics.track("signup_completed", { plan: "free" });

    expect(stub.events).toHaveLength(1);
    // before() + after() -> exactly 2 log calls for this one event.
    expect(logCalls).toHaveLength(2);
    expect(logCalls[0]!.message).toContain("signup_completed");
    expect(logCalls[1]!.message).toContain("signup_completed");
  });

  it("loggingMiddleware's onError fires (via the custom log override) when a provider rejects", async () => {
    console.warn = () => {};

    const failingProvider: AnalyticsProvider = {
      name: "failing-provider",
      capabilities: allCapabilities,
      track() {
        throw new Error("provider exploded");
      },
    };
    const analytics = createAnalytics({ provider: failingProvider });

    const logCalls: { message: string; data: unknown }[] = [];
    analytics.use(loggingMiddleware({ log: (message, data) => logCalls.push({ message, data }) }));

    await analytics.track("checkout_started", { cartValue: 10 });

    // before() + onError() + after() -> exactly 3 log calls. The provider
    // throws synchronously inside dispatch, so `onError` fires (from
    // `callSingleProvider`'s failure handling) before the `after()` chain
    // runs (dispatch itself never rejects -- the failure is swallowed).
    expect(logCalls).toHaveLength(3);
    const errorCall = logCalls[1]!;
    expect(errorCall.message).toContain("checkout_started");
    expect(errorCall.message).toContain("failing-provider");
    expect(errorCall.data).toBeInstanceOf(Error);
    expect((errorCall.data as Error).message).toBe("provider exploded");
  });

  it("versionMiddleware's injected metadata survives alongside app-supplied TrackOptions.metadata through the real pipeline", async () => {
    const stub = makeRecordingProvider("stub");
    const analytics = createAnalytics({ provider: stub.provider });
    analytics.use(versionMiddleware({ appVersion: "3.0.0" }));

    await analytics.track("checkout_started", { cartValue: 5 }, { metadata: { experiment: "checkout-v2" } });

    expect(stub.events).toHaveLength(1);
    expect(stub.events[0]!.metadata).toEqual({ experiment: "checkout-v2", appVersion: "3.0.0" });
  });

  it("enrichmentMiddleware's function form receives the real per-call event through the full pipeline", async () => {
    const stub = makeRecordingProvider("stub");
    const analytics = createAnalytics({ provider: stub.provider });
    analytics.use(enrichmentMiddleware({ properties: (event) => ({ eventNameEcho: event.name }) }));

    await analytics.track("checkout_started", { cartValue: 5 });
    await analytics.track("signup_completed", { plan: "pro" });

    expect(stub.events).toHaveLength(2);
    expect(stub.events[0]!.properties).toEqual({ cartValue: 5, eventNameEcho: "checkout_started" });
    expect(stub.events[1]!.properties).toEqual({ plan: "pro", eventNameEcho: "signup_completed" });
  });

  it("timingMiddleware's onTiming correctly pairs two concurrent/interleaved track() calls through the real pipeline", async () => {
    const stub = makeRecordingProvider("stub");
    const analytics = createAnalytics({ provider: stub.provider });

    const timings: { name: string; durationMs: number }[] = [];
    analytics.use(
      timingMiddleware({
        onTiming: (event, durationMs) => {
          timings.push({ name: event.name, durationMs });
        },
      }),
    );

    // Two real, overlapping track() calls -- the provider for "slow_event"
    // artificially delays before resolving, so "fast_event"'s full
    // before->dispatch->after cycle completes while "slow_event"'s is still
    // in flight (a real interleaving, not a hand-simulated one).
    const slowProvider = stub.provider;
    const originalTrack = slowProvider.track.bind(slowProvider);
    let sawSlowStart = false;
    slowProvider.track = async (event: CanonicalEvent) => {
      if (event.name === "slow_event") {
        sawSlowStart = true;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      originalTrack(event);
    };

    await Promise.all([analytics.track("slow_event", {}), analytics.track("fast_event", {})]);

    expect(sawSlowStart).toBe(true);
    expect(timings).toHaveLength(2);
    const byName = new Map(timings.map((t) => [t.name, t.durationMs]));
    expect(byName.get("slow_event")).toBeGreaterThanOrEqual(30);
    expect(byName.get("fast_event")).toBeDefined();
    expect(byName.get("fast_event")!).toBeLessThan(byName.get("slow_event")!);
  });
});
