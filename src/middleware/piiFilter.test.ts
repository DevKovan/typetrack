// Unit tests for `piiFilterMiddleware` (Phase 11 issue 007): isolated logic,
// no I/O -- constructs a `CanonicalEvent` by hand and calls `before()`
// directly, no `createAnalytics()`/provider involved. Mirrors
// `src/middleware/redact.test.ts`'s structure.
import { describe, expect, it } from "bun:test";
import { piiFilterMiddleware } from "./piiFilter";
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

describe("piiFilterMiddleware", () => {
  it("redacts every default-pattern-matching top-level key in properties with the default replacement", async () => {
    const middleware = piiFilterMiddleware();
    const event = makeEvent({
      properties: { email: "a@b.com", ssn: "123-45-6789", plan: "pro" },
    });

    const result = await middleware.before!(event);

    expect(result?.properties.email).toBe("[REDACTED]");
    expect(result?.properties.ssn).toBe("[REDACTED]");
    // unconfigured/non-matching field passes through unchanged
    expect(result?.properties.plan).toBe("pro");
  });

  it("redacts a nested object's matching key without disturbing sibling keys", async () => {
    const middleware = piiFilterMiddleware();
    const event = makeEvent({
      properties: { user: { email: "a@b.com", name: "Ada" }, other: "untouched" },
    });

    const result = await middleware.before!(event);

    const user = result!.properties.user as Record<string, unknown>;
    expect(user.email).toBe("[REDACTED]");
    expect(user.name).toBe("Ada");
    expect(result?.properties.other).toBe("untouched");
  });

  it("redacts matching keys within an array of objects, leaving non-matching sibling keys untouched", async () => {
    const middleware = piiFilterMiddleware();
    const event = makeEvent({
      properties: {
        attendees: [
          { email: "one@example.com", name: "Ada" },
          { email: "two@example.com", name: "Grace" },
        ],
      },
    });

    const result = await middleware.before!(event);

    const attendees = result!.properties.attendees as Record<string, unknown>[];
    expect(attendees[0]!.email).toBe("[REDACTED]");
    expect(attendees[0]!.name).toBe("Ada");
    expect(attendees[1]!.email).toBe("[REDACTED]");
    expect(attendees[1]!.name).toBe("Grace");
  });

  it("leaves non-plain-object array elements untouched", async () => {
    const middleware = piiFilterMiddleware();
    const event = makeEvent({
      properties: { tags: ["email", "ssn", 42, null] },
    });

    const result = await middleware.before!(event);

    expect(result?.properties.tags).toEqual(["email", "ssn", 42, null]);
  });

  it("matches default patterns case-insensitively as a substring of the key name", async () => {
    const middleware = piiFilterMiddleware();
    const event = makeEvent({
      properties: { userEmail: "a@b.com", EMAIL_ADDRESS: "b@c.com", contactEmail: "c@d.com" },
    });

    const result = await middleware.before!(event);

    expect(result?.properties.userEmail).toBe("[REDACTED]");
    expect(result?.properties.EMAIL_ADDRESS).toBe("[REDACTED]");
    expect(result?.properties.contactEmail).toBe("[REDACTED]");
  });

  it("extendDefaults: false with a custom patterns list redacts only the custom patterns", async () => {
    const middleware = piiFilterMiddleware({ extendDefaults: false, patterns: ["internalCode"] });
    const event = makeEvent({
      properties: { email: "a@b.com", internalCode: "XYZ" },
    });

    const result = await middleware.before!(event);

    // default pattern ("email") no longer applies
    expect(result?.properties.email).toBe("a@b.com");
    expect(result?.properties.internalCode).toBe("[REDACTED]");
  });

  it("extendDefaults: true (the default) merges custom patterns with the built-in defaults", async () => {
    const middleware = piiFilterMiddleware({ patterns: ["internalCode"] });
    const event = makeEvent({
      properties: { email: "a@b.com", internalCode: "XYZ" },
    });

    const result = await middleware.before!(event);

    expect(result?.properties.email).toBe("[REDACTED]");
    expect(result?.properties.internalCode).toBe("[REDACTED]");
  });

  it("a custom RegExp pattern is tested as-is against the key name, no implicit case-insensitivity", async () => {
    const middleware = piiFilterMiddleware({ extendDefaults: false, patterns: [/^internal_/] });
    const event = makeEvent({
      properties: { internal_id: "abc", INTERNAL_ID: "def", other: "untouched" },
    });

    const result = await middleware.before!(event);

    expect(result?.properties.internal_id).toBe("[REDACTED]");
    // no `i` flag on the regex -- does not match the differently-cased key
    expect(result?.properties.INTERNAL_ID).toBe("def");
    expect(result?.properties.other).toBe("untouched");
  });

  it("a custom RegExp pattern with an `i` flag does match case-insensitively", async () => {
    const middleware = piiFilterMiddleware({ extendDefaults: false, patterns: [/^internal_/i] });
    const event = makeEvent({
      properties: { INTERNAL_ID: "def" },
    });

    const result = await middleware.before!(event);

    expect(result?.properties.INTERNAL_ID).toBe("[REDACTED]");
  });

  it("supports a fixed custom replacement value", async () => {
    const middleware = piiFilterMiddleware({ replacement: "***" });
    const event = makeEvent({ properties: { email: "a@b.com" } });

    const result = await middleware.before!(event);

    expect(result?.properties.email).toBe("***");
  });

  it("replacement as a function receives the computed dotted fieldPath (including array indices) and the original value", async () => {
    const calls: { fieldPath: string; value: unknown }[] = [];
    const middleware = piiFilterMiddleware({
      replacement: (fieldPath: string, value: unknown) => {
        calls.push({ fieldPath, value });
        return "[X]";
      },
    });
    const event = makeEvent({
      properties: {
        email: "top@example.com",
        attendees: [{ email: "nested@example.com" }],
      },
    });

    await middleware.before!(event);

    expect(calls).toContainEqual({ fieldPath: "email", value: "top@example.com" });
    expect(calls).toContainEqual({ fieldPath: "attendees.0.email", value: "nested@example.com" });
  });

  it("targets defaults to properties only -- context/metadata pass through unchanged", async () => {
    const middleware = piiFilterMiddleware();
    const event = makeEvent({
      properties: { email: "a@b.com" },
      context: { email: "should-not-be-touched" },
      metadata: { email: "should-not-be-touched" },
    });

    const result = await middleware.before!(event);

    expect(result?.context?.email).toBe("should-not-be-touched");
    expect(result?.metadata?.email).toBe("should-not-be-touched");
  });

  it("redacts context/metadata when explicitly opted into via targets", async () => {
    const middleware = piiFilterMiddleware({ targets: ["properties", "context", "metadata"] });
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
    const middleware = piiFilterMiddleware();
    const original: CanonicalEvent = makeEvent({
      properties: {
        email: "a@b.com",
        user: { email: "nested@b.com", name: "Ada" },
        attendees: [{ email: "x@y.com" }],
      },
    });
    const clone = structuredClone(original);

    await middleware.before!(original);

    expect(original).toEqual(clone);
  });

  it("leaves sibling objects/arrays off any redacted path referentially unchanged", async () => {
    const middleware = piiFilterMiddleware();
    const untouchedSibling = { plan: "pro" };
    const event = makeEvent({
      properties: { email: "a@b.com", account: untouchedSibling },
    });

    const result = await middleware.before!(event);

    expect(result?.properties.account).toBe(untouchedSibling);
  });

  it("is a no-op (returns properties unchanged by reference) when nothing matches", async () => {
    const middleware = piiFilterMiddleware();
    const properties = { plan: "pro", seats: 5 };
    const event = makeEvent({ properties });

    const result = await middleware.before!(event);

    expect(result?.properties).toBe(properties);
  });

  it("has no `after`/`onError` hooks -- before() only", () => {
    const middleware = piiFilterMiddleware();

    expect(middleware.after).toBeUndefined();
    expect(middleware.onError).toBeUndefined();
    expect(middleware.name).toBe("piiFilter");
  });
});
