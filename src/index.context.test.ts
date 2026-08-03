// Unit tests for issue 002's wiring of `createAnalytics({ context })`:
// `resolveContextOptions`-equivalent gating behavior (asserted indirectly,
// via a spy on `captureStaticContext`, since the helper itself isn't
// exported -- it's a private closure/module-local detail), merge precedence,
// and session-counter/`reset()` bookkeeping. No real I/O -- a hand-written
// `AnalyticsProvider` stub records events synchronously, and browser globals
// are stubbed manually (never registering real DOM globals -- see
// `src/context.test.ts`'s comment for why).
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as contextModule from "./context";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import type { CanonicalEvent } from "./schema";
import { allCapabilities } from "./test-support";

type AppEvents = {
  signup_completed: { plan: string };
};

function makeRecordingProvider(): { provider: AnalyticsProvider; events: CanonicalEvent[] } {
  const events: CanonicalEvent[] = [];
  const provider: AnalyticsProvider = {
    name: "recording",
    capabilities: allCapabilities,
    track(event) {
      events.push(event);
    },
    page(event) {
      events.push(event);
    },
    screen(event) {
      events.push(event);
    },
  };
  return { provider, events };
}

afterEach(() => {
  for (const key of ["window", "navigator", "document", "location"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

describe("resolveContextOptions-equivalent gating (via captureStaticContext spy)", () => {
  it("context omitted: captureStaticContext is never called, context stays exactly verbOptions?.context", () => {
    const spy = spyOn(contextModule, "captureStaticContext");
    try {
      const { provider, events } = makeRecordingProvider();
      const analytics = createAnalytics<AppEvents>({ provider });

      analytics.track("signup_completed", { plan: "pro" });
      analytics.track("signup_completed", { plan: "pro" }, { context: { locale: "en-US" } });

      expect(spy).not.toHaveBeenCalled();
      expect(events[0]!.context).toBeUndefined();
      expect(events[1]!.context).toEqual({ locale: "en-US" });
    } finally {
      spy.mockRestore();
    }
  });

  it("context: false: identical to omitted -- no capture attempted", () => {
    const spy = spyOn(contextModule, "captureStaticContext");
    try {
      const { provider, events } = makeRecordingProvider();
      const analytics = createAnalytics<AppEvents>({ provider, context: false });

      analytics.track("signup_completed", { plan: "pro" });

      expect(spy).not.toHaveBeenCalled();
      expect(events[0]!.context).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("context: { autoCapture: false }: identical to omitted -- no capture attempted", () => {
    const spy = spyOn(contextModule, "captureStaticContext");
    try {
      const { provider, events } = makeRecordingProvider();
      const analytics = createAnalytics<AppEvents>({ provider, context: { autoCapture: false } });

      analytics.track("signup_completed", { plan: "pro" });

      expect(spy).not.toHaveBeenCalled();
      expect(events[0]!.context).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("context: true: captureStaticContext is called exactly once at construction time", () => {
    const spy = spyOn(contextModule, "captureStaticContext");
    try {
      const { provider, events } = makeRecordingProvider();
      const analytics = createAnalytics<AppEvents>({ provider, context: true });

      expect(spy).toHaveBeenCalledTimes(1);

      analytics.track("signup_completed", { plan: "pro" });
      analytics.track("signup_completed", { plan: "pro" });

      // Still exactly once -- cached, not re-captured per call.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(events[0]!.context).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("context: { autoCapture: true, ... }: captureStaticContext is called exactly once", () => {
    const spy = spyOn(contextModule, "captureStaticContext");
    try {
      const { provider, events } = makeRecordingProvider();
      const analytics = createAnalytics<AppEvents>({
        provider,
        context: { autoCapture: true, featureFlags: () => ({ flag: "on" }) },
      });

      expect(spy).toHaveBeenCalledTimes(1);

      analytics.track("signup_completed", { plan: "pro" });

      expect((events[0]!.context as Record<string, unknown>).featureFlags).toEqual({ flag: "on" });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("merge precedence (caller wins, auto-capture fills gaps)", () => {
  it("caller-supplied context keys win on collision; other auto-captured keys remain present", () => {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", {
      value: { language: "en-US", userAgent: "" },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", { value: { referrer: "" }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "location", { value: { search: "" }, configurable: true, writable: true });

    const { provider, events } = makeRecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider, context: true });

    analytics.track("signup_completed", { plan: "pro" }, { context: { locale: "fr-FR" } });

    const context = events[0]!.context as Record<string, unknown>;
    expect(context.locale).toBe("fr-FR");
    expect(context.timezone).toBeDefined();
    expect(context.session).toBeDefined();
  });

  it("when neither auto-capture nor caller context produce anything, context is undefined, not {}", () => {
    const { provider, events } = makeRecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider });

    analytics.track("signup_completed", { plan: "pro" });

    expect(events[0]!.context).toBeUndefined();
  });
});

describe("session bookkeeping (eventCount/durationMs/reset())", () => {
  it("increments eventCount per call and reports a non-decreasing durationMs", () => {
    const { provider, events } = makeRecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider, context: true });

    analytics.track("signup_completed", { plan: "pro" });
    analytics.track("signup_completed", { plan: "pro" });
    analytics.track("signup_completed", { plan: "pro" });

    const session0 = (events[0]!.context as Record<string, unknown>).session as {
      startedAt: number;
      eventCount: number;
      durationMs: number;
    };
    const session1 = (events[1]!.context as Record<string, unknown>).session as typeof session0;
    const session2 = (events[2]!.context as Record<string, unknown>).session as typeof session0;

    expect(session0.eventCount).toBe(1);
    expect(session1.eventCount).toBe(2);
    expect(session2.eventCount).toBe(3);
    expect(session1.durationMs).toBeGreaterThanOrEqual(session0.durationMs);
    expect(session2.durationMs).toBeGreaterThanOrEqual(session1.durationMs);
    // Same session throughout -- `startedAt` doesn't move between calls.
    expect(session1.startedAt).toBe(session0.startedAt);
    expect(session2.startedAt).toBe(session0.startedAt);
  });

  it("reset() reinitializes the session -- eventCount back to 1, startedAt moves forward", async () => {
    const { provider, events } = makeRecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider, context: true });

    analytics.track("signup_completed", { plan: "pro" });
    analytics.track("signup_completed", { plan: "pro" });
    analytics.track("signup_completed", { plan: "pro" });

    const originalStartedAt = (
      (events[0]!.context as Record<string, unknown>).session as { startedAt: number }
    ).startedAt;

    // Ensure `Date.now()` has a chance to advance between the original
    // session start and `reset()`'s reinitialization.
    await new Promise((resolve) => setTimeout(resolve, 2));

    analytics.reset();
    analytics.track("signup_completed", { plan: "pro" });

    const afterReset = (events[3]!.context as Record<string, unknown>).session as {
      startedAt: number;
      eventCount: number;
    };
    expect(afterReset.eventCount).toBe(1);
    expect(afterReset.startedAt).toBeGreaterThanOrEqual(originalStartedAt);
  });

  it("identify/group/alias/flush/destroy are unaffected -- no context capture, no session increment", async () => {
    const spy = spyOn(contextModule, "captureDynamicContext");
    try {
      const { provider, events } = makeRecordingProvider();
      const analytics = createAnalytics<AppEvents>({ provider, context: true });

      analytics.track("signup_completed", { plan: "pro" });
      const callsAfterTrack = spy.mock.calls.length;

      await analytics.identify("user_1", { email: "a@b.com" });
      await analytics.group("team_1", {});
      await analytics.alias("user_2", "user_1");
      await analytics.flush();
      await analytics.destroy();

      expect(spy.mock.calls.length).toBe(callsAfterTrack);

      analytics.track("signup_completed", { plan: "pro" });
      const session = (events[1]!.context as Record<string, unknown>).session as { eventCount: number };
      // Only the two track() calls increment the counter -- the five
      // no-canonical-event verbs in between did not.
      expect(session.eventCount).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});
