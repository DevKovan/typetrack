import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { createAnalytics, EventValidationError } from "./index";
import type { AnalyticsProvider } from "./providers";
import type { EventMeta, InferEvents } from "./schema";

// A real (not mocked) Zod schema map: an object with a required enum field
// and a `.min(1)` refinement, per the issue's integration test requirements.
const eventSchemas = {
  signup_completed: z.object({
    plan: z.enum(["free", "pro"]),
    email: z.string().min(1),
  }),
} satisfies Record<string, z.ZodType>;

// Mixed `Events` map: `signup_completed` is schema-backed (derived via
// `InferEvents`, single source of truth); `page_viewed` is not.
type AppEvents = InferEvents<typeof eventSchemas> & {
  page_viewed: { path: string };
};

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

describe("createAnalytics<Events>({ schemas }) integration", () => {
  it("delivers a valid, validated/parsed payload to a real provider for a schema-backed event", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider, schemas: eventSchemas });

    await analytics.track("signup_completed", { plan: "pro", email: "user@example.com" });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.event).toBe("signup_completed");
    expect(provider.calls[0]!.payload).toEqual({ plan: "pro", email: "user@example.com" });
    expect(provider.calls[0]!.meta.timestamp).toBeGreaterThan(0);
  });

  it("throws EventValidationError and never calls the provider for a payload missing a required field", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "spy", track };
    const analytics = createAnalytics<AppEvents>({ provider, schemas: eventSchemas });

    expect(() =>
      // `email` is missing entirely.
      analytics.track("signup_completed", { plan: "pro" } as AppEvents["signup_completed"]),
    ).toThrow(EventValidationError);

    expect(track).not.toHaveBeenCalled();
  });

  it("throws EventValidationError and never calls the provider for a payload failing a Zod refinement", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "spy", track };
    const analytics = createAnalytics<AppEvents>({ provider, schemas: eventSchemas });

    let caught: unknown;
    try {
      // `email` fails `.min(1)`.
      analytics.track("signup_completed", { plan: "pro", email: "" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as EventValidationError).event).toBe("signup_completed");
    expect(track).not.toHaveBeenCalled();
  });

  it("in a mixed Events map, only validates the schema-backed event and forwards the other unvalidated", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider, schemas: eventSchemas });

    await analytics.track("page_viewed", { path: "/home" });
    await analytics.track("signup_completed", { plan: "free", email: "a@b.co" });

    expect(provider.calls).toHaveLength(2);

    expect(provider.calls[0]!.event).toBe("page_viewed");
    expect(provider.calls[0]!.payload).toEqual({ path: "/home" });

    expect(provider.calls[1]!.event).toBe("signup_completed");
    expect(provider.calls[1]!.payload).toEqual({ plan: "free", email: "a@b.co" });
  });
});
