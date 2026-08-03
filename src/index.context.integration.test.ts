// Integration tests for issue 002: exercises `createAnalytics({ context })`
// end-to-end against a real, hand-written `AnalyticsProvider` (not a
// `mock()`), covering `track`/`page`/`screen`, the merge-precedence
// contract, feature-flag freshness per call, and the byte-for-byte-unchanged
// regression case with `context` omitted entirely.
import { afterEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import type { CanonicalEvent } from "./schema";
import { allCapabilities } from "./test-support";

type AppEvents = {
  signup_completed: { plan: string };
};

class RecordingProvider implements AnalyticsProvider {
  name = "recording";
  capabilities = allCapabilities;
  events: CanonicalEvent[] = [];

  track(event: CanonicalEvent) {
    this.events.push(event);
  }
  page(event: CanonicalEvent) {
    this.events.push(event);
  }
  screen(event: CanonicalEvent) {
    this.events.push(event);
  }
}

afterEach(() => {
  for (const key of ["window", "navigator", "document", "location"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

describe("createAnalytics({ context }) integration", () => {
  it("with context omitted entirely: CanonicalEvent.context is byte-for-byte unchanged (exactly verbOptions?.context)", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider });

    await analytics.track("signup_completed", { plan: "free" });
    await analytics.track("signup_completed", { plan: "pro" }, { context: { locale: "en-US" } });
    await analytics.page("home");
    await analytics.screen("checkout");

    expect(provider.events[0]!.context).toBeUndefined();
    expect(provider.events[1]!.context).toEqual({ locale: "en-US" });
    expect(provider.events[2]!.context).toBeUndefined();
    expect(provider.events[3]!.context).toBeUndefined();
  });

  it("with context: true: track()/page()/screen() all get session bookkeeping + locale/timezone", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider, context: true });

    await analytics.track("signup_completed", { plan: "free" });
    await analytics.page("home");
    await analytics.screen("checkout");

    for (const event of provider.events) {
      const context = event.context as Record<string, unknown>;
      expect(context.locale).toBeDefined();
      expect(context.timezone).toBeDefined();
      expect(context.session).toBeDefined();
    }

    const sessions = provider.events.map(
      (event) => (event.context as Record<string, unknown>).session as { eventCount: number },
    );
    expect(sessions.map((s) => s.eventCount)).toEqual([1, 2, 3]);
  });

  it("first track() has eventCount 1, second has eventCount 2 with durationMs >= first's", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider, context: true });

    await analytics.track("signup_completed", { plan: "free" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await analytics.track("signup_completed", { plan: "pro" });

    const session1 = (provider.events[0]!.context as Record<string, unknown>).session as {
      eventCount: number;
      durationMs: number;
    };
    const session2 = (provider.events[1]!.context as Record<string, unknown>).session as {
      eventCount: number;
      durationMs: number;
    };

    expect(session1.eventCount).toBe(1);
    expect(session2.eventCount).toBe(2);
    expect(session2.durationMs).toBeGreaterThanOrEqual(session1.durationMs);
  });

  it("featureFlags getter is invoked fresh per call, not cached from construction time", async () => {
    const provider = new RecordingProvider();
    let call = 0;
    const analytics = createAnalytics<AppEvents>({
      provider,
      context: {
        autoCapture: true,
        featureFlags: () => {
          call += 1;
          return call === 1 ? { "new-checkout": "b" } : { "new-checkout": "a" };
        },
      },
    });

    await analytics.track("signup_completed", { plan: "free" });
    await analytics.track("signup_completed", { plan: "pro" });

    expect((provider.events[0]!.context as Record<string, unknown>).featureFlags).toEqual({
      "new-checkout": "b",
    });
    expect((provider.events[1]!.context as Record<string, unknown>).featureFlags).toEqual({
      "new-checkout": "a",
    });
  });

  it("caller-supplied context wins on key collision; other auto-captured keys remain present", async () => {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", {
      value: { language: "en-US", userAgent: "" },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", { value: { referrer: "" }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "location", { value: { search: "" }, configurable: true, writable: true });

    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider, context: true });

    await analytics.track("signup_completed", { plan: "free" }, { context: { locale: "fr-FR" } });

    const context = provider.events[0]!.context as Record<string, unknown>;
    expect(context.locale).toBe("fr-FR");
    expect(context.timezone).toBeDefined();
    expect(context.session).toBeDefined();
  });

  it("reset() reinitializes the session across track()/page()/screen()", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider, context: true });

    await analytics.track("signup_completed", { plan: "free" });
    await analytics.page("home");
    await analytics.screen("checkout");

    await analytics.reset();

    await analytics.track("signup_completed", { plan: "pro" });

    const lastSession = (provider.events[3]!.context as Record<string, unknown>).session as {
      eventCount: number;
    };
    expect(lastSession.eventCount).toBe(1);
  });
});
