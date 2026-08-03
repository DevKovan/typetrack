// Unit tests for `enrichmentMiddleware` (Phase 8 issue 005): isolated logic,
// no I/O -- constructs a `CanonicalEvent` by hand and calls `before()`
// directly.
import { describe, expect, it } from "bun:test";
import { enrichmentMiddleware } from "./enrichment";
import type { CanonicalEvent } from "../schema";

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "test_event",
    properties: { plan: "free" },
    timestamp: 0,
    anonymousId: "anon-1",
    sessionId: "session-1",
    ...overrides,
  };
}

describe("enrichmentMiddleware", () => {
  it("static merge: adds configured properties keys to the event", () => {
    const middleware = enrichmentMiddleware({ properties: { environment: "production" } });
    const event = makeEvent();

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.properties).toEqual({ plan: "free", environment: "production" });
  });

  it("static merge: adds configured context keys to the event", () => {
    const middleware = enrichmentMiddleware({ context: { locale: "en-US" } });
    const event = makeEvent({ context: { ip: "1.2.3.4" } });

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.context).toEqual({ ip: "1.2.3.4", locale: "en-US" });
  });

  it("function-form merge: the function receives the actual event being processed", () => {
    let receivedEvent: CanonicalEvent | undefined;
    const middleware = enrichmentMiddleware({
      properties: (event) => {
        receivedEvent = event;
        return { echoedName: event.name };
      },
    });
    const event = makeEvent({ name: "signup_completed" });

    const result = middleware.before!(event) as CanonicalEvent;

    expect(receivedEvent).toBe(event);
    expect(result.properties).toEqual({ plan: "free", echoedName: "signup_completed" });
  });

  it("function-form merge works for context too, computed per-event", () => {
    const middleware = enrichmentMiddleware({
      context: (event) => ({ derivedFrom: event.anonymousId }),
    });
    const event = makeEvent({ anonymousId: "anon-42" });

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.context).toEqual({ derivedFrom: "anon-42" });
  });

  it("documented precedence: enrichment overrides a pre-existing conflicting properties key", () => {
    const middleware = enrichmentMiddleware({ properties: { plan: "enterprise" } });
    const event = makeEvent({ properties: { plan: "free", other: "keep" } });

    const result = middleware.before!(event) as CanonicalEvent;

    // Enrichment's value wins over the event's pre-existing value for the
    // colliding key; non-colliding keys are preserved.
    expect(result.properties).toEqual({ plan: "enterprise", other: "keep" });
  });

  it("documented precedence: enrichment overrides a pre-existing conflicting context key", () => {
    const middleware = enrichmentMiddleware({ context: { region: "us-east" } });
    const event = makeEvent({ context: { region: "eu-west", ip: "1.2.3.4" } });

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.context).toEqual({ region: "us-east", ip: "1.2.3.4" });
  });

  it("leaves properties/context untouched when the corresponding option is omitted", () => {
    const middleware = enrichmentMiddleware({ properties: { environment: "production" } });
    const event = makeEvent({ context: { ip: "1.2.3.4" } });

    const result = middleware.before!(event) as CanonicalEvent;

    expect(result.context).toEqual({ ip: "1.2.3.4" });
  });

  it("has no `after`/`onError` hooks -- before() only", () => {
    const middleware = enrichmentMiddleware({ properties: { environment: "production" } });

    expect(middleware.after).toBeUndefined();
    expect(middleware.onError).toBeUndefined();
    expect(middleware.name).toBe("enrichment");
  });
});
