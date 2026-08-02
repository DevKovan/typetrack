// Unit tests for issue 003's routing-specific behavior inside
// `createAnalytics()`'s multi-provider fan-out: `include`/`exclude` gating on
// track()/page()/screen(), the "routing excluded -> never capability-gated"
// ordering rule, and `priority`-driven call ordering. General fan-out/error-
// isolation/identity-sharing behavior lives in `src/index.multiProvider.test.ts`.
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

function makeProvider(name: string, overrides: Partial<AnalyticsProvider> = {}): AnalyticsProvider {
  return {
    name,
    capabilities: allCapabilities,
    track: mock(() => {}),
    page: mock(() => {}),
    screen: mock(() => {}),
    ...overrides,
  };
}

describe("createAnalytics() multi-provider routing", () => {
  it("array with one ProviderEntry using include, one bare provider: an event not matching include is skipped for the wrapped provider but still delivered to the bare provider", async () => {
    const wrapped = makeProvider("wrapped");
    const bare = makeProvider("bare");
    const analytics = createAnalytics({
      provider: [{ provider: wrapped, include: ["allowed_event"] }, bare],
    });

    await analytics.track("not_allowed_event");

    expect(wrapped.track).not.toHaveBeenCalled();
    expect(bare.track).toHaveBeenCalledTimes(1);
  });

  it("a provider excluded by routing never triggers a capability warning for that call, even if it also lacks the capability", async () => {
    const warn = stubConsoleWarn();
    const excludedIncapable = makeProvider("excluded-incapable", {
      capabilities: { ...noCapabilities, page: false },
    });
    const included = makeProvider("included");
    const analytics = createAnalytics({
      provider: [
        { provider: excludedIncapable, include: ["never_matches"] },
        included,
      ],
    });

    await analytics.page("home");

    expect(excludedIncapable.page).not.toHaveBeenCalled();
    expect(included.page).toHaveBeenCalledTimes(1);
    // No warning at all -- the excluded provider was never a candidate, so
    // its unrelated capability gap never surfaces.
    expect(warn).not.toHaveBeenCalled();
  });

  it("a provider excluded by routing on screen() also never triggers a capability warning", async () => {
    const warn = stubConsoleWarn();
    const excludedIncapable = makeProvider("excluded-incapable-screen", {
      capabilities: { ...noCapabilities, screen: false },
    });
    const included = makeProvider("included-screen");
    const analytics = createAnalytics({
      provider: [
        { provider: excludedIncapable, exclude: ["*"] },
        included,
      ],
    });

    await analytics.screen("checkout");

    expect(excludedIncapable.screen).not.toHaveBeenCalled();
    expect(included.screen).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("priority ordering: 3 providers with priorities [2, 0, 1] are invoked in ascending priority order 0, 1, 2", async () => {
    const callOrder: string[] = [];
    const highPriority = makeProvider("high-priority-2", {
      track: mock(() => {
        callOrder.push("high-priority-2");
      }),
    });
    const lowPriority = makeProvider("low-priority-0", {
      track: mock(() => {
        callOrder.push("low-priority-0");
      }),
    });
    const midPriority = makeProvider("mid-priority-1", {
      track: mock(() => {
        callOrder.push("mid-priority-1");
      }),
    });

    const analytics = createAnalytics({
      provider: [
        { provider: highPriority, priority: 2 },
        { provider: lowPriority, priority: 0 },
        { provider: midPriority, priority: 1 },
      ],
    });

    await analytics.track("event");

    expect(callOrder).toEqual(["low-priority-0", "mid-priority-1", "high-priority-2"]);
  });

  it("predicate + sampling routing: a provider whose predicate rejects the event is skipped, a provider with sampling 1 always routes", async () => {
    const predicateProvider = makeProvider("predicate-only");
    const alwaysSampled = makeProvider("always-sampled");
    const analytics = createAnalytics({
      provider: [
        { provider: predicateProvider, predicate: (event) => event.properties.plan === "pro" },
        { provider: alwaysSampled, sampling: 1 },
      ],
    });

    await analytics.track("purchase", { plan: "free" });

    expect(predicateProvider.track).not.toHaveBeenCalled();
    expect(alwaysSampled.track).toHaveBeenCalledTimes(1);
  });
});
