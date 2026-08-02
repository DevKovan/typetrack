// Unit tests for issue 003's multi-provider fan-out plumbing in
// `createAnalytics()`: `Promise.allSettled`-backed dispatch, per-provider
// capability gating, error isolation, and shared identity state across every
// provider in the list. Routing-specific behavior (include/exclude skipping,
// priority ordering) lives in `src/index.routing.test.ts`.
import { afterEach, describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities, noCapabilities } from "./test-support";

const originalConsoleWarn = console.warn;

afterEach(() => {
  console.warn = originalConsoleWarn;
});

function stubConsoleWarn() {
  const warn = mock((..._args: unknown[]) => {});
  console.warn = warn as unknown as typeof console.warn;
  return warn;
}

function makeProvider(name: string, overrides: Partial<AnalyticsProvider> = {}): AnalyticsProvider {
  return {
    name,
    capabilities: allCapabilities,
    track: mock(() => {}),
    identify: mock(() => {}),
    page: mock(() => {}),
    group: mock(() => {}),
    alias: mock(() => {}),
    screen: mock(() => {}),
    reset: mock(() => {}),
    async flush() {},
    async destroy() {},
    ...overrides,
  };
}

describe("createAnalytics() multi-provider fan-out", () => {
  it("array of 2 bare providers, no routing config: track() calls both providers' .track() with a deep-equal CanonicalEvent", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const analytics = createAnalytics({ provider: [a, b] });

    await analytics.track("signup_completed", { plan: "pro" });

    expect(a.track).toHaveBeenCalledTimes(1);
    expect(b.track).toHaveBeenCalledTimes(1);
    const [eventA] = (a.track as ReturnType<typeof mock>).mock.calls[0]!;
    const [eventB] = (b.track as ReturnType<typeof mock>).mock.calls[0]!;
    expect(eventA).toEqual(eventB);
  });

  it("one provider whose capabilities.page === false warns once for that provider and still calls page() on a capable second provider", async () => {
    const warn = stubConsoleWarn();
    const incapable = makeProvider("incapable", { capabilities: { ...noCapabilities, page: false } });
    const capable = makeProvider("capable");
    const analytics = createAnalytics({ provider: [incapable, capable] });

    await analytics.page("home");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("incapable");
    expect(incapable.page).not.toHaveBeenCalled();
    expect(capable.page).toHaveBeenCalledTimes(1);
  });

  it("fan-out error isolation: one provider's track() rejects -- the other still receives the call, track() itself does not throw/reject, and console.warn mentions the failing provider's name", async () => {
    const warn = stubConsoleWarn();
    const failing = makeProvider("failing", {
      track: mock(() => Promise.reject(new Error("boom"))),
    });
    const succeeding = makeProvider("succeeding");
    const analytics = createAnalytics({ provider: [failing, succeeding] });

    await expect(analytics.track("event")).resolves.toBeUndefined();

    expect(failing.track).toHaveBeenCalledTimes(1);
    expect(succeeding.track).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("failing");
  });

  it("fan-out error isolation: one provider's track() throws synchronously -- the other still receives the call, track() does not throw, console.warn mentions the failing provider", async () => {
    const warn = stubConsoleWarn();
    const failing = makeProvider("sync-thrower", {
      track: mock(() => {
        throw new Error("sync boom");
      }),
    });
    const succeeding = makeProvider("succeeding");
    const analytics = createAnalytics({ provider: [failing, succeeding] });

    await expect(analytics.track("event")).resolves.toBeUndefined();

    expect(succeeding.track).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("sync-thrower");
  });

  it("identify()/group()/alias()/reset() fan out to every provider regardless of include/exclude/predicate/sampling on their entries", async () => {
    const excludedByInclude = makeProvider("excluded-by-include");
    const excludedByExclude = makeProvider("excluded-by-exclude");
    const excludedByPredicate = makeProvider("excluded-by-predicate");
    const excludedBySampling = makeProvider("excluded-by-sampling");

    const analytics = createAnalytics({
      provider: [
        { provider: excludedByInclude, include: ["nonexistent_event"] },
        { provider: excludedByExclude, exclude: ["*"] },
        { provider: excludedByPredicate, predicate: () => false },
        { provider: excludedBySampling, sampling: 0 },
      ],
    });

    await analytics.identify("user_1");
    await analytics.group("group_1");
    await analytics.alias("user_2");
    await analytics.reset();

    for (const provider of [excludedByInclude, excludedByExclude, excludedByPredicate, excludedBySampling]) {
      expect(provider.identify).toHaveBeenCalledTimes(1);
      expect(provider.group).toHaveBeenCalledTimes(1);
      expect(provider.alias).toHaveBeenCalledTimes(1);
      expect(provider.reset).toHaveBeenCalledTimes(1);
    }
  });

  it("identity fields (anonymousId/sessionId/userId) are identical across every provider's received CanonicalEvent for the same call", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const c = makeProvider("c");
    const analytics = createAnalytics({ provider: [a, b, c] });

    await analytics.identify("user_1");
    await analytics.track("event");

    const [eventA] = (a.track as ReturnType<typeof mock>).mock.calls[0]!;
    const [eventB] = (b.track as ReturnType<typeof mock>).mock.calls[0]!;
    const [eventC] = (c.track as ReturnType<typeof mock>).mock.calls[0]!;

    expect(eventA.anonymousId).toBe(eventB.anonymousId);
    expect(eventB.anonymousId).toBe(eventC.anonymousId);
    expect(eventA.sessionId).toBe(eventB.sessionId);
    expect(eventB.sessionId).toBe(eventC.sessionId);
    expect(eventA.userId).toBe("user_1");
    expect(eventB.userId).toBe("user_1");
    expect(eventC.userId).toBe("user_1");
  });

  it("identify() updates userId for all subsequent calls to every provider in the array", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const analytics = createAnalytics({ provider: [a, b] });

    await analytics.track("before_identify");
    await analytics.identify("user_1");
    await analytics.track("after_identify");

    const [before] = (a.track as ReturnType<typeof mock>).mock.calls[0]!;
    const [afterA] = (a.track as ReturnType<typeof mock>).mock.calls[1]!;
    const [afterB] = (b.track as ReturnType<typeof mock>).mock.calls[1]!;

    expect(before.userId).toBeUndefined();
    expect(afterA.userId).toBe("user_1");
    expect(afterB.userId).toBe("user_1");
  });

  it("flush() iterates every provider in the array", async () => {
    const flushA = mock(async () => {});
    const flushB = mock(async () => {});
    const providerA = makeProvider("fa", { flush: flushA });
    const providerB = makeProvider("fb", { flush: flushB });
    const analytics = createAnalytics({ provider: [providerA, providerB] });

    await analytics.flush();

    expect(flushA).toHaveBeenCalledTimes(1);
    expect(flushB).toHaveBeenCalledTimes(1);
  });

  it("destroy() iterates every provider in the array (minimal correct multi-provider iteration; AggregateError contract is covered in index.flushDestroy.test.ts)", async () => {
    const flushA = mock(async () => {});
    const destroyA = mock(async () => {});
    const flushB = mock(async () => {});
    const destroyB = mock(async () => {});
    const providerA = makeProvider("da", { flush: flushA, destroy: destroyA });
    const providerB = makeProvider("db", { flush: flushB, destroy: destroyB });
    const analytics = createAnalytics({ provider: [providerA, providerB] });

    await analytics.destroy();

    expect(flushA).toHaveBeenCalledTimes(1);
    expect(destroyA).toHaveBeenCalledTimes(1);
    expect(flushB).toHaveBeenCalledTimes(1);
    expect(destroyB).toHaveBeenCalledTimes(1);
  });
});
