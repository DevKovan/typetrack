// Unit tests for `runBeforeChain`/`runAfterChain` (Phase 8 issue 001, extended
// by issue 003 with `threw`/`error`/short-circuit-on-throw semantics). Pure
// logic, no I/O.
import { describe, expect, it } from "bun:test";
import type { Middleware } from "./middleware";
import { runAfterChain, runBeforeChain } from "./middleware";
import type { CanonicalEvent } from "./schema";

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "generic_event",
    properties: {},
    timestamp: 1_700_000_000_000,
    anonymousId: "anon",
    sessionId: "session",
    ...overrides,
  };
}

describe("runBeforeChain", () => {
  it("empty list: returns the same event reference unchanged, dropped: false, ranMiddlewares: []", async () => {
    const event = makeEvent();
    const result = await runBeforeChain([], event);
    expect(result).toEqual({ event, dropped: false, ranMiddlewares: [], threw: false });
    expect(result.event).toBe(event);
  });

  it("single middleware with no before/after -- no-op passthrough, still counted as ran", async () => {
    const event = makeEvent();
    const middleware: Middleware = { name: "noop" };
    const result = await runBeforeChain([middleware], event);
    expect(result.event).toBe(event);
    expect(result.dropped).toBe(false);
    expect(result.ranMiddlewares).toEqual([middleware]);
  });

  it("threads a transformed event from one middleware's before() into the next", async () => {
    const first: Middleware = {
      name: "add-a",
      before: (event) => ({ ...event, properties: { ...event.properties, a: 1 } }),
    };
    const second: Middleware = {
      name: "add-b",
      before: (event) => ({ ...event, properties: { ...event.properties, b: 2 } }),
    };
    const third: Middleware = {
      name: "add-c",
      before: (event) => ({ ...event, properties: { ...event.properties, c: 3 } }),
    };

    const result = await runBeforeChain([first, second, third], makeEvent());

    expect(result.dropped).toBe(false);
    expect(result.event.properties).toEqual({ a: 1, b: 2, c: 3 });
    expect(result.ranMiddlewares).toEqual([first, second, third]);
  });

  it("stops at the first before() returning undefined; later middlewares never invoked", async () => {
    let secondCalls = 0;
    let thirdCalls = 0;
    const first: Middleware = {
      name: "first",
      before: () => undefined,
    };
    const second: Middleware = {
      name: "second",
      before: (event) => {
        secondCalls++;
        return event;
      },
    };
    const third: Middleware = {
      name: "third",
      before: (event) => {
        thirdCalls++;
        return event;
      },
    };

    const result = await runBeforeChain([first, second, third], makeEvent());

    expect(result.dropped).toBe(true);
    expect(secondCalls).toBe(0);
    expect(thirdCalls).toBe(0);
    expect(result.ranMiddlewares).toEqual([first]);
  });

  it("stops at the first before() returning null; later middlewares never invoked", async () => {
    let secondCalls = 0;
    const first: Middleware = { name: "first", before: () => null };
    const second: Middleware = {
      name: "second",
      before: (event) => {
        secondCalls++;
        return event;
      },
    };

    const result = await runBeforeChain([first, second], makeEvent());

    expect(result.dropped).toBe(true);
    expect(secondCalls).toBe(0);
    expect(result.ranMiddlewares).toEqual([first]);
  });

  it("dropping middleware itself is included in ranMiddlewares, but nothing after it", async () => {
    const first: Middleware = { name: "first", before: (event) => event };
    const dropper: Middleware = { name: "dropper", before: () => null };
    const never: Middleware = { name: "never", before: (event) => event };

    const result = await runBeforeChain([first, dropper, never], makeEvent());

    expect(result.ranMiddlewares).toEqual([first, dropper]);
    expect(result.ranMiddlewares).not.toContain(never);
  });

  it("resolves async before() in order, not concurrently", async () => {
    const order: string[] = [];
    const first: Middleware = {
      name: "first",
      before: async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("first");
        return { ...event, properties: { ...event.properties, first: true } };
      },
    };
    const second: Middleware = {
      name: "second",
      before: async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        order.push("second");
        return { ...event, properties: { ...event.properties, second: true } };
      },
    };

    const result = await runBeforeChain([first, second], makeEvent());

    // If these ran concurrently, "second" (shorter delay) would resolve
    // first; sequential execution guarantees "first" resolves (and is
    // pushed) before "second" even starts awaiting.
    expect(order).toEqual(["first", "second"]);
    expect(result.event.properties).toEqual({ first: true, second: true });
  });

  it("a middleware's before() throwing synchronously: threw: true, error captured, ranMiddlewares includes the thrower and everyone before it, not dropped", async () => {
    const boom = new Error("boom");
    const first: Middleware = { name: "first", before: (event) => event };
    const thrower: Middleware = {
      name: "thrower",
      before: () => {
        throw boom;
      },
    };
    const never: Middleware = { name: "never", before: (event) => event };

    const result = await runBeforeChain([first, thrower, never], makeEvent());

    expect(result.threw).toBe(true);
    expect(result.error).toBe(boom);
    expect(result.dropped).toBe(false);
    expect(result.ranMiddlewares).toEqual([first, thrower]);
  });

  it("a middleware's before() returning a rejected Promise: threw: true, error is the rejection reason", async () => {
    const boom = new Error("async boom");
    const thrower: Middleware = { name: "thrower", before: () => Promise.reject(boom) };

    const result = await runBeforeChain([thrower], makeEvent());

    expect(result.threw).toBe(true);
    expect(result.error).toBe(boom);
    expect(result.ranMiddlewares).toEqual([thrower]);
  });

  it("on a before() throw, event is the value fed into the throwing middleware (last successfully-transformed event)", async () => {
    const first: Middleware = {
      name: "first",
      before: (event) => ({ ...event, properties: { ...event.properties, a: 1 } }),
    };
    const thrower: Middleware = {
      name: "thrower",
      before: () => {
        throw new Error("boom");
      },
    };

    const result = await runBeforeChain([first, thrower], makeEvent());

    expect(result.event.properties).toEqual({ a: 1 });
  });
});

describe("runAfterChain", () => {
  it("empty list: resolves without error", async () => {
    await expect(runAfterChain([], makeEvent())).resolves.toEqual({ ranMiddlewares: [], threw: false });
  });

  it("single middleware with no after -- no-op, does not throw", async () => {
    const middleware: Middleware = { name: "noop" };
    await expect(runAfterChain([middleware], makeEvent())).resolves.toEqual({
      ranMiddlewares: [middleware],
      threw: false,
    });
  });

  it("invokes every middleware's after() in registration order, skipping those without one", async () => {
    const order: string[] = [];
    const withAfterA: Middleware = { name: "a", after: () => void order.push("a") };
    const withoutAfter: Middleware = { name: "b" };
    const withAfterC: Middleware = { name: "c", after: () => void order.push("c") };

    await runAfterChain([withAfterA, withoutAfter, withAfterC], makeEvent());

    expect(order).toEqual(["a", "c"]);
  });

  it("passes the same event reference to each after(), not re-transformed between calls", async () => {
    const event = makeEvent();
    const seen: CanonicalEvent[] = [];
    const first: Middleware = { name: "first", after: (e) => void seen.push(e) };
    const second: Middleware = { name: "second", after: (e) => void seen.push(e) };

    await runAfterChain([first, second], event);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(event);
    expect(seen[1]).toBe(event);
  });

  it("resolves async after() in order, not concurrently", async () => {
    const order: string[] = [];
    const first: Middleware = {
      name: "first",
      after: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("first");
      },
    };
    const second: Middleware = {
      name: "second",
      after: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        order.push("second");
      },
    };

    await runAfterChain([first, second], makeEvent());

    expect(order).toEqual(["first", "second"]);
  });

  it("a middleware's after() throwing synchronously: threw: true, error captured, ranMiddlewares includes the thrower and everyone before it, later after()s never run", async () => {
    const boom = new Error("after boom");
    let firstRan = false;
    let neverRan = false;
    const first: Middleware = { name: "first", after: () => void (firstRan = true) };
    const thrower: Middleware = {
      name: "thrower",
      after: () => {
        throw boom;
      },
    };
    const never: Middleware = { name: "never", after: () => void (neverRan = true) };

    const result = await runAfterChain([first, thrower, never], makeEvent());

    expect(result.threw).toBe(true);
    expect(result.error).toBe(boom);
    expect(firstRan).toBe(true);
    expect(neverRan).toBe(false);
    expect(result.ranMiddlewares).toEqual([first, thrower]);
  });

  it("a middleware's after() returning a rejected Promise: threw: true, error is the rejection reason", async () => {
    const boom = new Error("async after boom");
    const thrower: Middleware = { name: "thrower", after: () => Promise.reject(boom) };

    const result = await runAfterChain([thrower], makeEvent());

    expect(result.threw).toBe(true);
    expect(result.error).toBe(boom);
    expect(result.ranMiddlewares).toEqual([thrower]);
  });
});
