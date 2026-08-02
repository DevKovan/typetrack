// Unit tests for issue 002's core-owned identity/session state
// (anonymousId/sessionId/userId) and lifecycle verbs (reset/destroy/alias).
// See src/index.canonicalEvent.integration.test.ts for the full end-to-end
// lifecycle sequence against a real (non-stub) provider.
import { describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities } from "./test-support";

type SampleEvents = {
  signup_completed: { plan: string };
};

// Every optional verb wired up as a genuine no-op by default -- these tests
// exercise identity/session state and lifecycle ordering, not
// capability-gating (see src/index.capabilities.test.ts for that), so a
// default-constructed provider here must never trip the gate's `console.warn`.
function makeProvider(overrides: Partial<AnalyticsProvider> = {}): AnalyticsProvider {
  return {
    name: "test",
    capabilities: allCapabilities,
    track: mock(() => {}),
    identify() {},
    page() {},
    group() {},
    alias() {},
    screen() {},
    async flush() {},
    reset() {},
    async destroy() {},
    ...overrides,
  };
}

describe("createAnalytics() identity/session state", () => {
  it("generates anonymousId/sessionId once and keeps them stable across multiple track() calls", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider = makeProvider({ track });
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track("signup_completed", { plan: "pro" });
    analytics.track("signup_completed", { plan: "free" });

    expect(track).toHaveBeenCalledTimes(2);
    const [first] = track.mock.calls[0]!;
    const [second] = track.mock.calls[1]!;
    expect(first.anonymousId).toBe(second.anonymousId);
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.anonymousId.length).toBeGreaterThan(0);
    expect(first.sessionId.length).toBeGreaterThan(0);
  });

  it("identify() causes subsequent CanonicalEvents to carry the new userId; a track() before identify() carries undefined", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider = makeProvider({ track });
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track("signup_completed", { plan: "pro" });
    analytics.identify("user_1");
    analytics.track("signup_completed", { plan: "free" });

    expect(track).toHaveBeenCalledTimes(2);
    const [before] = track.mock.calls[0]!;
    const [after] = track.mock.calls[1]!;
    expect(before.userId).toBeUndefined();
    expect(after.userId).toBe("user_1");
  });

  it("track(event, payload, { context, metadata }) produces those exact values; omitting the third argument produces undefined for both", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider = makeProvider({ track });
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track("signup_completed", { plan: "pro" }, {
      context: { locale: "en-US" },
      metadata: { source: "web" },
    });
    analytics.track("signup_completed", { plan: "free" });

    const [withOptions] = track.mock.calls[0]!;
    const [withoutOptions] = track.mock.calls[1]!;
    expect(withOptions.context).toEqual({ locale: "en-US" });
    expect(withOptions.metadata).toEqual({ source: "web" });
    expect(withoutOptions.context).toBeUndefined();
    expect(withoutOptions.metadata).toBeUndefined();
  });

  it("page()/screen() called with no name produce CanonicalEvent.name === \"\"; called with a name produce that exact string", () => {
    const page = mock<NonNullable<AnalyticsProvider["page"]>>(() => {});
    const screen = mock<NonNullable<AnalyticsProvider["screen"]>>(() => {});
    const provider = makeProvider({ page, screen });
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.page();
    analytics.page("home");
    analytics.screen();
    analytics.screen("checkout");

    expect(page.mock.calls[0]![0].name).toBe("");
    expect(page.mock.calls[1]![0].name).toBe("home");
    expect(screen.mock.calls[0]![0].name).toBe("");
    expect(screen.mock.calls[1]![0].name).toBe("checkout");
  });

  it("reset() generates new anonymousId/sessionId different from the originals, clears userId, and calls provider.reset() exactly once", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const reset = mock<NonNullable<AnalyticsProvider["reset"]>>(() => {});
    const provider = makeProvider({ track, reset });
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.identify("user_1");
    analytics.track("signup_completed", { plan: "pro" });
    const [beforeReset] = track.mock.calls[0]!;

    analytics.reset();

    analytics.track("signup_completed", { plan: "free" });
    const [afterReset] = track.mock.calls[1]!;

    expect(afterReset.anonymousId).not.toBe(beforeReset.anonymousId);
    expect(afterReset.sessionId).not.toBe(beforeReset.sessionId);
    expect(afterReset.userId).toBeUndefined();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("destroy() calls provider.flush() before provider.destroy(), and resolves", async () => {
    const callOrder: string[] = [];
    const flush = mock(() => {
      callOrder.push("flush");
    });
    const destroy = mock(() => {
      callOrder.push("destroy");
    });
    const provider = makeProvider({ flush: async () => flush(), destroy: async () => destroy() });
    const analytics = createAnalytics<SampleEvents>({ provider });

    await expect(analytics.destroy()).resolves.toBeUndefined();

    expect(callOrder).toEqual(["flush", "destroy"]);
  });

  it("alias() does not mutate core's userId: a track() immediately after alias() without an intervening identify() still carries the pre-alias userId", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const alias = mock<NonNullable<AnalyticsProvider["alias"]>>(() => {});
    const provider = makeProvider({ track, alias });
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.identify("user_1");
    analytics.alias("user_2");
    analytics.track("signup_completed", { plan: "pro" });

    expect(alias).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.userId).toBe("user_1");
  });

  it("default (no provider supplied) createAnalytics() still works end-to-end against noopProvider and never throws, across every verb including the five new ones", async () => {
    const analytics = createAnalytics();

    await analytics.track("some_event", { foo: "bar" });
    await analytics.identify("user_1");
    await analytics.page("home");
    await analytics.group("group_1");
    await analytics.alias("user_2");
    await analytics.screen("checkout");
    await analytics.reset();
    await analytics.flush();
    await analytics.destroy();
  });
});
