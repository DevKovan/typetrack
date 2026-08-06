import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { createAnalytics, EventValidationError } from "./index";
import type { AnalyticsProvider } from "./providers";
import type { CanonicalEvent, InferEvents } from "./schema";
import { allCapabilities } from "./test-support";

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
  capabilities = allCapabilities;
  calls: CanonicalEvent[] = [];

  track(event: CanonicalEvent) {
    this.calls.push(event);
  }
}

describe("createAnalytics<Events>({ schemas }) integration", () => {
  it("delivers a valid, validated/parsed payload to a real provider for a schema-backed event", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider, schemas: eventSchemas });

    await analytics.track("signup_completed", { plan: "pro", email: "user@example.com" });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.name).toBe("signup_completed");
    expect(provider.calls[0]!.properties).toEqual({ plan: "pro", email: "user@example.com" });
    expect(provider.calls[0]!.timestamp).toBeGreaterThan(0);
  });

  it("throws EventValidationError and never calls the provider for a payload missing a required field", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "spy", capabilities: allCapabilities, track };
    const analytics = createAnalytics<AppEvents>({ provider, schemas: eventSchemas });

    expect(() =>
      // `email` is missing entirely.
      analytics.track("signup_completed", { plan: "pro" } as AppEvents["signup_completed"]),
    ).toThrow(EventValidationError);

    expect(track).not.toHaveBeenCalled();
  });

  it("throws EventValidationError and never calls the provider for a payload failing a Zod refinement", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "spy", capabilities: allCapabilities, track };
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

    expect(provider.calls[0]!.name).toBe("page_viewed");
    expect(provider.calls[0]!.properties).toEqual({ path: "/home" });

    expect(provider.calls[1]!.name).toBe("signup_completed");
    expect(provider.calls[1]!.properties).toEqual({ plan: "free", email: "a@b.co" });
  });

  // Phase 15 issue 003: `validate: false` through a real multi-provider
  // `createAnalytics()` setup -- an invalid payload (missing `email`, empty
  // `plan`) is forwarded unvalidated to every configured provider, no
  // `EventValidationError` thrown.
  it("with validate: false, forwards an invalid payload unvalidated to every provider in a multi-provider fan-out", async () => {
    const providerA = new RecordingProvider();
    providerA.name = "a";
    const providerB = new RecordingProvider();
    providerB.name = "b";

    const analytics = createAnalytics<AppEvents>({
      provider: [providerA, providerB],
      schemas: eventSchemas,
      validate: false,
    });

    // `email` is missing entirely -- would fail `eventSchemas.signup_completed`
    // if validation ran, but `validate: false` skips it, so this is forwarded
    // unvalidated exactly as given.
    await analytics.track("signup_completed", { plan: "pro" } as AppEvents["signup_completed"]);

    expect(providerA.calls).toHaveLength(1);
    expect(providerA.calls[0]!.properties).toEqual({ plan: "pro" });
    expect(providerB.calls).toHaveLength(1);
    expect(providerB.calls[0]!.properties).toEqual({ plan: "pro" });
  });
});
