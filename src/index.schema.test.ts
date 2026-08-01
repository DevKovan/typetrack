import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { createAnalytics, EventValidationError } from "./index";
import type { AnalyticsProvider } from "./providers";

type SampleEvents = {
  signup_completed: { plan: string; source: string };
  page_viewed: { path: string };
};

describe("createAnalytics() runtime Zod validation", () => {
  it("forwards the *parsed* payload (not the raw input) for a schema-backed event, honoring .transform()/.default()", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", track };

    const analytics = createAnalytics<SampleEvents>({
      provider,
      schemas: {
        signup_completed: z.object({
          // `.transform()` uppercases the raw input.
          plan: z.string().transform((plan) => plan.toUpperCase()),
          // `.default()` fills this in when the raw input omits it.
          source: z.string().default("unknown"),
        }),
      },
    });

    // Raw payload only sets `plan`; `source` is deliberately omitted so the
    // schema's `.default()` must supply it in the forwarded payload.
    analytics.track("signup_completed", { plan: "pro" } as SampleEvents["signup_completed"]);

    expect(track).toHaveBeenCalledTimes(1);
    const [, payload] = track.mock.calls[0]!;
    // Proves parsed-not-raw: the raw input was `{ plan: "pro" }`, but the
    // forwarded payload reflects the schema's transform + default.
    expect(payload).toEqual({ plan: "PRO", source: "unknown" });
  });

  it("passes an event without a schemas entry through unvalidated, raw payload forwarded byte-for-byte", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", track };

    const analytics = createAnalytics<SampleEvents>({
      provider,
      // Only `signup_completed` has a schema; `page_viewed` does not, even
      // though `page_viewed`'s payload shape has no `plan` field and would
      // not satisfy `signup_completed`'s schema if it were (incorrectly)
      // applied to it.
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
    });

    analytics.track("page_viewed", { path: "/pricing" });

    expect(track).toHaveBeenCalledTimes(1);
    const [, payload] = track.mock.calls[0]!;
    expect(payload).toEqual({ path: "/pricing" });
  });

  it("throws EventValidationError carrying the event name and the underlying Zod issues on invalid payloads", () => {
    const provider: AnalyticsProvider = { name: "test", track: () => {} };

    const analytics = createAnalytics<SampleEvents>({
      provider,
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
    });

    let caught: unknown;
    try {
      // `plan` compiles fine (declared as `string`) but fails the schema's
      // `z.enum(["free", "pro"])` refinement at runtime.
      analytics.track("signup_completed", { plan: "enterprise", source: "ad" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(EventValidationError);
    const error = caught as EventValidationError;
    expect(error.event).toBe("signup_completed");
    expect(error.payload).toEqual({ plan: "enterprise", source: "ad" });
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues[0]?.path).toEqual(["plan"]);
  });

  it("does not call the provider when validation fails", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", track };

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
});
