// Unit tests for `redactMiddleware` (Phase 8 issue 004): isolated logic, no
// I/O -- constructs a `CanonicalEvent` by hand and calls `before()` directly,
// no `createAnalytics()`/provider involved.
import { describe, expect, it } from "bun:test";
import { redactMiddleware } from "./redact";
import type { CanonicalEvent } from "../schema";

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "test_event",
    properties: {},
    timestamp: 0,
    anonymousId: "anon-1",
    sessionId: "session-1",
    ...overrides,
  };
}

describe("redactMiddleware", () => {
  it("replaces a configured top-level field with the default replacement", async () => {
    const middleware = redactMiddleware({ fields: ["email"] });
    const event = makeEvent({ properties: { email: "a@b.com", plan: "pro" } });

    const result = await middleware.before!(event);

    expect(result?.properties.email).toBe("[REDACTED]");
    // unconfigured field passes through unchanged
    expect(result?.properties.plan).toBe("pro");
  });

  it("supports a fixed custom replacement value", async () => {
    const middleware = redactMiddleware({ fields: ["email"], replacement: "***" });
    const event = makeEvent({ properties: { email: "a@b.com" } });

    const result = await middleware.before!(event);

    expect(result?.properties.email).toBe("***");
  });

  it("supports a replacement function keyed on field path and original value", async () => {
    const middleware = redactMiddleware({
      fields: ["email", "phone"],
      replacement: (fieldPath: string, value: unknown) => `${fieldPath}:${String(value).length}`,
    });
    const event = makeEvent({ properties: { email: "a@b.com", phone: "12345" } });

    const result = await middleware.before!(event);

    expect(result?.properties.email).toBe("email:7");
    expect(result?.properties.phone).toBe("phone:5");
  });

  it("does not throw and is a no-op when a configured field path is missing", async () => {
    const middleware = redactMiddleware({ fields: ["ssn", "email"] });
    const event = makeEvent({ properties: { email: "a@b.com" } });

    let result: CanonicalEvent | null | undefined;
    expect(() => {
      result = middleware.before!(event) as CanonicalEvent;
    }).not.toThrow();

    expect(result?.properties.email).toBe("[REDACTED]");
    expect("ssn" in (result?.properties ?? {})).toBe(false);
  });

  it("redacts a nested dotted-path field without disturbing sibling keys", async () => {
    const middleware = redactMiddleware({ fields: ["user.ssn"] });
    const event = makeEvent({
      properties: { user: { ssn: "123-45-6789", name: "Ada" }, other: "untouched" },
    });

    const result = await middleware.before!(event);

    expect((result!.properties.user as Record<string, unknown>).ssn).toBe("[REDACTED]");
    expect((result!.properties.user as Record<string, unknown>).name).toBe("Ada");
    expect(result?.properties.other).toBe("untouched");
  });

  it("is a no-op when an intermediate segment of a dotted path is missing", async () => {
    const middleware = redactMiddleware({ fields: ["user.ssn"] });
    const event = makeEvent({ properties: { plan: "pro" } });

    const result = await middleware.before!(event);

    expect(result?.properties).toEqual({ plan: "pro" });
  });

  it("only touches `properties` by default -- context/metadata pass through unchanged", async () => {
    const middleware = redactMiddleware({ fields: ["email"] });
    const event = makeEvent({
      properties: { email: "a@b.com" },
      context: { email: "should-not-be-touched" },
      metadata: { email: "should-not-be-touched" },
    });

    const result = await middleware.before!(event);

    expect(result?.context?.email).toBe("should-not-be-touched");
    expect(result?.metadata?.email).toBe("should-not-be-touched");
  });

  it("redacts context/metadata when explicitly opted into via `targets`", async () => {
    const middleware = redactMiddleware({
      fields: ["email"],
      targets: ["properties", "context", "metadata"],
    });
    const event = makeEvent({
      properties: { email: "a@b.com" },
      context: { email: "ctx@b.com" },
      metadata: { email: "meta@b.com" },
    });

    const result = await middleware.before!(event);

    expect(result?.properties.email).toBe("[REDACTED]");
    expect(result?.context?.email).toBe("[REDACTED]");
    expect(result?.metadata?.email).toBe("[REDACTED]");
  });

  it("does not mutate the original event object", async () => {
    const middleware = redactMiddleware({ fields: ["email"] });
    const event = makeEvent({ properties: { email: "a@b.com" } });

    await middleware.before!(event);

    expect(event.properties.email).toBe("a@b.com");
  });

  it("has no `after`/`onError` hooks -- before() only", () => {
    const middleware = redactMiddleware({ fields: ["email"] });

    expect(middleware.after).toBeUndefined();
    expect(middleware.onError).toBeUndefined();
    expect(middleware.name).toBe("redact");
  });
});
