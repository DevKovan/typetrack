import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { createAnalytics, EventValidationError } from "./index";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities } from "./test-support";

type SampleEvents = {
  signup_completed: { plan: string; source: string };
  page_viewed: { path: string };
};

describe("createAnalytics({ onValidationError }) unit tests", () => {
  it("does not throw and calls onValidationError exactly once with a matching EventValidationError when configured", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const onValidationError = mock<(error: EventValidationError) => void>(() => {});

    const analytics = createAnalytics<SampleEvents>({
      provider,
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
      onValidationError,
    });

    let caught: unknown;
    try {
      analytics.track("signup_completed", { plan: "enterprise", source: "ad" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeUndefined();
    expect(onValidationError).toHaveBeenCalledTimes(1);
    const [error] = onValidationError.mock.calls[0]!;
    expect(error).toBeInstanceOf(EventValidationError);
    expect(error.event).toBe("signup_completed");
    expect(error.payload).toEqual({ plan: "enterprise", source: "ad" });
    expect(track).not.toHaveBeenCalled();
  });

  it("without onValidationError configured, still throws EventValidationError synchronously (regression guard for issue 002)", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };

    const analytics = createAnalytics<SampleEvents>({
      provider,
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
    });

    expect(() =>
      analytics.track("signup_completed", { plan: "enterprise", source: "ad" }),
    ).toThrow(EventValidationError);
    expect(track).not.toHaveBeenCalled();
  });

  it("propagates an exception thrown by onValidationError itself out of track()", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const handlerError = new Error("handler blew up");
    const onValidationError = mock<(error: EventValidationError) => void>(() => {
      throw handlerError;
    });

    const analytics = createAnalytics<SampleEvents>({
      provider,
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
      onValidationError,
    });

    expect(() =>
      analytics.track("signup_completed", { plan: "enterprise", source: "ad" }),
    ).toThrow(handlerError);
    expect(track).not.toHaveBeenCalled();
  });

  it("leaves successful validations entirely unaffected when onValidationError is configured", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const onValidationError = mock<(error: EventValidationError) => void>(() => {});

    const analytics = createAnalytics<SampleEvents>({
      provider,
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
      onValidationError,
    });

    analytics.track("signup_completed", { plan: "pro", source: "ad" });

    expect(onValidationError).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.properties).toEqual({ plan: "pro", source: "ad" });
  });
});
