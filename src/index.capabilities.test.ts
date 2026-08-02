// Unit tests for issue 002's capability-gating (warn-once) policy covering
// the five gated verbs: identify/page/group/alias/screen.
import { afterEach, describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities, noCapabilities } from "./test-support";

const originalConsoleWarn = console.warn;

afterEach(() => {
  console.warn = originalConsoleWarn;
});

function stubConsoleWarn() {
  const warn = mock(() => {});
  console.warn = warn as unknown as typeof console.warn;
  return warn;
}

describe("createAnalytics() capability-gating", () => {
  it("identify(): capability false -- does not call provider.identify, does not throw, warns exactly once", () => {
    const warn = stubConsoleWarn();
    const identify = mock<NonNullable<AnalyticsProvider["identify"]>>(() => {});
    const provider: AnalyticsProvider = {
      name: "gated",
      capabilities: { ...noCapabilities },
      track: () => {},
      identify,
    };
    const analytics = createAnalytics({ provider });

    expect(() => analytics.identify("user_1")).not.toThrow();
    expect(() => analytics.identify("user_1")).not.toThrow();

    expect(identify).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("page(): capability true but method omitted -- does not throw, warns exactly once, does not warn again on a second call", () => {
    const warn = stubConsoleWarn();
    const provider: AnalyticsProvider = {
      name: "gated",
      capabilities: { ...allCapabilities },
      track: () => {},
      // `page` intentionally omitted.
    };
    const analytics = createAnalytics({ provider });

    expect(() => analytics.page("home")).not.toThrow();
    expect(() => analytics.page("checkout")).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("group(): capability false -- does not call provider.group, does not throw, warns exactly once", () => {
    const warn = stubConsoleWarn();
    const group = mock<NonNullable<AnalyticsProvider["group"]>>(() => {});
    const provider: AnalyticsProvider = {
      name: "gated",
      capabilities: { ...noCapabilities },
      track: () => {},
      group,
    };
    const analytics = createAnalytics({ provider });

    analytics.group("group_1");
    analytics.group("group_2");

    expect(group).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("alias(): capability false -- does not call provider.alias, does not throw, warns exactly once", () => {
    const warn = stubConsoleWarn();
    const alias = mock<NonNullable<AnalyticsProvider["alias"]>>(() => {});
    const provider: AnalyticsProvider = {
      name: "gated",
      capabilities: { ...noCapabilities },
      track: () => {},
      alias,
    };
    const analytics = createAnalytics({ provider });

    analytics.alias("user_2");
    analytics.alias("user_3");

    expect(alias).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("screen(): capability false -- does not call provider.screen, does not throw, warns exactly once", () => {
    const warn = stubConsoleWarn();
    const screen = mock<NonNullable<AnalyticsProvider["screen"]>>(() => {});
    const provider: AnalyticsProvider = {
      name: "gated",
      capabilities: { ...noCapabilities },
      track: () => {},
      screen,
    };
    const analytics = createAnalytics({ provider });

    analytics.screen("checkout");
    analytics.screen("cart");

    expect(screen).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a call to a different gated verb against the same provider produces its own independent warning", () => {
    const warn = stubConsoleWarn();
    const provider: AnalyticsProvider = {
      name: "gated",
      capabilities: { ...noCapabilities },
      track: () => {},
    };
    const analytics = createAnalytics({ provider });

    analytics.identify("user_1");
    analytics.identify("user_1");
    analytics.page("home");
    analytics.page("home");

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("the same gated verb against two differently-named provider instances warns independently for each", () => {
    const warn = stubConsoleWarn();
    const providerA: AnalyticsProvider = { name: "provider-a", capabilities: { ...noCapabilities }, track: () => {} };
    const providerB: AnalyticsProvider = { name: "provider-b", capabilities: { ...noCapabilities }, track: () => {} };
    const analyticsA = createAnalytics({ provider: providerA });
    const analyticsB = createAnalytics({ provider: providerB });

    analyticsA.identify("user_1");
    analyticsA.identify("user_1");
    analyticsB.identify("user_1");
    analyticsB.identify("user_1");

    expect(warn).toHaveBeenCalledTimes(2);
  });
});
