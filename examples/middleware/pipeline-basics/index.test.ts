import { describe, expect, test } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { orderValueGuardMiddleware } from "./index";

// Unit test for `orderValueGuardMiddleware`'s pure validation logic --
// exercised directly (calling `before()` on a hand-built `CanonicalEvent`,
// no `createAnalytics()`, no provider, no I/O), per the issue's "a unit test
// is required only if index.ts contains non-trivial pure logic" rule. This
// is the one piece of genuinely non-trivial pure logic this example's
// `index.ts` defines: everything else is direct `typetrack` API calls,
// provider-stub construction, or built-in middleware configuration, which
// belong in the integration test instead (see `index.integration.test.ts`'s
// own doc comment for the `multi-provider-routing`-style rationale).
function makeEvent(properties: Record<string, unknown>): CanonicalEvent {
  return {
    name: "Purchase Completed",
    properties,
    timestamp: Date.now(),
    anonymousId: "anon-test",
    sessionId: "session-test",
  };
}

describe("orderValueGuardMiddleware", () => {
  test("passes an event through unchanged when value is a non-negative finite number", () => {
    const guard = orderValueGuardMiddleware();
    const event = makeEvent({ value: 149.99, currency: "USD" });
    expect(guard.before!(event)).toBe(event);
  });

  test("passes an event through unchanged when value is 0", () => {
    const guard = orderValueGuardMiddleware();
    const event = makeEvent({ value: 0 });
    expect(guard.before!(event)).toBe(event);
  });

  test("passes an event through unchanged when value is absent entirely", () => {
    const guard = orderValueGuardMiddleware();
    const event = makeEvent({ cartValue: 89.5 });
    expect(guard.before!(event)).toBe(event);
  });

  test("throws when value is negative", () => {
    const guard = orderValueGuardMiddleware();
    const event = makeEvent({ value: -50 });
    expect(() => guard.before!(event)).toThrow(/invalid order value -50/);
  });

  test("throws when value is NaN", () => {
    const guard = orderValueGuardMiddleware();
    const event = makeEvent({ value: Number.NaN });
    expect(() => guard.before!(event)).toThrow(/invalid order value/);
  });

  test("throws when value is Infinity", () => {
    const guard = orderValueGuardMiddleware();
    const event = makeEvent({ value: Number.POSITIVE_INFINITY });
    expect(() => guard.before!(event)).toThrow(/invalid order value/);
  });

  test("throws when value is not a number at all", () => {
    const guard = orderValueGuardMiddleware();
    const event = makeEvent({ value: "149.99" });
    expect(() => guard.before!(event)).toThrow(/invalid order value/);
  });

  test("the thrown error message names the offending event", () => {
    const guard = orderValueGuardMiddleware();
    const event = makeEvent({ value: -1 });
    expect(() => guard.before!(event)).toThrow(/"Purchase Completed"/);
  });
});
