import { describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";

describe("createAnalytics", () => {
  it("defaults to the no-op provider and never throws", async () => {
    const analytics = createAnalytics();
    await analytics.track("event");
    await analytics.identify("user_1");
    await analytics.page();
    await analytics.flush();
  });

  it("forwards track calls to the given provider with meta", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", track };
    const analytics = createAnalytics({ provider });

    analytics.track("signup", { plan: "pro" });

    expect(track).toHaveBeenCalledTimes(1);
    const [event, payload, meta] = track.mock.calls[0]!;
    expect(event).toBe("signup");
    expect(payload).toEqual({ plan: "pro" });
    expect(meta.timestamp).toBeGreaterThan(0);
  });
});
