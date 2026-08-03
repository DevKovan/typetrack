import { afterEach, describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { Analytics } from "./index";
import type { Plugin } from "./plugins";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities } from "./test-support";

describe("createAnalytics", () => {
  it("defaults to the no-op provider and never throws, across every verb including the new ones", async () => {
    const analytics = createAnalytics();
    await analytics.track("event");
    await analytics.identify("user_1");
    await analytics.page();
    await analytics.group("group_1");
    await analytics.alias("user_2");
    await analytics.screen();
    await analytics.reset();
    await analytics.flush();
    await analytics.destroy();
  });

  it("forwards track calls to the given provider, building a CanonicalEvent", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const analytics = createAnalytics({ provider });

    analytics.track("signup", { plan: "pro" });

    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.name).toBe("signup");
    expect(canonicalEvent.properties).toEqual({ plan: "pro" });
    expect(canonicalEvent.timestamp).toBeGreaterThan(0);
  });
});

// Integration tests for Phase 10 issue 001: the `plugins` registration
// option and `destroy()`'s teardown wiring. No actual plugin implementations
// are exercised here (those are issues 002-005) -- only the mechanism
// itself, via hand-written spy-based plugins.
describe("createAnalytics() plugins (issue 001: registration + teardown mechanism)", () => {
  const originalConsoleWarn = console.warn;

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  function stubConsoleWarn() {
    const warn = mock((..._args: unknown[]) => {});
    console.warn = warn as unknown as typeof console.warn;
    return warn;
  }

  it("invokes every plugin once, in array order, each with the same fully-constructed Analytics instance", () => {
    const received: Analytics<any>[] = [];
    const order: string[] = [];

    const p1: Plugin = function p1(analytics) {
      order.push("p1");
      received.push(analytics);
      // Every verb is callable from inside a plugin at setup time -- the
      // instance is not partially constructed.
      expect(typeof analytics.track).toBe("function");
      expect(typeof analytics.page).toBe("function");
      expect(typeof analytics.identify).toBe("function");
      expect(typeof analytics.destroy).toBe("function");
      expect(typeof analytics.use).toBe("function");
    };
    const p2: Plugin = function p2(analytics) {
      order.push("p2");
      received.push(analytics);
    };

    const analytics = createAnalytics({ plugins: [p1, p2] });

    expect(order).toEqual(["p1", "p2"]);
    expect(received).toHaveLength(2);
    // Both plugins received the exact same instance -- the one returned by
    // createAnalytics().
    expect(received[0]).toBe(analytics);
    expect(received[1]).toBe(analytics);
  });

  it("a plugin's returned teardown is invoked exactly once by destroy(); a plugin returning undefined has no teardown call attempted", async () => {
    const teardownA = mock(() => {});
    const pluginWithTeardown: Plugin = function pluginWithTeardown() {
      return teardownA;
    };
    const pluginWithoutTeardown: Plugin = function pluginWithoutTeardown() {
      return undefined;
    };

    const analytics = createAnalytics({ plugins: [pluginWithTeardown, pluginWithoutTeardown] });

    await analytics.destroy();
    expect(teardownA).toHaveBeenCalledTimes(1);

    // Calling destroy() again does not re-invoke prior teardowns -- they were
    // collected once, at construction, not re-derived per destroy() call.
    await analytics.destroy();
    expect(teardownA).toHaveBeenCalledTimes(2);
  });

  it("a throwing plugin setup does not prevent createAnalytics() from returning, nor subsequent plugins in the array from running", () => {
    const warn = stubConsoleWarn();
    const boom = new Error("setup boom");
    const throwing: Plugin = function throwingSetupPlugin() {
      throw boom;
    };
    const later = mock<Plugin>(() => {});

    let analytics: Analytics<any> | undefined;
    expect(() => {
      analytics = createAnalytics({ plugins: [throwing, later] });
    }).not.toThrow();

    expect(analytics).toBeDefined();
    expect(later).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("throwingSetupPlugin");
  });

  it("teardowns run in registration order, to completion (a throwing teardown does not block later teardowns), before the provider flush/destroy logic begins", async () => {
    const warn = stubConsoleWarn();
    const order: string[] = [];

    const teardownBoom = new Error("teardown boom");
    const pluginA: Plugin = function pluginA() {
      return () => {
        order.push("teardown-a");
      };
    };
    const pluginB: Plugin = function pluginB() {
      return () => {
        order.push("teardown-b");
        throw teardownBoom;
      };
    };
    const pluginC: Plugin = function pluginC() {
      return () => {
        order.push("teardown-c");
      };
    };

    const provider: AnalyticsProvider = {
      name: "ordered",
      capabilities: allCapabilities,
      track: mock(() => {}),
      flush: mock(async () => {
        order.push("provider-flush");
      }),
      destroy: mock(async () => {
        order.push("provider-destroy");
      }),
    };

    const analytics = createAnalytics({ provider, plugins: [pluginA, pluginB, pluginC] });

    await analytics.destroy();

    expect(order).toEqual(["teardown-a", "teardown-b", "teardown-c", "provider-flush", "provider-destroy"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("teardown");
  });

  it("a throwing plugin teardown does not cause destroy() to reject -- resolves normally purely from a plugin teardown failure", async () => {
    stubConsoleWarn();
    const throwingTeardown: Plugin = function throwingTeardownPlugin() {
      return () => {
        throw new Error("teardown boom");
      };
    };

    const analytics = createAnalytics({ plugins: [throwingTeardown] });

    await expect(analytics.destroy()).resolves.toBeUndefined();
  });

  it("provider failures during destroy() still produce the existing (multi-provider) AggregateError behavior, unchanged by a plugin's presence", async () => {
    stubConsoleWarn();
    const providerReason = new Error("provider destroy boom");
    const failingProvider: AnalyticsProvider = {
      name: "failing",
      capabilities: allCapabilities,
      track: mock(() => {}),
      async destroy() {
        throw providerReason;
      },
    };
    const okProvider: AnalyticsProvider = {
      name: "ok",
      capabilities: allCapabilities,
      track: mock(() => {}),
    };
    const teardown = mock(() => {});
    const plugin: Plugin = function plugin() {
      return teardown;
    };

    const analytics = createAnalytics({ provider: [failingProvider, okProvider], plugins: [plugin] });

    let thrown: unknown;
    try {
      await analytics.destroy();
    } catch (err) {
      thrown = err;
    }

    // The plugin's own teardown still ran (and did not throw), yet the
    // provider's failure still surfaces as an AggregateError -- one is not a
    // substitute for the other.
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregate = thrown as AggregateError;
    expect(aggregate.errors).toContain(providerReason);
  });

  it("no plugins option: zero behavior change -- track()/destroy() behave exactly as before this issue", async () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const flush = mock(async () => {});
    const destroy = mock(async () => {});
    const provider: AnalyticsProvider = { name: "regression", capabilities: allCapabilities, track, flush, destroy };

    const analytics = createAnalytics({ provider });

    analytics.track("some_event", { a: 1 });
    expect(track).toHaveBeenCalledTimes(1);

    await analytics.destroy();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("plugins: [] (empty array): zero behavior change -- no extra work performed, destroy() unaffected", async () => {
    const flush = mock(async () => {});
    const destroy = mock(async () => {});
    const provider: AnalyticsProvider = {
      name: "regression-empty",
      capabilities: allCapabilities,
      track: mock(() => {}),
      flush,
      destroy,
    };

    const analytics = createAnalytics({ provider, plugins: [] });

    await expect(analytics.destroy()).resolves.toBeUndefined();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
