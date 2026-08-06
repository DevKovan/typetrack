import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { createAnalytics, EventValidationError } from "./index";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities } from "./test-support";

type SampleEvents = {
  signup_completed: { plan: string; source: string };
  page_viewed: { path: string };
};

describe("createAnalytics({ validate }) unit tests", () => {
  it("validate omitted (default true): a failing schema still throws EventValidationError, byte-for-byte pre-Phase-15 behavior", () => {
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

  it("validate: true explicit: a failing schema still throws EventValidationError", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };

    const analytics = createAnalytics<SampleEvents>({
      provider,
      validate: true,
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
    });

    expect(() =>
      analytics.track("signup_completed", { plan: "enterprise", source: "ad" }),
    ).toThrow(EventValidationError);
    expect(track).not.toHaveBeenCalled();
  });

  it("validate: false with a schema configured: forwards a payload that would fail validation to the provider unvalidated, no throw", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };

    const analytics = createAnalytics<SampleEvents>({
      provider,
      validate: false,
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
    });

    expect(() =>
      analytics.track("signup_completed", { plan: "enterprise", source: "ad" }),
    ).not.toThrow();

    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    // Raw payload forwarded exactly as-is -- no schema.safeParse() applied,
    // so the invalid `plan` value passes through untouched.
    expect(canonicalEvent.properties).toEqual({ plan: "enterprise", source: "ad" });
  });

  it("validate: false with onValidationError configured: the handler is never invoked, even on a payload that would otherwise fail validation", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };
    const onValidationError = mock<(error: EventValidationError) => void>(() => {});

    const analytics = createAnalytics<SampleEvents>({
      provider,
      validate: false,
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
      onValidationError,
    });

    analytics.track("signup_completed", { plan: "enterprise", source: "ad" });

    expect(onValidationError).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(1);
  });
});
