import { afterEach, beforeEach, describe, expect, it, jest, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { Analytics } from "./index";
import type { Plugin } from "./plugins";
import type { AnalyticsProvider } from "./providers";
import type { CanonicalEvent } from "./schema";
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

// Integration tests for Phase 11 issue 002: wiring `consent` into
// `createAnalytics()`, the `analytics.consent` runtime API, and the global
// gate applied to the six data-carrying verbs. Issue 001's pure
// types/logic already have their own unit tests (`src/consent.test.ts`) --
// this describe block covers the wiring only, per the issue's "Test
// requirements" ("no new unit tests beyond issue 001's").
describe("createAnalytics({ consent }) (Phase 11 issue 002)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

  function stubFetch(impl: FetchFn) {
    const fetchStub = mock<FetchFn>(impl);
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    return fetchStub;
  }

  function spyProvider(name = "spy"): AnalyticsProvider & {
    track: ReturnType<typeof mock>;
    identify: ReturnType<typeof mock>;
    page: ReturnType<typeof mock>;
    group: ReturnType<typeof mock>;
    alias: ReturnType<typeof mock>;
    screen: ReturnType<typeof mock>;
    reset: ReturnType<typeof mock>;
  } {
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
    };
  }

  function stubBrowserPrivacySignal(): void {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", {
      value: { globalPrivacyControl: true },
      configurable: true,
      writable: true,
    });
  }

  function clearBrowserGlobals(): void {
    for (const key of ["window", "navigator"] as const) {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }

  it("no consent option supplied: every verb behaves byte-for-byte identically to pre-Phase-11, including the dev-server mirror firing unconditionally", () => {
    const fetchStub = stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));
    const provider = spyProvider();

    const analytics = createAnalytics({ provider, devServer: true });

    analytics.track("signup", { plan: "pro" });
    analytics.identify("user_1");
    analytics.page();
    analytics.group("group_1");
    analytics.alias("user_2");
    analytics.screen();

    expect(provider.track).toHaveBeenCalledTimes(1);
    expect(provider.identify).toHaveBeenCalledTimes(1);
    expect(provider.page).toHaveBeenCalledTimes(1);
    expect(provider.group).toHaveBeenCalledTimes(1);
    expect(provider.alias).toHaveBeenCalledTimes(1);
    expect(provider.screen).toHaveBeenCalledTimes(1);
    // The dev-server mirror still fires for the one track() call, exactly
    // as pre-Phase-11 -- unconditionally, regardless of consent (there is
    // none configured here).
    expect(fetchStub).toHaveBeenCalledTimes(1);

    // `analytics.consent` is present even with no `consent` option supplied,
    // and grant/deny/get still work and track state, with no gating effect.
    expect(analytics.consent.hasConsent("analytics")).toBe(false);
    analytics.consent.grant("analytics");
    expect(analytics.consent.hasConsent("analytics")).toBe(true);
    expect(analytics.consent.get()).toEqual({ analytics: "granted" });
  });

  it("requiredCategories: ['analytics'], no initialState (resolves to 'denied'): every one of the six verbs is a complete no-op, including no dev-server-mirror fetch, until grant() is called", () => {
    const fetchStub = stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));
    const provider = spyProvider();

    const analytics = createAnalytics({
      provider,
      devServer: true,
      consent: { requiredCategories: ["analytics"] },
    });

    expect(analytics.track("signup", { plan: "pro" })).toBeUndefined();
    expect(analytics.identify("user_1")).toBeUndefined();
    expect(analytics.page()).toBeUndefined();
    expect(analytics.group("group_1")).toBeUndefined();
    expect(analytics.alias("user_2")).toBeUndefined();
    expect(analytics.screen()).toBeUndefined();

    expect(provider.track).not.toHaveBeenCalled();
    expect(provider.identify).not.toHaveBeenCalled();
    expect(provider.page).not.toHaveBeenCalled();
    expect(provider.group).not.toHaveBeenCalled();
    expect(provider.alias).not.toHaveBeenCalled();
    expect(provider.screen).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();

    analytics.consent.grant("analytics");

    analytics.track("signup", { plan: "pro" });
    analytics.identify("user_1");
    analytics.page();
    analytics.group("group_1");
    analytics.alias("user_2");
    analytics.screen();

    expect(provider.track).toHaveBeenCalledTimes(1);
    expect(provider.identify).toHaveBeenCalledTimes(1);
    expect(provider.page).toHaveBeenCalledTimes(1);
    expect(provider.group).toHaveBeenCalledTimes(1);
    expect(provider.alias).toHaveBeenCalledTimes(1);
    expect(provider.screen).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it.each(["track", "page", "screen", "identify", "group", "alias"] as const)(
    "%s() individually: blocked while denied, delivered once granted",
    (verb) => {
      const provider = spyProvider();
      const analytics = createAnalytics({ provider, consent: { requiredCategories: ["analytics"] } });

      function call() {
        switch (verb) {
          case "track":
            return analytics.track("evt");
          case "page":
            return analytics.page();
          case "screen":
            return analytics.screen();
          case "identify":
            return analytics.identify("user_1");
          case "group":
            return analytics.group("group_1");
          case "alias":
            return analytics.alias("user_2");
        }
      }

      call();
      expect(provider[verb]).not.toHaveBeenCalled();

      analytics.consent.grant("analytics");
      call();
      expect(provider[verb]).toHaveBeenCalledTimes(1);
    },
  );

  it("blocked identify() does not mutate core's stored userId (verified via a subsequent group() call's userId argument once unblocked)", () => {
    const provider = spyProvider();
    const analytics = createAnalytics({ provider, consent: { requiredCategories: ["analytics"] } });

    analytics.identify("blocked_user");
    expect(provider.identify).not.toHaveBeenCalled();

    analytics.consent.grant("analytics");
    analytics.group("group_1");

    expect(provider.group).toHaveBeenCalledTimes(1);
    const [, , identity] = provider.group.mock.calls[0]!;
    // If the blocked identify() had mutated core's `userId`, this would be
    // "blocked_user" instead of `undefined` -- confirms the gate ran before
    // the `userId` reassignment, not after.
    expect((identity as { userId?: string }).userId).toBeUndefined();
  });

  it("deny() after a prior grant() re-blocks the six verbs again", () => {
    const provider = spyProvider();
    const analytics = createAnalytics({ provider, consent: { requiredCategories: ["analytics"] } });

    analytics.consent.grant("analytics");
    analytics.track("evt");
    expect(provider.track).toHaveBeenCalledTimes(1);

    analytics.consent.deny("analytics");
    analytics.track("evt");
    analytics.page();
    analytics.identify("user_1");
    expect(provider.track).toHaveBeenCalledTimes(1);
    expect(provider.page).not.toHaveBeenCalled();
    expect(provider.identify).not.toHaveBeenCalled();
  });

  it("initialState pre-seeds consent: the six verbs work immediately at construction, no grant() call needed", () => {
    const provider = spyProvider();
    const analytics = createAnalytics({
      provider,
      consent: { requiredCategories: ["analytics"], initialState: { analytics: "granted" } },
    });

    analytics.track("evt");
    analytics.page();
    analytics.screen();
    analytics.identify("user_1");
    analytics.group("group_1");
    analytics.alias("user_2");

    expect(provider.track).toHaveBeenCalledTimes(1);
    expect(provider.page).toHaveBeenCalledTimes(1);
    expect(provider.screen).toHaveBeenCalledTimes(1);
    expect(provider.identify).toHaveBeenCalledTimes(1);
    expect(provider.group).toHaveBeenCalledTimes(1);
    expect(provider.alias).toHaveBeenCalledTimes(1);
  });

  it("multi-category AND semantics: still fully blocked until every required category is granted", () => {
    const provider = spyProvider();
    const analytics = createAnalytics({
      provider,
      consent: {
        requiredCategories: ["analytics", "marketing"],
        initialState: { analytics: "granted" },
      },
    });

    analytics.track("evt");
    expect(provider.track).not.toHaveBeenCalled();

    analytics.consent.grant("marketing");
    analytics.track("evt");
    expect(provider.track).toHaveBeenCalledTimes(1);
  });

  it("respectBrowserSignals: true with a stubbed browser privacy signal present, no initialState: fail-closed by default even without an explicit defaultState: 'denied'", () => {
    stubBrowserPrivacySignal();
    try {
      const provider = spyProvider();
      const analytics = createAnalytics({
        provider,
        consent: { requiredCategories: ["analytics"], respectBrowserSignals: true },
      });

      analytics.track("evt");
      analytics.page();

      expect(provider.track).not.toHaveBeenCalled();
      expect(provider.page).not.toHaveBeenCalled();

      // Confirms `resolveDefaultState` is actually consumed: an explicit
      // grant still overrides the forced-denied default.
      analytics.consent.grant("analytics");
      analytics.track("evt");
      expect(provider.track).toHaveBeenCalledTimes(1);
    } finally {
      clearBrowserGlobals();
    }
  });

  it("get()'s returned object, when mutated by the caller, has no effect on subsequent hasConsent()/gating behavior", () => {
    const provider = spyProvider();
    const analytics = createAnalytics({
      provider,
      consent: { requiredCategories: ["analytics"], initialState: { analytics: "granted" } },
    });

    const snapshot = analytics.consent.get();
    snapshot.analytics = "denied";
    (snapshot as Record<string, string>).marketing = "granted";

    expect(analytics.consent.hasConsent("analytics")).toBe(true);
    expect(analytics.consent.get()).toEqual({ analytics: "granted" });

    analytics.track("evt");
    expect(provider.track).toHaveBeenCalledTimes(1);
  });

  it("reset() does not clear or otherwise alter consent state -- grant -> reset() -> verb-call still succeeds, and a denied category still blocks after reset()", async () => {
    const grantedProvider = spyProvider("granted-case");
    const grantedAnalytics = createAnalytics({
      provider: grantedProvider,
      consent: { requiredCategories: ["analytics"] },
    });
    grantedAnalytics.consent.grant("analytics");
    await grantedAnalytics.reset();
    grantedAnalytics.track("evt");
    expect(grantedProvider.track).toHaveBeenCalledTimes(1);

    const deniedProvider = spyProvider("denied-case");
    const deniedAnalytics = createAnalytics({
      provider: deniedProvider,
      consent: { requiredCategories: ["analytics"] },
    });
    await deniedAnalytics.reset();
    deniedAnalytics.track("evt");
    expect(deniedProvider.track).not.toHaveBeenCalled();
  });
});

// Integration tests for Phase 11 issue 003: the `enable()`/`disable()`/
// `isEnabled()` coarse kill switch, and its AND composition with issue 002's
// consent gate inside the shared `isTrackingAllowed()`. No new unit tests --
// this is closure-state wiring with no standalone pure logic, per the
// issue's "Test requirements".
describe("createAnalytics() enable()/disable()/isEnabled() (Phase 11 issue 003)", () => {
  function spyProvider(name = "spy"): AnalyticsProvider & {
    track: ReturnType<typeof mock>;
    identify: ReturnType<typeof mock>;
    page: ReturnType<typeof mock>;
    group: ReturnType<typeof mock>;
    alias: ReturnType<typeof mock>;
    screen: ReturnType<typeof mock>;
    reset: ReturnType<typeof mock>;
  } {
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
    };
  }

  function callVerb(
    analytics: Analytics,
    verb: "track" | "page" | "screen" | "identify" | "group" | "alias",
  ): void | Promise<void> {
    switch (verb) {
      case "track":
        return analytics.track("evt");
      case "page":
        return analytics.page();
      case "screen":
        return analytics.screen();
      case "identify":
        return analytics.identify("user_1");
      case "group":
        return analytics.group("group_1");
      case "alias":
        return analytics.alias("user_2");
    }
  }

  it("isEnabled() is true immediately after construction, with no other calls", () => {
    const analytics = createAnalytics();
    expect(analytics.isEnabled()).toBe(true);
  });

  it.each(["track", "page", "screen", "identify", "group", "alias"] as const)(
    "%s(): disable() blocks it completely (no provider call), enable() restores normal behavior, with no consent option configured at all",
    (verb) => {
      const provider = spyProvider();
      const analytics = createAnalytics({ provider });

      analytics.disable();
      expect(analytics.isEnabled()).toBe(false);
      callVerb(analytics, verb);
      expect(provider[verb]).not.toHaveBeenCalled();

      analytics.enable();
      expect(analytics.isEnabled()).toBe(true);
      callVerb(analytics, verb);
      expect(provider[verb]).toHaveBeenCalledTimes(1);
    },
  );

  it("disable() blocks track()'s dev-server mirror too, exactly like issue 002's consent-denied path", () => {
    const originalFetch = globalThis.fetch;
    const fetchStub = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    try {
      const provider = spyProvider();
      const analytics = createAnalytics({ provider, devServer: true });

      analytics.disable();
      analytics.track("evt");

      expect(provider.track).not.toHaveBeenCalled();
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("four-way AND-composition matrix: enabled/disabled x granted/denied", () => {
    // enabled x granted -> allowed
    {
      const provider = spyProvider("enabled-granted");
      const analytics = createAnalytics({ provider, consent: { requiredCategories: ["analytics"] } });
      analytics.consent.grant("analytics");
      analytics.track("evt");
      expect(provider.track).toHaveBeenCalledTimes(1);
    }

    // enabled x denied -> blocked
    {
      const provider = spyProvider("enabled-denied");
      const analytics = createAnalytics({ provider, consent: { requiredCategories: ["analytics"] } });
      analytics.track("evt");
      expect(provider.track).not.toHaveBeenCalled();
    }

    // disabled x granted -> blocked
    {
      const provider = spyProvider("disabled-granted");
      const analytics = createAnalytics({ provider, consent: { requiredCategories: ["analytics"] } });
      analytics.consent.grant("analytics");
      analytics.disable();
      analytics.track("evt");
      expect(provider.track).not.toHaveBeenCalled();
    }

    // disabled x denied -> blocked
    {
      const provider = spyProvider("disabled-denied");
      const analytics = createAnalytics({ provider, consent: { requiredCategories: ["analytics"] } });
      analytics.disable();
      analytics.track("evt");
      expect(provider.track).not.toHaveBeenCalled();
    }

    // enabled (default) x no consent option at all -> allowed
    {
      const provider = spyProvider("enabled-no-consent-option");
      const analytics = createAnalytics({ provider });
      analytics.track("evt");
      expect(provider.track).toHaveBeenCalledTimes(1);
    }
  });

  it("reset() does not re-enable a disabled instance, nor disable an enabled one", async () => {
    const disabledProvider = spyProvider("disabled-case");
    const disabledAnalytics = createAnalytics({ provider: disabledProvider });
    disabledAnalytics.disable();
    await disabledAnalytics.reset();
    expect(disabledAnalytics.isEnabled()).toBe(false);
    disabledAnalytics.track("evt");
    expect(disabledProvider.track).not.toHaveBeenCalled();

    const enabledProvider = spyProvider("enabled-case");
    const enabledAnalytics = createAnalytics({ provider: enabledProvider });
    await enabledAnalytics.reset();
    expect(enabledAnalytics.isEnabled()).toBe(true);
    enabledAnalytics.track("evt");
    expect(enabledProvider.track).toHaveBeenCalledTimes(1);
  });

  it("no enable()/disable() calls at all: zero behavior change from pre-issue-003 (regression check)", () => {
    const provider = spyProvider();
    const analytics = createAnalytics({ provider });

    expect(analytics.isEnabled()).toBe(true);
    analytics.track("evt");
    analytics.identify("user_1");
    analytics.page();
    analytics.group("group_1");
    analytics.alias("user_2");
    analytics.screen();

    expect(provider.track).toHaveBeenCalledTimes(1);
    expect(provider.identify).toHaveBeenCalledTimes(1);
    expect(provider.page).toHaveBeenCalledTimes(1);
    expect(provider.group).toHaveBeenCalledTimes(1);
    expect(provider.alias).toHaveBeenCalledTimes(1);
    expect(provider.screen).toHaveBeenCalledTimes(1);
  });

  it("no console.warn noise for a disabled instance's blocked calls", () => {
    const originalConsoleWarn = console.warn;
    const warnSpy = mock(() => {});
    console.warn = warnSpy as unknown as typeof console.warn;
    try {
      const provider = spyProvider();
      const analytics = createAnalytics({ provider });
      analytics.disable();

      analytics.track("evt");
      analytics.identify("user_1");
      analytics.page();
      analytics.group("group_1");
      analytics.alias("user_2");
      analytics.screen();

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      console.warn = originalConsoleWarn;
    }
  });
});

// Integration tests for Phase 11 issue 004: `anonymousMode`'s suppression of
// `identify()`/`alias()`, `group()` remaining unaffected, and the one-time
// warning pattern.
describe("createAnalytics({ anonymousMode }) (Phase 11 issue 004)", () => {
  const originalConsoleWarn = console.warn;

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  function stubConsoleWarn() {
    const warn = mock((..._args: unknown[]) => {});
    console.warn = warn as unknown as typeof console.warn;
    return warn;
  }

  function spyProvider(name = "spy"): AnalyticsProvider & {
    track: ReturnType<typeof mock>;
    identify: ReturnType<typeof mock>;
    group: ReturnType<typeof mock>;
    alias: ReturnType<typeof mock>;
  } {
    return {
      name,
      capabilities: allCapabilities,
      track: mock(() => {}),
      identify: mock(() => {}),
      group: mock(() => {}),
      alias: mock(() => {}),
    };
  }

  it("identify() is a complete no-op (single-provider): no provider.identify call, userId stays undefined across a subsequent track()", () => {
    stubConsoleWarn();
    const provider = spyProvider();
    const analytics = createAnalytics({ provider, anonymousMode: true });

    analytics.identify("user-123", { plan: "pro" });
    expect(provider.identify).not.toHaveBeenCalled();

    analytics.track("evt");
    const [canonicalEvent] = provider.track.mock.calls[0]!;
    expect(canonicalEvent.userId).toBeUndefined();
  });

  it("identify() is a complete no-op (multi-provider fan-out): no provider in the list ever receives identify", async () => {
    stubConsoleWarn();
    const providerA = spyProvider("a");
    const providerB = spyProvider("b");
    const analytics = createAnalytics({ provider: [providerA, providerB], anonymousMode: true });

    await analytics.identify("user-123", { plan: "pro" });
    expect(providerA.identify).not.toHaveBeenCalled();
    expect(providerB.identify).not.toHaveBeenCalled();

    analytics.track("evt");
    const [canonicalEventA] = providerA.track.mock.calls[0]!;
    expect(canonicalEventA.userId).toBeUndefined();
  });

  it("alias() is a complete no-op (single-provider): no provider.alias call", () => {
    stubConsoleWarn();
    const provider = spyProvider();
    const analytics = createAnalytics({ provider, anonymousMode: true });

    analytics.alias("new-id", "old-id");
    expect(provider.alias).not.toHaveBeenCalled();
  });

  it("alias() is a complete no-op (multi-provider fan-out): no provider in the list ever receives alias", async () => {
    stubConsoleWarn();
    const providerA = spyProvider("a");
    const providerB = spyProvider("b");
    const analytics = createAnalytics({ provider: [providerA, providerB], anonymousMode: true });

    await analytics.alias("new-id", "old-id");
    expect(providerA.alias).not.toHaveBeenCalled();
    expect(providerB.alias).not.toHaveBeenCalled();
  });

  it("group() is unaffected (single-provider): the provider's group method is called normally", () => {
    stubConsoleWarn();
    const provider = spyProvider();
    const analytics = createAnalytics({ provider, anonymousMode: true });

    analytics.group("org-1", { plan: "enterprise" });

    expect(provider.group).toHaveBeenCalledTimes(1);
    expect(provider.group.mock.calls[0]![0]).toBe("org-1");
    expect(provider.group.mock.calls[0]![1]).toEqual({ plan: "enterprise" });
  });

  it("group() is unaffected (multi-provider fan-out): every provider's group method is called normally", async () => {
    stubConsoleWarn();
    const providerA = spyProvider("a");
    const providerB = spyProvider("b");
    const analytics = createAnalytics({ provider: [providerA, providerB], anonymousMode: true });

    await analytics.group("org-1", { plan: "enterprise" });

    expect(providerA.group).toHaveBeenCalledTimes(1);
    expect(providerB.group).toHaveBeenCalledTimes(1);
  });

  it("multiple identify() calls: console.warn fires exactly once (first call only)", () => {
    const warnSpy = stubConsoleWarn();
    const provider = spyProvider();
    const analytics = createAnalytics({ provider, anonymousMode: true });

    analytics.identify("user-1");
    analytics.identify("user-2");
    analytics.identify("user-3");

    const identifyWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("identify() call ignored"),
    );
    expect(identifyWarnings.length).toBe(1);
    expect(identifyWarnings[0]![0]).toBe("typetrack: anonymousMode is enabled -- identify() call ignored.");
  });

  it("multiple alias() calls: console.warn fires exactly once (first call only), separate warning key from identify()", () => {
    const warnSpy = stubConsoleWarn();
    const provider = spyProvider();
    const analytics = createAnalytics({ provider, anonymousMode: true });

    analytics.alias("new-1", "old-1");
    analytics.alias("new-2", "old-2");

    const aliasWarnings = warnSpy.mock.calls.filter((call) => String(call[0]).includes("alias() call ignored"));
    expect(aliasWarnings.length).toBe(1);
    expect(aliasWarnings[0]![0]).toBe("typetrack: anonymousMode is enabled -- alias() call ignored.");
  });

  it("identify() and alias() each warn once independently, not shared/deduped across each other", () => {
    const warnSpy = stubConsoleWarn();
    const provider = spyProvider();
    const analytics = createAnalytics({ provider, anonymousMode: true });

    analytics.identify("user-1");
    analytics.alias("new-1", "old-1");

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("anonymousMode false/omitted: zero behavior change from pre-issue-004 (regression check)", () => {
    stubConsoleWarn();
    const provider = spyProvider();
    const analytics = createAnalytics({ provider });

    analytics.identify("user-123", { plan: "pro" });
    expect(provider.identify).toHaveBeenCalledTimes(1);

    analytics.track("evt");
    const [canonicalEvent] = provider.track.mock.calls[0]!;
    expect(canonicalEvent.userId).toBe("user-123");

    analytics.alias("new-id", "old-id");
    expect(provider.alias).toHaveBeenCalledTimes(1);

    analytics.group("org-1");
    expect(provider.group).toHaveBeenCalledTimes(1);
  });

  it("anonymousMode: true, explicit false: also zero behavior change (identical to omitted)", () => {
    stubConsoleWarn();
    const provider = spyProvider();
    const analytics = createAnalytics({ provider, anonymousMode: false });

    analytics.identify("user-123");
    expect(provider.identify).toHaveBeenCalledTimes(1);
  });
});

// Integration tests for Phase 11 issue 005: per-provider `requiresConsent`
// (`ProviderEntry.requiresConsent`), evaluated independently of any global
// `requiredCategories` gate (issue 002) -- see `src/routing.ts`'s
// `shouldRouteToProvider` and `src/consent.ts`'s `isConsentedForProvider`.
describe("createAnalytics() provider-aware consent gating (ProviderEntry.requiresConsent) (Phase 11 issue 005)", () => {
  const originalConsoleWarn = console.warn;

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  function stubConsoleWarn() {
    const warn = mock((..._args: unknown[]) => {});
    console.warn = warn as unknown as typeof console.warn;
    return warn;
  }

  function spyProvider(name = "spy"): AnalyticsProvider & {
    track: ReturnType<typeof mock>;
    page: ReturnType<typeof mock>;
    screen: ReturnType<typeof mock>;
    identify: ReturnType<typeof mock>;
    group: ReturnType<typeof mock>;
    alias: ReturnType<typeof mock>;
  } {
    return {
      name,
      capabilities: allCapabilities,
      track: mock(() => {}),
      page: mock(() => {}),
      screen: mock(() => {}),
      identify: mock(() => {}),
      group: mock(() => {}),
      alias: mock(() => {}),
    };
  }

  it("multi-provider track/page/screen: a provider with requiresConsent is blocked while an unrestricted provider in the same list is not, until the required category is granted", () => {
    const unrestricted = spyProvider("unrestricted");
    const marketingGated = spyProvider("marketing-gated");
    const analytics = createAnalytics({
      provider: [{ provider: unrestricted }, { provider: marketingGated, requiresConsent: ["marketing"] }],
    });

    analytics.track("evt");
    analytics.page();
    analytics.screen();

    expect(unrestricted.track).toHaveBeenCalledTimes(1);
    expect(unrestricted.page).toHaveBeenCalledTimes(1);
    expect(unrestricted.screen).toHaveBeenCalledTimes(1);
    expect(marketingGated.track).not.toHaveBeenCalled();
    expect(marketingGated.page).not.toHaveBeenCalled();
    expect(marketingGated.screen).not.toHaveBeenCalled();

    analytics.consent.grant("marketing");

    analytics.track("evt");
    analytics.page();
    analytics.screen();

    expect(unrestricted.track).toHaveBeenCalledTimes(2);
    expect(marketingGated.track).toHaveBeenCalledTimes(1);
    expect(marketingGated.page).toHaveBeenCalledTimes(1);
    expect(marketingGated.screen).toHaveBeenCalledTimes(1);
  });

  it("multi-provider track: consent grant/deny takes effect immediately (live state, not a snapshot captured at construction)", () => {
    const gated = spyProvider("gated");
    const analytics = createAnalytics({
      provider: [{ provider: gated, requiresConsent: ["analytics"] }],
    });

    analytics.track("evt");
    expect(gated.track).not.toHaveBeenCalled();

    analytics.consent.grant("analytics");
    analytics.track("evt");
    expect(gated.track).toHaveBeenCalledTimes(1);

    analytics.consent.deny("analytics");
    analytics.track("evt");
    expect(gated.track).toHaveBeenCalledTimes(1);
  });

  it("multi-provider identify/group/alias: same per-provider gating, and routing fields (include) are still ignored entirely for these three verbs", () => {
    const unrestricted = spyProvider("unrestricted");
    const marketingGated = spyProvider("marketing-gated");
    // `include` is set here but never evaluated for identify/group/alias
    // (Phase 7 decision, untouched by issue 005) -- this provider has no
    // `requiresConsent`, so it must receive every identify/group/alias call
    // regardless of `include` not matching anything relevant.
    const includeOnly = spyProvider("include-only");

    const analytics = createAnalytics({
      provider: [
        { provider: unrestricted },
        { provider: marketingGated, requiresConsent: ["marketing"] },
        { provider: includeOnly, include: ["some_other_event_name_never_used_here"] },
      ],
    });

    analytics.identify("user_1", { plan: "pro" });
    analytics.group("group_1", { plan: "pro" });
    analytics.alias("user_2", "user_1");

    expect(unrestricted.identify).toHaveBeenCalledTimes(1);
    expect(unrestricted.group).toHaveBeenCalledTimes(1);
    expect(unrestricted.alias).toHaveBeenCalledTimes(1);
    expect(marketingGated.identify).not.toHaveBeenCalled();
    expect(marketingGated.group).not.toHaveBeenCalled();
    expect(marketingGated.alias).not.toHaveBeenCalled();
    // include is ignored for these three verbs -- receives every call
    // despite its include list never matching an identify/group/alias call
    // (which has no event name to match against in the first place).
    expect(includeOnly.identify).toHaveBeenCalledTimes(1);
    expect(includeOnly.group).toHaveBeenCalledTimes(1);
    expect(includeOnly.alias).toHaveBeenCalledTimes(1);

    analytics.consent.grant("marketing");

    analytics.identify("user_3", { plan: "pro" });
    analytics.group("group_2", { plan: "pro" });
    analytics.alias("user_4", "user_3");

    expect(marketingGated.identify).toHaveBeenCalledTimes(1);
    expect(marketingGated.group).toHaveBeenCalledTimes(1);
    expect(marketingGated.alias).toHaveBeenCalledTimes(1);
  });

  it("single-provider-entry (one ProviderEntry, not an array): requiresConsent is honored identically to the multi-provider path", () => {
    const gated = spyProvider("solo-gated");
    const analytics = createAnalytics({
      provider: { provider: gated, requiresConsent: ["marketing"] },
    });

    analytics.track("evt");
    analytics.identify("user_1");
    expect(gated.track).not.toHaveBeenCalled();
    expect(gated.identify).not.toHaveBeenCalled();

    analytics.consent.grant("marketing");
    analytics.track("evt");
    analytics.identify("user_1");
    expect(gated.track).toHaveBeenCalledTimes(1);
    expect(gated.identify).toHaveBeenCalledTimes(1);
  });

  it("a consent-denied provider entry never triggers a capability warning for identify/group/alias, even when the provider is missing the method entirely (zero console.warn calls)", () => {
    const warnSpy = stubConsoleWarn();
    // No identify/group/alias methods at all -- `capabilities` also
    // declares them unsupported, so without issue 005's consent-first
    // ordering this would normally trigger one console.warn per capability
    // the first time it's called.
    const incapableProvider: AnalyticsProvider = {
      name: "incapable",
      capabilities: {
        identify: false,
        group: false,
        alias: false,
        page: false,
        screen: false,
        batching: false,
        offline: false,
        featureFlags: false,
        sessionReplay: false,
        heatmaps: false,
      },
      track: mock(() => {}),
    };

    const analytics = createAnalytics({
      provider: [{ provider: incapableProvider, requiresConsent: ["marketing"] }],
    });

    // Consent for "marketing" is never granted -- every call below is
    // blocked by consent, so the capability check (and its console.warn)
    // should never even be reached.
    analytics.identify("user_1");
    analytics.group("group_1");
    analytics.alias("user_2", "user_1");

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("no requiresConsent on any entry: zero behavior change (regression) for both track/page/screen routing and identify/group/alias fan-out", () => {
    const providerA = spyProvider("a");
    const providerB = spyProvider("b");
    const analytics = createAnalytics({ provider: [{ provider: providerA }, { provider: providerB }] });

    analytics.track("evt");
    analytics.page();
    analytics.screen();
    analytics.identify("user_1");
    analytics.group("group_1");
    analytics.alias("user_2", "user_1");

    for (const provider of [providerA, providerB]) {
      expect(provider.track).toHaveBeenCalledTimes(1);
      expect(provider.page).toHaveBeenCalledTimes(1);
      expect(provider.screen).toHaveBeenCalledTimes(1);
      expect(provider.identify).toHaveBeenCalledTimes(1);
      expect(provider.group).toHaveBeenCalledTimes(1);
      expect(provider.alias).toHaveBeenCalledTimes(1);
    }
  });

  // Documentation point (per the issue: a comment/type-level acceptance
  // point is acceptable here, since there's something concretely
  // runtime-observable to assert too -- so this is a real test, not just a
  // comment). The Phase-6 "single bare provider" fast path
  // (`provider: someAnalyticsProvider`, no `ProviderEntry`/array wrapping)
  // normalizes to `{ entries: [{ provider }], isMulti: false }`
  // (`normalizeProviders`) -- the resulting `ProviderEntry` is always a
  // bare `{ provider }` object with no way to set `requiresConsent` on it,
  // exactly like `include`/`exclude`/`sampling`/`priority` already require
  // `ProviderEntry` wrapping (or an array) per Phase 7. A caller must wrap
  // a single provider in a `ProviderEntry` (or a one-element array) to use
  // `requiresConsent` -- confirmed below by placing a same-named field
  // directly on the `AnalyticsProvider` object itself (not a real field of
  // `AnalyticsProvider`, and not read from anywhere on this path) and
  // observing it has zero gating effect.
  it("single bare provider (no ProviderEntry/array wrapping): a requiresConsent-shaped field placed on the AnalyticsProvider object itself has no gating effect -- wrapping in ProviderEntry or an array is required to use requiresConsent", () => {
    const provider = spyProvider("bare");
    (provider as AnalyticsProvider & { requiresConsent?: string[] }).requiresConsent = ["marketing"];

    const analytics = createAnalytics({ provider }); // bare -- isMulti: false, no consent configured at all

    analytics.track("evt");
    expect(provider.track).toHaveBeenCalledTimes(1);
  });
});

// Phase 11 issue 006: `analytics.cookieless` mirrors the constructor option
// verbatim, and this is a regression test locking in core's EXISTING
// (unchanged by this issue) contract that it never touches any client-side
// storage API itself, regardless of `cookieless`'s value -- `anonymousId`/
// `sessionId` have been in-memory-only since Phase 6. `localStorage`/
// `sessionStorage`/`document.cookie` are stubbed with spies (this package's
// `tsconfig.json` has no `"dom"` in `lib`, so these aren't ambient types --
// same `Object.defineProperty(globalThis, ...)` technique used throughout
// `src/plugins/autoUTM.test.ts`) and asserted untouched after exercising
// every verb. Uses the default `noopProvider` (no `provider` option) so the
// assertion is purely about core's own behavior, independent of whatever a
// real provider adapter might do.
describe("createAnalytics({ cookieless }) (Phase 11 issue 006)", () => {
  afterEach(() => {
    for (const key of ["localStorage", "sessionStorage", "document"] as const) {
      delete (globalThis as Record<string, unknown>)[key];
    }
  });

  function stubStorageSpies(): {
    localStorageGetItem: ReturnType<typeof mock>;
    localStorageSetItem: ReturnType<typeof mock>;
    sessionStorageGetItem: ReturnType<typeof mock>;
    sessionStorageSetItem: ReturnType<typeof mock>;
    cookieGet: ReturnType<typeof mock>;
    cookieSet: ReturnType<typeof mock>;
  } {
    const localStorageGetItem = mock((_key: string) => null as string | null);
    const localStorageSetItem = mock((_key: string, _value: string) => {});
    const sessionStorageGetItem = mock((_key: string) => null as string | null);
    const sessionStorageSetItem = mock((_key: string, _value: string) => {});
    const cookieGet = mock(() => "");
    const cookieSet = mock((_value: string) => {});

    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: localStorageGetItem, setItem: localStorageSetItem },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: { getItem: sessionStorageGetItem, setItem: sessionStorageSetItem },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {
        get cookie() {
          cookieGet();
          return "";
        },
        set cookie(value: string) {
          cookieSet(value);
        },
      },
      configurable: true,
      writable: true,
    });

    return {
      localStorageGetItem,
      localStorageSetItem,
      sessionStorageGetItem,
      sessionStorageSetItem,
      cookieGet,
      cookieSet,
    };
  }

  // Exercises every verb on `Analytics` -- track/page/screen/identify/
  // group/alias/reset/flush/destroy, per the issue's acceptance criteria.
  async function exerciseEveryVerb(analytics: Analytics<any>): Promise<void> {
    await analytics.track("evt", { prop: 1 });
    await analytics.page("home");
    await analytics.screen("main");
    await analytics.identify("user_1", { plan: "pro" });
    await analytics.group("group_1", { name: "acme" });
    await analytics.alias("user_2", "user_1");
    await analytics.reset();
    await analytics.flush();
    await analytics.destroy();
  }

  it("cookieless: true -- analytics.cookieless is true, and core never calls localStorage/sessionStorage/document.cookie across every verb", async () => {
    const spies = stubStorageSpies();
    const analytics = createAnalytics({ cookieless: true });

    expect(analytics.cookieless).toBe(true);

    await exerciseEveryVerb(analytics);

    expect(spies.localStorageGetItem).not.toHaveBeenCalled();
    expect(spies.localStorageSetItem).not.toHaveBeenCalled();
    expect(spies.sessionStorageGetItem).not.toHaveBeenCalled();
    expect(spies.sessionStorageSetItem).not.toHaveBeenCalled();
    expect(spies.cookieGet).not.toHaveBeenCalled();
    expect(spies.cookieSet).not.toHaveBeenCalled();
  });

  it("cookieless: false (explicit) -- analytics.cookieless is false, and core still never calls localStorage/sessionStorage/document.cookie across every verb (status quo, unchanged by this issue)", async () => {
    const spies = stubStorageSpies();
    const analytics = createAnalytics({ cookieless: false });

    expect(analytics.cookieless).toBe(false);

    await exerciseEveryVerb(analytics);

    expect(spies.localStorageGetItem).not.toHaveBeenCalled();
    expect(spies.localStorageSetItem).not.toHaveBeenCalled();
    expect(spies.sessionStorageGetItem).not.toHaveBeenCalled();
    expect(spies.sessionStorageSetItem).not.toHaveBeenCalled();
    expect(spies.cookieGet).not.toHaveBeenCalled();
    expect(spies.cookieSet).not.toHaveBeenCalled();
  });

  it("cookieless omitted (default) -- analytics.cookieless is false, and core still never calls localStorage/sessionStorage/document.cookie across every verb", async () => {
    const spies = stubStorageSpies();
    const analytics = createAnalytics();

    expect(analytics.cookieless).toBe(false);

    await exerciseEveryVerb(analytics);

    expect(spies.localStorageGetItem).not.toHaveBeenCalled();
    expect(spies.localStorageSetItem).not.toHaveBeenCalled();
    expect(spies.sessionStorageGetItem).not.toHaveBeenCalled();
    expect(spies.sessionStorageSetItem).not.toHaveBeenCalled();
    expect(spies.cookieGet).not.toHaveBeenCalled();
    expect(spies.cookieSet).not.toHaveBeenCalled();
  });
});

// Integration tests for Phase 12 issue 003: wiring `reliability` into
// `createAnalytics()` -- offline detection, failure-path enqueue, the
// background drain loop, and `analytics.queue`. Issues 001/002's own pure
// logic already have their own unit tests (`src/reliability/storage.test.ts`,
// `src/reliability/queue.test.ts`) -- this describe block covers the wiring
// only, per this issue's "Test requirements" ("no new unit tests beyond
// issues 001/002's own").
//
// Test-hook mechanism (documented per the issue's "implementor's choice"):
// this whole describe block runs under `jest.useFakeTimers()` (Bun's
// jest-compat fake timer support) -- both `Date.now()` (controls each
// entry's own `nextAttemptAt` backoff gate) and `setInterval` (the
// background drain tick) become deterministically advanceable via
// `jest.advanceTimersByTime()`, with zero real waiting. A handful of tests
// additionally use `analytics.queue.drain()`/`analytics.flush()` directly
// (both real, public API surface -- not test-only shims) as a second,
// synchronous way to trigger exactly one `drainQueueOnce()`, since that
// distinguishes the backoff-respecting path (`queue.drain()`) from the
// backoff-bypassing path (`flush()`, BRIEF.md decision 8) far more directly
// than waiting for the interval tick to happen to align with a real clock.
describe("createAnalytics({ reliability }) (Phase 12 issue 003)", () => {
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    console.warn = originalConsoleWarn;
    for (const key of ["window", "navigator", "localStorage"] as const) {
      delete (globalThis as Record<string, unknown>)[key];
    }
  });

  function stubConsoleWarn() {
    const warn = mock((..._args: unknown[]) => {});
    console.warn = warn as unknown as typeof console.warn;
    return warn;
  }

  // A small, controllable `AnalyticsProvider` test double: `failTimes`
  // rejections for each verb, then every subsequent call to that verb
  // succeeds. Every attempted call (whether it ultimately fails or
  // succeeds) is recorded in the matching `*Calls` array, so a test can
  // assert both "how many times was this verb attempted" and "was it
  // attempted at all" (the offline-skip tests assert zero attempts).
  function createFlakyProvider(
    name: string,
    options: { failTimes?: number } = {},
  ): AnalyticsProvider & {
    trackCalls: CanonicalEvent[];
    pageCalls: CanonicalEvent[];
    screenCalls: CanonicalEvent[];
  } {
    let remainingFailures = options.failTimes ?? 0;
    const trackCalls: CanonicalEvent[] = [];
    const pageCalls: CanonicalEvent[] = [];
    const screenCalls: CanonicalEvent[] = [];

    function attempt(event: CanonicalEvent, calls: CanonicalEvent[]): Promise<void> {
      calls.push(event);
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        return Promise.reject(new Error(`${name}: simulated failure`));
      }
      return Promise.resolve();
    }

    return {
      name,
      capabilities: allCapabilities,
      trackCalls,
      pageCalls,
      screenCalls,
      track: (event) => attempt(event, trackCalls),
      page: (event) => attempt(event, pageCalls),
      screen: (event) => attempt(event, screenCalls),
    };
  }

  // Stubs a browser environment with a controllable `navigator.onLine` and
  // spy `window.addEventListener`/`removeEventListener` -- `triggerOnline()`
  // invokes whichever listener(s) were registered for the `"online"` type
  // directly (matching `autoErrors.test.ts`'s precedent of invoking a
  // captured listener directly rather than constructing a real DOM Event).
  function stubBrowserOnline(online: boolean): {
    addEventListener: ReturnType<typeof mock>;
    removeEventListener: ReturnType<typeof mock>;
    triggerOnline: () => void;
  } {
    const addEventListener = mock((_type: string, _listener: () => void) => {});
    const removeEventListener = mock((_type: string, _listener: () => void) => {});

    Object.defineProperty(globalThis, "window", {
      value: { addEventListener, removeEventListener },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: online },
      configurable: true,
      writable: true,
    });

    function triggerOnline(): void {
      for (const call of addEventListener.mock.calls) {
        if (call[0] === "online") {
          (call[1] as () => void)();
        }
      }
    }

    return { addEventListener, removeEventListener, triggerOnline };
  }

  // Lets a handful of pending microtasks (queue-engine `await`s spawned by a
  // fire-and-forget `void drainQueueOnce()` call from the interval tick /
  // `online` listener) settle before assertions run. `jest.advanceTimersByTime`
  // itself only fires the timer callback synchronously -- it does not wait
  // for that callback's own internal `await` chain to resolve.
  async function flushAsync(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  it("reliability omitted: single-provider failure is byte-for-byte pre-Phase-12 behavior (regression)", async () => {
    const warn = stubConsoleWarn();
    const boom = new Error("boom");
    const onError = mock(() => {});
    const provider: AnalyticsProvider = {
      name: "flaky",
      capabilities: allCapabilities,
      track: () => Promise.reject(boom),
    };
    const analytics = createAnalytics({ provider });
    analytics.use({ name: "spy", onError });

    await analytics.track("event");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(analytics.queue.size()).toBe(0);
  });

  it("reliability omitted: multi-provider failure is byte-for-byte pre-Phase-12 behavior (regression)", async () => {
    const warn = stubConsoleWarn();
    const boom = new Error("boom");
    const onError = mock(() => {});
    const failing: AnalyticsProvider = {
      name: "failing",
      capabilities: allCapabilities,
      track: () => Promise.reject(boom),
    };
    const healthy: AnalyticsProvider = { name: "healthy", capabilities: allCapabilities, track: mock(() => {}) };
    const analytics = createAnalytics({ provider: [failing, healthy] });
    analytics.use({ name: "spy", onError });

    await analytics.track("event");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(analytics.queue.size()).toBe(0);
  });

  it("reliability: true, offline (navigator.onLine === false): track() never calls the provider, queue.size() increases by one, no console.warn", async () => {
    const warn = stubConsoleWarn();
    stubBrowserOnline(false);
    const provider = createFlakyProvider("solo");
    const analytics = createAnalytics({ provider, reliability: true });

    await analytics.track("event");

    expect(provider.trackCalls).toHaveLength(0);
    expect(analytics.queue.size()).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reliability: true, offline, multi-provider fan-out: the offline provider is skipped and queued per-entry, an unaffected provider is called normally", async () => {
    stubBrowserOnline(false);
    const offlineProvider = createFlakyProvider("offline-target");
    const alwaysOnProvider = createFlakyProvider("always-on");
    const analytics = createAnalytics({ provider: [offlineProvider, alwaysOnProvider], reliability: true });

    await analytics.track("event");

    expect(offlineProvider.trackCalls).toHaveLength(0);
    expect(alwaysOnProvider.trackCalls).toHaveLength(0);
    // Both providers are offline (there's no per-provider network state --
    // `isOffline()` is instance-wide) -- both entries are queued.
    expect(analytics.queue.size()).toBe(2);
  });

  it("reliability: true, provider online but track() rejects: console.warn still fires, notifyOnError is NOT called immediately, queue.size() increases by one", async () => {
    const warn = stubConsoleWarn();
    const onError = mock(() => {});
    const provider = createFlakyProvider("flaky", { failTimes: 1 });
    const analytics = createAnalytics({ provider, reliability: true });
    analytics.use({ name: "spy", onError });

    await analytics.track("event");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(analytics.queue.size()).toBe(1);
  });

  it("reliability: true, multi-provider fan-out failure: console.warn still fires, notifyOnError is NOT called immediately, queue.size() increases by one", async () => {
    const warn = stubConsoleWarn();
    const onError = mock(() => {});
    const failing = createFlakyProvider("failing", { failTimes: 1 });
    const healthy = createFlakyProvider("healthy");
    const analytics = createAnalytics({ provider: [failing, healthy], reliability: true });
    analytics.use({ name: "spy", onError });

    await analytics.track("event");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(analytics.queue.size()).toBe(1);
    expect(healthy.trackCalls).toHaveLength(1);
  });

  it("background drain tick (setInterval, real production path): a queued entry that now succeeds is removed from the queue (recordSuccess)", async () => {
    const provider = createFlakyProvider("solo", { failTimes: 1 });
    const analytics = createAnalytics({ provider, reliability: true });

    await analytics.track("event");
    expect(analytics.queue.size()).toBe(1);
    expect(provider.trackCalls).toHaveLength(1);

    // Advances past the fixed 5s drain-tick interval -- independent of any
    // entry's own `nextAttemptAt` (a freshly-enqueued entry's
    // `nextAttemptAt` is `now`, so it's already "ready" the moment it's
    // enqueued).
    jest.advanceTimersByTime(5000);
    await flushAsync();

    expect(provider.trackCalls).toHaveLength(2);
    expect(analytics.queue.size()).toBe(0);

    await analytics.destroy();
  });

  it("analytics.queue.drain() manually triggers exactly one drainQueueOnce() pass, respecting each entry's own backoff gate", async () => {
    const provider = createFlakyProvider("solo", { failTimes: 1 });
    const analytics = createAnalytics({ provider, reliability: true });

    await analytics.track("event");
    await analytics.queue.drain();

    expect(provider.trackCalls).toHaveLength(2);
    expect(analytics.queue.size()).toBe(0);

    await analytics.destroy();
  });

  it("the browser online event triggers an immediate drain, without waiting for the next timer tick", async () => {
    const { triggerOnline } = stubBrowserOnline(true);
    const provider = createFlakyProvider("solo", { failTimes: 1 });
    const analytics = createAnalytics({ provider, reliability: true });

    await analytics.track("event");
    expect(analytics.queue.size()).toBe(1);

    triggerOnline();
    await flushAsync();

    expect(provider.trackCalls).toHaveLength(2);
    expect(analytics.queue.size()).toBe(0);

    await analytics.destroy();
  });

  it("repeated failures through maxAttempts: onDeadLetter/notifyOnError fires exactly once, at exhaustion, not on every intermediate attempt", async () => {
    const onError = mock(() => {});
    // Never succeeds -- forces every retry through `recordFailure` until
    // `maxAttempts` (2, for a short test) is exhausted.
    const provider = createFlakyProvider("always-fails", { failTimes: Number.POSITIVE_INFINITY });
    const analytics = createAnalytics({ provider, reliability: { maxAttempts: 2 } });
    analytics.use({ name: "spy", onError });

    await analytics.track("event"); // initial failure -> enqueued (attempts: 0)
    expect(onError).not.toHaveBeenCalled();
    expect(analytics.queue.size()).toBe(1);

    // First retry (via the interval tick) -> fails -> recordFailure ->
    // attempts: 1 (< maxAttempts: 2) -> still queued, not yet dead-lettered.
    jest.advanceTimersByTime(5000);
    await flushAsync();
    expect(onError).not.toHaveBeenCalled();
    expect(analytics.queue.size()).toBe(1);

    // Second retry -> fails -> recordFailure -> attempts: 2 (>= maxAttempts:
    // 2) -> dead-lettered: entry removed, onDeadLetter -> notifyOnError
    // fires exactly once.
    jest.advanceTimersByTime(5000);
    await flushAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(analytics.queue.size()).toBe(0);

    // A further tick has nothing left to retry -- onError stays at exactly
    // one call, never incremented again.
    jest.advanceTimersByTime(5000);
    await flushAsync();
    expect(onError).toHaveBeenCalledTimes(1);

    await analytics.destroy();
  });

  it("flush() drains the queue immediately, bypassing an entry's own backoff gate (BRIEF.md decision 8)", async () => {
    // Fails on the initial track() call and on the first retry; succeeds on
    // the third attempt (the flush()-triggered one).
    const provider = createFlakyProvider("flaky", { failTimes: 2 });
    const analytics = createAnalytics({ provider, reliability: true });

    await analytics.track("event"); // attempt 1: fails -> enqueued (nextAttemptAt: now)
    expect(provider.trackCalls).toHaveLength(1);

    await analytics.queue.drain(); // attempt 2: fails -> recordFailure -> nextAttemptAt: now + 2000ms (default backoff)
    expect(provider.trackCalls).toHaveLength(2);
    expect(analytics.queue.size()).toBe(1);

    // The backoff window has NOT elapsed (fake time is frozen -- no
    // `jest.advanceTimersByTime` call since the last failure) -- a
    // backoff-respecting drain must not retry yet.
    await analytics.queue.drain();
    expect(provider.trackCalls).toHaveLength(2); // unchanged: still gated
    expect(analytics.queue.size()).toBe(1);

    // `flush()` bypasses that same gate and retries immediately -- this
    // attempt succeeds (failTimes exhausted).
    await analytics.flush();
    expect(provider.trackCalls).toHaveLength(3);
    expect(analytics.queue.size()).toBe(0);

    await analytics.destroy();
  });

  it("destroy() stops the background drain timer -- no further drain attempts occur after destroy(), verified by advancing time post-destroy -- and destroy() itself never drains", async () => {
    // Always fails -- so there's still exactly one queued, unretried entry
    // at the moment `destroy()` is called, giving the timer something it
    // would otherwise (incorrectly) act on afterwards.
    const provider = createFlakyProvider("solo", { failTimes: Number.POSITIVE_INFINITY });
    const analytics = createAnalytics({ provider, reliability: true });

    await analytics.track("event"); // fails -> enqueued
    expect(provider.trackCalls).toHaveLength(1);
    expect(analytics.queue.size()).toBe(1);

    await analytics.destroy();

    // `destroy()` itself never drains (BRIEF.md decision 8) -- the entry is
    // left exactly as it was, still queued.
    expect(provider.trackCalls).toHaveLength(1);
    expect(analytics.queue.size()).toBe(1);

    jest.advanceTimersByTime(5000 * 3);
    await flushAsync();

    // Nothing new was attempted -- the background timer no longer fires at
    // all after destroy().
    expect(provider.trackCalls).toHaveLength(1);
    expect(analytics.queue.size()).toBe(1);
  });

  it("a second Analytics instance constructed against the same resolved storage location hydrates entries a first, now-destroyed instance had persisted", async () => {
    // A single-slot fake `localStorage`: `getItem`/`setItem`/`removeItem`
    // ignore whatever key they're called with and always read/write one
    // shared underlying value. This is the test's chosen mechanism for
    // making cross-instance persistence deterministic "without relying on
    // the internal auto-generated prefix scheme" (each `Analytics`
    // instance's storage key is a random per-instance suffix -- see
    // `src/index.ts`'s reliability construction comment -- so two
    // independently-constructed instances would otherwise use two
    // different, unpredictable keys; this fake storage backend makes that
    // distinction irrelevant for the purpose of this test).
    let stored: string | null = null;
    const getItem = mock((_key: string) => stored);
    const setItem = mock((_key: string, value: string) => {
      stored = value;
    });
    const removeItem = mock((_key: string) => {
      stored = null;
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem, setItem, removeItem },
      configurable: true,
      writable: true,
    });

    const providerA = createFlakyProvider("shared-provider", { failTimes: Number.POSITIVE_INFINITY });
    const analytics1 = createAnalytics({ provider: providerA, reliability: { storage: "localstorage" } });

    await analytics1.track("event");
    expect(analytics1.queue.size()).toBe(1);
    await analytics1.destroy();

    const providerB = createFlakyProvider("shared-provider"); // same `name` -- succeeds on drain
    const analytics2 = createAnalytics({ provider: providerB, reliability: { storage: "localstorage" } });

    // `hydrate()` is fire-and-forget (issue 003 design decision) -- give it
    // a few microtask turns to complete before asserting.
    await flushAsync();

    expect(analytics2.queue.size()).toBe(1);

    await analytics2.queue.drain();
    expect(providerB.trackCalls).toHaveLength(1);
    expect(analytics2.queue.size()).toBe(0);

    await analytics2.destroy();
  });

  it("analytics.queue is present and no-op when reliability was never configured", async () => {
    const analytics = createAnalytics();

    expect(analytics.queue.size()).toBe(0);
    await expect(analytics.queue.drain()).resolves.toBeUndefined();
    expect(() => analytics.queue.clear()).not.toThrow();
    expect(analytics.queue.size()).toBe(0);
  });
});
