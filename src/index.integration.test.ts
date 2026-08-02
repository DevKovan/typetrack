import { describe, expect, it } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import type { CanonicalEvent } from "./schema";
import { allCapabilities } from "./test-support";

type AppEvents = {
  signup_completed: { plan: "free" | "pro" };
  page_viewed: undefined;
};

// A real, test-local AnalyticsProvider implementation (not a mock) that
// records every call it receives, standing in for a real vendor SDK
// adapter.
class RecordingProvider implements AnalyticsProvider {
  name = "recording";
  capabilities = allCapabilities;
  calls: CanonicalEvent[] = [];

  track(event: CanonicalEvent) {
    this.calls.push(event);
  }
}

describe("createAnalytics<Events>() integration", () => {
  it("delivers both payload-bearing and no-payload events end-to-end to a real provider", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider });

    await analytics.track("signup_completed", { plan: "free" });
    await analytics.track("page_viewed");

    expect(provider.calls).toHaveLength(2);

    expect(provider.calls[0]!.name).toBe("signup_completed");
    expect(provider.calls[0]!.properties).toEqual({ plan: "free" });
    expect(provider.calls[0]!.timestamp).toBeGreaterThan(0);

    expect(provider.calls[1]!.name).toBe("page_viewed");
    expect(provider.calls[1]!.properties).toEqual({});
    expect(provider.calls[1]!.timestamp).toBeGreaterThan(0);
  });
});
