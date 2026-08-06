import { describe, expect, it, spyOn } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import type { CanonicalEvent } from "./schema";
import { allCapabilities } from "./test-support";

// Real `Events` map, both the deprecated (pre-rename) event and its
// replacement declared, matching how an app mid-migration would type its
// events.
type AppEvents = {
  checkout_started: { total: number; currency: string };
  "Checkout Started": { total: number; currency: string };
};

// A real, test-local `AnalyticsProvider` implementation (not a mock) that
// records every call it receives, standing in for a real vendor SDK adapter.
class RecordingProvider implements AnalyticsProvider {
  name = "recording";
  capabilities = allCapabilities;
  calls: CanonicalEvent[] = [];

  track(event: CanonicalEvent) {
    this.calls.push(event);
  }
}

describe("createAnalytics<Events>({ deprecatedEvents }) integration", () => {
  it("redirects a deprecated event name to its replacement end-to-end: the provider only ever sees the replacement name", async () => {
    const provider = new RecordingProvider();
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const analytics = createAnalytics<AppEvents>({
      provider,
      deprecatedEvents: {
        checkout_started: {
          replacement: "Checkout Started",
          message: "renamed to Title Case for consistency with our other event names",
          sunsetDate: "2027-01-01",
        },
      },
    });

    await analytics.track("checkout_started", { total: 99.99, currency: "USD" });
    await analytics.track("checkout_started", { total: 15, currency: "EUR" });

    expect(provider.calls).toHaveLength(2);
    for (const call of provider.calls) {
      expect(call.name).toBe("Checkout Started");
    }
    expect(provider.calls[0]!.properties).toEqual({ total: 99.99, currency: "USD" });
    expect(provider.calls[1]!.properties).toEqual({ total: 15, currency: "EUR" });

    // Warned exactly once (across both calls), not once per call.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0]!;
    expect(message).toContain('typetrack: event "checkout_started" is deprecated');
    expect(message).toContain('use "Checkout Started" instead');
    expect(message).toContain("Planned removal: 2027-01-01.");
    expect(message).toContain("renamed to Title Case for consistency with our other event names");

    warnSpy.mockRestore();
  });
});
