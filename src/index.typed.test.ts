import { describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";

type SampleEvents = {
  signup_completed: { plan: "free" | "pro" };
  page_viewed: undefined;
};

describe("createAnalytics<Events>()", () => {
  it("forwards track calls with a valid event/payload to the given provider, with meta", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", track };
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track("signup_completed", { plan: "pro" });

    expect(track).toHaveBeenCalledTimes(1);
    const [event, payload, meta] = track.mock.calls[0]!;
    expect(event).toBe("signup_completed");
    expect(payload).toEqual({ plan: "pro" });
    expect(meta.timestamp).toBeGreaterThan(0);
  });

  it("allows a no-payload event to be called without a second argument, forwarding {} as payload", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", track };
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track("page_viewed");

    expect(track).toHaveBeenCalledTimes(1);
    const [event, payload] = track.mock.calls[0]!;
    expect(event).toBe("page_viewed");
    expect(payload).toEqual({});
  });
});
