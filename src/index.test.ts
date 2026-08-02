import { describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
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
