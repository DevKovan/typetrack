// Integration test for `redactMiddleware` (Phase 8 issue 004): constructs a
// real `createAnalytics({ provider: [...] })` with hand-written
// `AnalyticsProvider` stubs (recording received events, no mocks), registers
// `redactMiddleware` via a real `.use()` call, and drives realistic
// PII-shaped `track()`/`page()` payloads through the full pipeline --
// asserting on what the *providers actually received*, not on the
// middleware's `before()` return value directly.
import { afterEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "../index";
import { redactMiddleware } from "./redact";
import type { AnalyticsProvider } from "../providers";
import type { CanonicalEvent } from "../schema";
import { allCapabilities } from "../test-support";

function makeRecordingProvider(name: string): { provider: AnalyticsProvider; events: CanonicalEvent[] } {
  const events: CanonicalEvent[] = [];
  const provider: AnalyticsProvider = {
    name,
    capabilities: allCapabilities,
    track(event) {
      events.push(event);
    },
    page(event) {
      events.push(event);
    },
  };
  return { provider, events };
}

const originalConsoleWarn = console.warn;
afterEach(() => {
  console.warn = originalConsoleWarn;
});

describe("redactMiddleware integration", () => {
  it("redacts PII fields before they reach every provider in a multi-provider fan-out", async () => {
    console.warn = () => {};

    const segment = makeRecordingProvider("segment");
    const posthog = makeRecordingProvider("posthog");

    const analytics = createAnalytics({ provider: [segment.provider, posthog.provider] });
    analytics.use(redactMiddleware({ fields: ["email", "phone", "creditCard"] }));

    await analytics.track("signup_completed", {
      email: "ada@example.com",
      phone: "555-0100",
      creditCard: "4111111111111111",
      plan: "pro",
    });

    for (const { events } of [segment, posthog]) {
      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event!.properties.email).toBe("[REDACTED]");
      expect(event!.properties.phone).toBe("[REDACTED]");
      expect(event!.properties.creditCard).toBe("[REDACTED]");
      // Unconfigured field passes through unchanged, to the real provider.
      expect(event!.properties.plan).toBe("pro");
    }
  });

  it("applies a custom replacement function through the real pipeline, on a single-provider (non-array) fast path", async () => {
    const stub = makeRecordingProvider("single-stub");
    const analytics = createAnalytics({ provider: stub.provider });
    analytics.use(
      redactMiddleware({
        fields: ["ssn"],
        replacement: (fieldPath: string) => `redacted:${fieldPath}`,
      }),
    );

    await analytics.track("profile_updated", { ssn: "123-45-6789", name: "Grace" });

    expect(stub.events).toHaveLength(1);
    expect(stub.events[0]!.properties.ssn).toBe("redacted:ssn");
    expect(stub.events[0]!.properties.name).toBe("Grace");
  });

  it("does not throw and delivers the event normally when the configured field is absent from a real payload", async () => {
    const stub = makeRecordingProvider("no-field-stub");
    const analytics = createAnalytics({ provider: stub.provider });
    analytics.use(redactMiddleware({ fields: ["email"] }));

    await expect(analytics.track("page_viewed", { path: "/pricing" })).resolves.toBeUndefined();

    expect(stub.events).toHaveLength(1);
    expect(stub.events[0]!.properties).toEqual({ path: "/pricing" });
  });

  it("redacts a nested dotted-path PII field via page() as well as track()", async () => {
    const stub = makeRecordingProvider("page-stub");
    const analytics = createAnalytics({ provider: stub.provider });
    analytics.use(redactMiddleware({ fields: ["user.ssn"] }));

    await analytics.page("checkout", { user: { ssn: "987-65-4321", name: "Ada" } });

    expect(stub.events).toHaveLength(1);
    const user = stub.events[0]!.properties.user as Record<string, unknown>;
    expect(user.ssn).toBe("[REDACTED]");
    expect(user.name).toBe("Ada");
  });
});
