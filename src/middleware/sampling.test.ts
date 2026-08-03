// Unit tests for `samplingMiddleware` (Phase 8 issue 004): isolated logic, no
// I/O -- constructs a `CanonicalEvent` by hand and calls `before()` directly.
import { describe, expect, it } from "bun:test";
import { samplingMiddleware } from "./sampling";
import { isSampledIn } from "../routing";
import type { CanonicalEvent } from "../schema";

function makeEvent(anonymousId: string): CanonicalEvent {
  return {
    name: "test_event",
    properties: {},
    timestamp: 0,
    anonymousId,
    sessionId: "session-1",
  };
}

describe("samplingMiddleware", () => {
  it("rate: 0 always drops -- across ~50 distinct anonymousIds", () => {
    const middleware = samplingMiddleware({ rate: 0 });

    for (let i = 0; i < 50; i++) {
      const event = makeEvent(`anon-${i}`);
      expect(middleware.before!(event)).toBeUndefined();
    }
  });

  it("rate: 1 always keeps -- across ~50 distinct anonymousIds", () => {
    const middleware = samplingMiddleware({ rate: 1 });

    for (let i = 0; i < 50; i++) {
      const event = makeEvent(`anon-${i}`);
      expect(middleware.before!(event)).toBe(event);
    }
  });

  it("is deterministic: same (anonymousId, rate) produces the same decision across repeated calls", () => {
    const middleware = samplingMiddleware({ rate: 0.5 });
    const event = makeEvent("stable-anon-id");

    const first = middleware.before!(event);
    const second = middleware.before!(event);
    const third = middleware.before!(event);

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("cross-consistency: matches `isSampledIn` called directly for the same (anonymousId, rate)", () => {
    const rate = 0.3;
    const middleware = samplingMiddleware({ rate });

    for (let i = 0; i < 50; i++) {
      const anonymousId = `cross-check-${i}`;
      const event = makeEvent(anonymousId);
      const expectedKept = isSampledIn(anonymousId, rate);

      const result = middleware.before!(event);

      if (expectedKept) {
        expect(result).toBe(event);
      } else {
        expect(result).toBeUndefined();
      }
    }
  });

  it("passes the event through unchanged (no transformation) when kept", () => {
    const middleware = samplingMiddleware({ rate: 1 });
    const event = makeEvent("anon-passthrough");

    const result = middleware.before!(event);

    expect(result).toEqual(event);
  });

  it("has no `after`/`onError` hooks -- before() only", () => {
    const middleware = samplingMiddleware({ rate: 0.5 });

    expect(middleware.after).toBeUndefined();
    expect(middleware.onError).toBeUndefined();
    expect(middleware.name).toBe("sampling");
  });
});
