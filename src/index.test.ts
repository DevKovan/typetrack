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
