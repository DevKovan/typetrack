import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createAnalytics, EventValidationError } from "./index";
import type { AnalyticsProvider } from "./providers";
import type { EventMeta, InferEvents } from "./schema";

// A real (not mocked) Zod schema map spanning two schema-backed events, per
// the issue's integration test requirements.
const eventSchemas = {
  signup_completed: z.object({
    plan: z.enum(["free", "pro"]),
    email: z.string().min(1),
  }),
  page_viewed: z.object({
    path: z.string().min(1),
  }),
} satisfies Record<string, z.ZodType>;

type AppEvents = InferEvents<typeof eventSchemas>;

// A real, test-local `AnalyticsProvider` implementation (not a mock) that
// records every call it receives, standing in for a real vendor SDK
// adapter.
class RecordingProvider implements AnalyticsProvider {
  name = "recording";
  calls: Array<{ event: string; payload: Record<string, unknown>; meta: EventMeta }> = [];

  track(event: string, payload: Record<string, unknown>, meta: EventMeta) {
    this.calls.push({ event, payload, meta });
  }
}

describe("createAnalytics<Events>({ schemas, onValidationError }) integration", () => {
  it("routes invalid payloads to onValidationError and valid payloads to a real provider, across a mixed sequence, without ever throwing", () => {
    const provider = new RecordingProvider();
    const capturedErrors: EventValidationError[] = [];

    const analytics = createAnalytics<AppEvents>({
      provider,
      schemas: eventSchemas,
      onValidationError: (error) => {
        capturedErrors.push(error);
      },
    });

    // A mix of valid and invalid payloads across both schema-backed events.
    // Every call below must complete without throwing.
    expect(() => {
      analytics.track("signup_completed", { plan: "pro", email: "user@example.com" }); // valid
      analytics.track("page_viewed", { path: "" }); // invalid: fails .min(1)
      analytics.track(
        "signup_completed",
        // `plan` fails the enum refinement.
        { plan: "enterprise", email: "a@b.co" } as unknown as AppEvents["signup_completed"],
      ); // invalid
      analytics.track("page_viewed", { path: "/pricing" }); // valid
      analytics.track(
        "signup_completed",
        // `email` missing entirely.
        { plan: "free" } as AppEvents["signup_completed"],
      ); // invalid
    }).not.toThrow();

    // Only the valid calls reached the provider, in order.
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]!.event).toBe("signup_completed");
    expect(provider.calls[0]!.payload).toEqual({ plan: "pro", email: "user@example.com" });
    expect(provider.calls[1]!.event).toBe("page_viewed");
    expect(provider.calls[1]!.payload).toEqual({ path: "/pricing" });

    // All invalid calls were captured via onValidationError, in order, with
    // the correct event names.
    expect(capturedErrors).toHaveLength(3);
    expect(capturedErrors.every((error) => error instanceof EventValidationError)).toBe(true);
    expect(capturedErrors.map((error) => error.event)).toEqual([
      "page_viewed",
      "signup_completed",
      "signup_completed",
    ]);
  });
});
