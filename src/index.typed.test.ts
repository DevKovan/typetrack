import { describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities } from "./test-support";

type SampleEvents = {
  signup_completed: { plan: "free" | "pro" };
  page_viewed: undefined;
};

describe("createAnalytics<Events>()", () => {
  it("forwards track calls with a valid event/payload to the given provider, building a CanonicalEvent", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track("signup_completed", { plan: "pro" });

    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.name).toBe("signup_completed");
    expect(canonicalEvent.properties).toEqual({ plan: "pro" });
    expect(canonicalEvent.timestamp).toBeGreaterThan(0);
  });

  it("allows a no-payload event to be called without a second argument, forwarding {} as properties", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track("page_viewed");

    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.name).toBe("page_viewed");
    expect(canonicalEvent.properties).toEqual({});
  });
});
