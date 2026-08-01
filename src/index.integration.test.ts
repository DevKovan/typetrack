import { describe, expect, it } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import type { EventMeta } from "./schema";

type AppEvents = {
  signup_completed: { plan: "free" | "pro" };
  page_viewed: undefined;
};

// A real, test-local AnalyticsProvider implementation (not a mock) that
// records every call it receives, standing in for a real vendor SDK
// adapter.
class RecordingProvider implements AnalyticsProvider {
  name = "recording";
  calls: Array<{ event: string; payload: Record<string, unknown>; meta: EventMeta }> = [];

  track(event: string, payload: Record<string, unknown>, meta: EventMeta) {
    this.calls.push({ event, payload, meta });
  }
}

describe("createAnalytics<Events>() integration", () => {
  it("delivers both payload-bearing and no-payload events end-to-end to a real provider", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider });

    await analytics.track("signup_completed", { plan: "free" });
    await analytics.track("page_viewed");

    expect(provider.calls).toHaveLength(2);

    expect(provider.calls[0]!.event).toBe("signup_completed");
    expect(provider.calls[0]!.payload).toEqual({ plan: "free" });
    expect(provider.calls[0]!.meta.timestamp).toBeGreaterThan(0);

    expect(provider.calls[1]!.event).toBe("page_viewed");
    expect(provider.calls[1]!.payload).toEqual({});
    expect(provider.calls[1]!.meta.timestamp).toBeGreaterThan(0);
  });
});
