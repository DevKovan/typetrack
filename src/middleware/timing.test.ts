// Unit tests for `timingMiddleware` (Phase 8 issue 005): isolated logic, no
// I/O -- constructs `CanonicalEvent`s by hand and calls the hooks directly,
// using an injected `now()` for fully deterministic durations.
import { describe, expect, it } from "bun:test";
import { timingMiddleware } from "./timing";
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

describe("timingMiddleware", () => {
  it("injected now() controls the reported duration exactly: 1000 at before, 1250 at after -> durationMs 250", () => {
    const clockValues = [1000, 1250];
    let callIndex = 0;
    const now = () => clockValues[callIndex++]!;

    const timings: { event: CanonicalEvent; durationMs: number }[] = [];
    const middleware = timingMiddleware({
      now,
      onTiming: (event, durationMs) => {
        timings.push({ event, durationMs });
      },
    });
    const event = makeEvent();

    middleware.before!(event);
    middleware.after!(event);

    expect(timings).toHaveLength(1);
    expect(timings[0]!.durationMs).toBe(250);
    expect(timings[0]!.event).toBe(event);
  });

  it("before() returns the event unchanged", () => {
    const middleware = timingMiddleware({ onTiming: () => {}, now: () => 0 });
    const event = makeEvent();

    const result = middleware.before!(event);

    expect(result).toBe(event);
  });

  it("defaults `now` to Date.now when not supplied (duration is a non-negative number)", () => {
    let reportedDuration: number | undefined;
    const middleware = timingMiddleware({
      onTiming: (_event, durationMs) => {
        reportedDuration = durationMs;
      },
    });
    const event = makeEvent();

    middleware.before!(event);
    middleware.after!(event);

    expect(typeof reportedDuration).toBe("number");
    expect(reportedDuration!).toBeGreaterThanOrEqual(0);
  });

  it("two concurrent/interleaved events each get their own correctly-paired duration, not cross-contaminated", () => {
    // Simulates interleaving: before(A) -> before(B) -> after(B) -> after(A),
    // i.e. B's whole lifecycle nests inside A's -- the opposite of FIFO
    // ordering -- which would break a naive single "last start time"
    // variable implementation (it would report B's start for A's `after`).
    const clockValues = [
      1000, // before(eventA)
      1100, // before(eventB)
      1150, // after(eventB)
      1300, // after(eventA)
    ];
    let callIndex = 0;
    const now = () => clockValues[callIndex++]!;

    const timings: { name: string; durationMs: number }[] = [];
    const middleware = timingMiddleware({
      now,
      onTiming: (event, durationMs) => {
        timings.push({ name: event.name, durationMs });
      },
    });

    const eventA = makeEvent({ name: "event_a" });
    const eventB = makeEvent({ name: "event_b" });

    middleware.before!(eventA);
    middleware.before!(eventB);
    middleware.after!(eventB);
    middleware.after!(eventA);

    expect(timings).toHaveLength(2);
    const byName = new Map(timings.map((t) => [t.name, t.durationMs]));
    // eventB: 1150 - 1100 = 50
    expect(byName.get("event_b")).toBe(50);
    // eventA: 1300 - 1000 = 300 -- NOT contaminated by eventB's start (1100)
    // or eventB's duration (50).
    expect(byName.get("event_a")).toBe(300);
  });

  it("interleaved async before/after pairs (real Promise scheduling) still pair correctly per event", async () => {
    const timings: { name: string; durationMs: number }[] = [];
    const middleware = timingMiddleware({
      onTiming: (event, durationMs) => {
        timings.push({ name: event.name, durationMs });
      },
    });

    // Drives the real default clock, but controls ordering via real
    // `setTimeout` delays to exercise genuine interleaving (event_b's
    // before/after both happen nested inside event_a's still-open
    // lifecycle), asserting only on relative ordering/pairing correctness
    // (not exact ms), since real timers are involved.
    async function runLifecycle(name: string, delayMs: number): Promise<void> {
      const event = makeEvent({ name });
      middleware.before!(event);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      middleware.after!(event);
    }

    await Promise.all([runLifecycle("event_a", 30), runLifecycle("event_b", 5)]);

    expect(timings).toHaveLength(2);
    const byName = new Map(timings.map((t) => [t.name, t.durationMs]));
    expect(byName.get("event_a")).toBeDefined();
    expect(byName.get("event_b")).toBeDefined();
    // event_b's shorter delay should produce a smaller measured duration
    // than event_a's, confirming each event measured its own interval and
    // not a shared/overwritten one.
    expect(byName.get("event_b")!).toBeLessThan(byName.get("event_a")!);
  });

  it("has no `onError` hook -- before/after only", () => {
    const middleware = timingMiddleware({ onTiming: () => {} });

    expect(middleware.onError).toBeUndefined();
    expect(middleware.name).toBe("timing");
  });
});
