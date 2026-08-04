// Integration test for `piiFilterMiddleware` (Phase 11 issue 007):
// constructs a real `createAnalytics({ provider: ... })` with a
// hand-written `AnalyticsProvider` stub (recording received events, no
// mocks), registers `piiFilterMiddleware` via a real `.use()` call, and
// drives a realistic nested PII payload through the full pipeline --
// asserting on what the *provider actually received*, not on the
// middleware's `before()` return value directly. Mirrors
// `src/middleware/redact.integration.test.ts`'s structure.
import { describe, expect, it } from "bun:test";
import { createAnalytics } from "../index";
import { piiFilterMiddleware } from "./piiFilter";
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
  };
  return { provider, events };
}

describe("piiFilterMiddleware integration", () => {
  it("redacts a realistic nested PII payload before it reaches the provider", async () => {
    const stub = makeRecordingProvider("stub");
    const analytics = createAnalytics({ provider: stub.provider });
    analytics.use(piiFilterMiddleware());

    await analytics.track("signup_completed", {
      email: "ada@example.com",
      plan: "pro",
      user: { ssn: "123-45-6789", name: "Ada Lovelace" },
      attendees: [
        { email: "guest1@example.com", name: "Guest One" },
        { email: "guest2@example.com", name: "Guest Two" },
      ],
    });

    expect(stub.events).toHaveLength(1);
    const event = stub.events[0]!;
    expect(event.properties.email).toBe("[REDACTED]");
    expect(event.properties.plan).toBe("pro");

    const user = event.properties.user as Record<string, unknown>;
    expect(user.ssn).toBe("[REDACTED]");
    expect(user.name).toBe("Ada Lovelace");

    const attendees = event.properties.attendees as Record<string, unknown>[];
    expect(attendees[0]!.email).toBe("[REDACTED]");
    expect(attendees[0]!.name).toBe("Guest One");
    expect(attendees[1]!.email).toBe("[REDACTED]");
    expect(attendees[1]!.name).toBe("Guest Two");
  });

  it("composes alongside redactMiddleware in a registration-order-dependent chain", async () => {
    const stub = makeRecordingProvider("compose-stub");
    const analytics = createAnalytics({ provider: stub.provider });
    // redactMiddleware handles an exact top-level path; piiFilterMiddleware
    // catches the rest via key-name pattern matching, including array
    // elements redactMiddleware's exact-path model can't reach.
    analytics.use(redactMiddleware({ fields: ["accountNumber"] }));
    analytics.use(piiFilterMiddleware());

    await analytics.track("order_placed", {
      accountNumber: "ACC-001",
      lineItems: [{ email: "buyer1@example.com" }, { email: "buyer2@example.com" }],
      plan: "pro",
    });

    expect(stub.events).toHaveLength(1);
    const event = stub.events[0]!;
    expect(event.properties.accountNumber).toBe("[REDACTED]");
    const lineItems = event.properties.lineItems as Record<string, unknown>[];
    expect(lineItems[0]!.email).toBe("[REDACTED]");
    expect(lineItems[1]!.email).toBe("[REDACTED]");
    expect(event.properties.plan).toBe("pro");
  });
});
