// Unit tests for `versionMiddleware` (Phase 8 issue 005): isolated logic, no
// I/O -- constructs a `CanonicalEvent` by hand and calls `before()` directly.
import { describe, expect, it } from "bun:test";
import { versionMiddleware } from "./version";
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

describe("versionMiddleware", () => {
  it("injects appVersion/buildId into event.metadata", () => {
    const middleware = versionMiddleware({ appVersion: "1.2.3", buildId: "abc123" });
    const event = makeEvent();

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.metadata).toEqual({ appVersion: "1.2.3", buildId: "abc123" });
  });

  it("does not touch properties/context", () => {
    const middleware = versionMiddleware({ appVersion: "1.2.3" });
    const event = makeEvent({ properties: { plan: "free" }, context: { ip: "1.2.3.4" } });

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.properties).toEqual({ plan: "free" });
    expect(result.context).toEqual({ ip: "1.2.3.4" });
  });

  it("survives alongside existing metadata keys set by the app (TrackOptions.metadata)", () => {
    const middleware = versionMiddleware({ appVersion: "1.2.3", buildId: "abc123" });
    const event = makeEvent({ metadata: { experiment: "checkout-v2" } });

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.metadata).toEqual({
      experiment: "checkout-v2",
      appVersion: "1.2.3",
      buildId: "abc123",
    });
  });

  it("survives alongside existing metadata keys set by an earlier-registered middleware", () => {
    // Simulate an earlier middleware having already injected its own
    // metadata key before versionMiddleware runs.
    const middleware = versionMiddleware({ appVersion: "1.2.3" });
    const eventAfterEarlierMiddleware = makeEvent({ metadata: { requestId: "req-1" } });

    const result = middleware.before!(eventAfterEarlierMiddleware) as CanonicalEvent;

    expect(result.metadata).toEqual({ requestId: "req-1", appVersion: "1.2.3" });
  });

  it("supports appVersion only (buildId omitted)", () => {
    const middleware = versionMiddleware({ appVersion: "1.2.3" });
    const event = makeEvent();

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.metadata).toEqual({ appVersion: "1.2.3" });
  });

  it("supports buildId only (appVersion omitted)", () => {
    const middleware = versionMiddleware({ buildId: "abc123" });
    const event = makeEvent();

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.metadata).toEqual({ buildId: "abc123" });
  });

  it("with no metadata at all when both options are omitted, metadata stays an empty object", () => {
    const middleware = versionMiddleware({});
    const event = makeEvent();

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.metadata).toEqual({});
  });

  it("has no `after`/`onError` hooks -- before() only", () => {
    const middleware = versionMiddleware({ appVersion: "1.2.3" });

    expect(middleware.after).toBeUndefined();
    expect(middleware.onError).toBeUndefined();
    expect(middleware.name).toBe("version");
  });
});
