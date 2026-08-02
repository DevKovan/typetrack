// Integration test for `Analytics.use()` (Phase 8 issue 001): constructs a
// real `createAnalytics()` instance against a real `AnalyticsProvider` stub,
// registers a handful of realistic-looking middleware objects, and asserts
// that registering them doesn't throw and doesn't change `track()`'s
// behavior at all -- the chain isn't wired into any verb yet (issue 002's
// scope). This is a regression guard, not a middleware-pipeline test.
import { describe, expect, it } from "bun:test";
import { createAnalytics } from "./index";
import type { Middleware } from "./middleware";
import type { AnalyticsProvider } from "./providers";
import type { CanonicalEvent } from "./schema";
import { allCapabilities } from "./test-support";

type AppEvents = {
  signup_completed: { plan: "free" | "pro" };
};

class RecordingProvider implements AnalyticsProvider {
  name = "recording";
  capabilities = allCapabilities;
  calls: CanonicalEvent[] = [];

  track(event: CanonicalEvent) {
    this.calls.push(event);
  }
}

describe("Analytics.use() integration", () => {
  it("accumulates multiple registrations without throwing, and does not affect track() behavior yet", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider });

    const propertyAppender: Middleware = {
      name: "property-appender",
      before(event) {
        return { ...event, properties: { ...event.properties, appended: true } };
      },
    };

    const errorOnlyMiddleware: Middleware = {
      name: "error-reporter",
      onError(_error, _event, _ctx) {
        // Deliberately empty: this middleware only ever cares about
        // onError, which issue 003 wires up -- present here purely to
        // exercise a middleware with no `before`/`after`.
      },
    };

    const noopMiddleware: Middleware = { name: "noop" };

    expect(() => analytics.use(propertyAppender)).not.toThrow();
    expect(() => analytics.use(errorOnlyMiddleware)).not.toThrow();
    expect(() => analytics.use(noopMiddleware)).not.toThrow();

    await analytics.track("signup_completed", { plan: "pro" });

    // The chain isn't wired in yet -- the recorded event must be exactly
    // what pre-Phase-8 `track()` would have produced, with no `appended`
    // property from `propertyAppender.before()`.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.name).toBe("signup_completed");
    expect(provider.calls[0]!.properties).toEqual({ plan: "pro" });
  });

  it("use() is available on the Analytics interface returned by createAnalytics() with no options", () => {
    const analytics = createAnalytics();
    expect(typeof analytics.use).toBe("function");
    expect(() => analytics.use({ name: "anything" })).not.toThrow();
  });
});
