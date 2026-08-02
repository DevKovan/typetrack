// Integration test for `Analytics.use()` (Phase 8 issue 001, updated by
// issue 002): constructs a real `createAnalytics()` instance against a real
// `AnalyticsProvider` stub, registers a handful of realistic-looking
// middleware objects, and asserts that registering them doesn't throw. As
// of issue 002, the chain is wired into `track()`/`page()`/`screen()`, so
// `propertyAppender.before()`'s mutation is now expected to reach the
// provider -- see `src/index.middleware.test.ts`/
// `src/index.middleware.integration.test.ts` for the full pipeline-wiring
// test suite; this file remains focused on `use()` registration itself.
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
  it("accumulates multiple registrations without throwing; track() now runs through the registered chain", async () => {
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

    // The chain is now wired in (issue 002) -- the recorded event reflects
    // propertyAppender.before()'s mutation.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.name).toBe("signup_completed");
    expect(provider.calls[0]!.properties).toEqual({ plan: "pro", appended: true });
  });

  it("use() is available on the Analytics interface returned by createAnalytics() with no options", () => {
    const analytics = createAnalytics();
    expect(typeof analytics.use).toBe("function");
    expect(() => analytics.use({ name: "anything" })).not.toThrow();
  });
});
