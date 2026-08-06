import { describe, expect, it, mock, spyOn } from "bun:test";
import { z } from "zod";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities } from "./test-support";

type SampleEvents = {
  checkout_started: { total: number };
  "Checkout Started": { total: number };
  old_signup: { plan: string };
  legacy_purchase_a: { amount: number };
  legacy_purchase_b: { amount: number };
  purchase_completed: { amount: number };
};

describe("createAnalytics({ deprecatedEvents }) wiring", () => {
  it("with deprecatedEvents omitted, never warns and forwards every event name unchanged", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track("checkout_started", { total: 10 });
    analytics.track("checkout_started", { total: 20 });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(2);
    expect(track.mock.calls[0]![0]!.name).toBe("checkout_started");
    expect(track.mock.calls[1]![0]!.name).toBe("checkout_started");

    warnSpy.mockRestore();
  });

  it("a deprecated event with no replacement warns once across 2 calls, still dispatched under its original name, still validated against schemas[originalName]", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const analytics = createAnalytics<SampleEvents>({
      provider,
      deprecatedEvents: {
        old_signup: { message: "please stop using this" },
      },
      schemas: {
        old_signup: z.object({ plan: z.enum(["free", "pro"]) }),
      },
    });

    analytics.track("old_signup", { plan: "free" });
    analytics.track("old_signup", { plan: "pro" });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('event "old_signup" is deprecated');

    expect(track).toHaveBeenCalledTimes(2);
    expect(track.mock.calls[0]![0]!.name).toBe("old_signup");
    expect(track.mock.calls[0]![0]!.properties).toEqual({ plan: "free" });
    expect(track.mock.calls[1]![0]!.name).toBe("old_signup");

    warnSpy.mockRestore();
  });

  it("a deprecated event with a replacement warns once, provider receives the replacement name, CanonicalEvent.name === replacement, validated against schemas[replacement] not schemas[originalName]", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const analytics = createAnalytics<SampleEvents>({
      provider,
      deprecatedEvents: {
        checkout_started: { replacement: "Checkout Started" },
      },
      schemas: {
        // Deliberately always-failing -- if this schema were (incorrectly)
        // consulted instead of the replacement's, the call would throw.
        checkout_started: z.object({ total: z.number().refine(() => false) }),
        "Checkout Started": z.object({ total: z.number() }),
      },
    });

    analytics.track("checkout_started", { total: 42 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('use "Checkout Started" instead');

    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.name).toBe("Checkout Started");
    expect(canonicalEvent.properties).toEqual({ total: 42 });

    warnSpy.mockRestore();
  });

  it("two distinct deprecated names redirecting to the same replacement each warn independently", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const analytics = createAnalytics<SampleEvents>({
      provider,
      deprecatedEvents: {
        legacy_purchase_a: { replacement: "purchase_completed" },
        legacy_purchase_b: { replacement: "purchase_completed" },
      },
    });

    analytics.track("legacy_purchase_a", { amount: 1 });
    analytics.track("legacy_purchase_b", { amount: 2 });
    // Calling `legacy_purchase_a` again must not warn a second time.
    analytics.track("legacy_purchase_a", { amount: 3 });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0]![0]).toContain('event "legacy_purchase_a" is deprecated');
    expect(warnSpy.mock.calls[1]![0]).toContain('event "legacy_purchase_b" is deprecated');

    expect(track).toHaveBeenCalledTimes(3);
    expect(track.mock.calls[0]![0]!.name).toBe("purchase_completed");
    expect(track.mock.calls[1]![0]!.name).toBe("purchase_completed");
    expect(track.mock.calls[2]![0]!.name).toBe("purchase_completed");

    warnSpy.mockRestore();
  });
});
