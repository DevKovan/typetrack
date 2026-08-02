// Unit tests for issue 002's wiring of the middleware chain
// (`runBeforeChain`/`runAfterChain`, `src/middleware.ts`) into
// `createAnalytics()`'s `track()`/`page()`/`screen()`. Chain-logic-in-
// isolation tests live in `src/middleware.test.ts`; this file only tests
// that `src/index.ts` invokes that chain at the right place, in the right
// order, relative to routing/dispatch. `onError`/thrown-middleware-error
// handling is out of scope here (issue 003).
import { afterEach, describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { Middleware } from "./middleware";
import type { AnalyticsProvider } from "./providers";
import type { CanonicalEvent } from "./schema";
import { allCapabilities } from "./test-support";

const originalConsoleWarn = console.warn;

afterEach(() => {
  console.warn = originalConsoleWarn;
});

function stubConsoleWarn() {
  const warn = mock(() => {});
  console.warn = warn as unknown as typeof console.warn;
  return warn;
}

function makeProvider(name: string, overrides: Partial<AnalyticsProvider> = {}): AnalyticsProvider {
  return {
    name,
    capabilities: allCapabilities,
    track: mock(() => {}),
    identify: mock(() => {}),
    page: mock(() => {}),
    group: mock(() => {}),
    alias: mock(() => {}),
    screen: mock(() => {}),
    reset: mock(() => {}),
    async flush() {},
    async destroy() {},
    ...overrides,
  };
}

function lastCallEvent(fn: AnalyticsProvider["track"]): CanonicalEvent {
  const calls = (fn as ReturnType<typeof mock>).mock.calls;
  return calls[calls.length - 1]![0] as CanonicalEvent;
}

describe("createAnalytics() middleware wiring -- single-provider fast path", () => {
  it("single middleware mutating properties: provider receives the mutated event", async () => {
    const provider = makeProvider("solo");
    const enrich: Middleware = {
      name: "enrich",
      before: (event) => ({ ...event, properties: { ...event.properties, enriched: true } }),
    };
    const analytics = createAnalytics({ provider });
    analytics.use(enrich);

    await analytics.track("signup", { plan: "pro" });

    expect(provider.track).toHaveBeenCalledTimes(1);
    expect(lastCallEvent(provider.track).properties).toEqual({ plan: "pro", enriched: true });
  });

  it("drop via before() returning undefined: provider never called for that call; a subsequent non-dropped call still reaches it", async () => {
    const provider = makeProvider("solo");
    let shouldDrop = true;
    const conditionalDrop: Middleware = {
      name: "conditional-drop",
      before: (event) => (shouldDrop ? undefined : event),
    };
    const analytics = createAnalytics({ provider });
    analytics.use(conditionalDrop);

    await analytics.track("dropped_event");
    expect(provider.track).not.toHaveBeenCalled();

    shouldDrop = false;
    await analytics.track("kept_event");
    expect(provider.track).toHaveBeenCalledTimes(1);
    expect(lastCallEvent(provider.track).name).toBe("kept_event");
  });

  it("drop via before() returning null behaves identically to undefined", async () => {
    const provider = makeProvider("solo");
    const dropper: Middleware = { name: "dropper", before: () => null };
    const analytics = createAnalytics({ provider });
    analytics.use(dropper);

    await analytics.track("dropped_event");

    expect(provider.track).not.toHaveBeenCalled();
  });

  it("multiple middlewares run in registration order, each seeing the previous one's transformed event", async () => {
    const provider = makeProvider("solo");
    const makeTracer = (name: string): Middleware => ({
      name,
      before: (event) => ({
        ...event,
        properties: {
          ...event.properties,
          trace: [...((event.properties.trace as string[] | undefined) ?? []), name],
        },
      }),
    });
    const analytics = createAnalytics({ provider });
    analytics.use(makeTracer("first"));
    analytics.use(makeTracer("second"));
    analytics.use(makeTracer("third"));

    await analytics.track("event");

    expect(lastCallEvent(provider.track).properties.trace).toEqual(["first", "second", "third"]);
  });

  it("after() fires post-dispatch with the final (post-before-chain) event for track()", async () => {
    const provider = makeProvider("solo");
    const seenAfter: CanonicalEvent[] = [];
    const middleware: Middleware = {
      name: "mw",
      before: (event) => ({ ...event, properties: { ...event.properties, tagged: true } }),
      after: (event) => void seenAfter.push(event),
    };
    const analytics = createAnalytics({ provider });
    analytics.use(middleware);

    await analytics.track("event");

    expect(provider.track).toHaveBeenCalledTimes(1);
    expect(seenAfter).toHaveLength(1);
    expect(seenAfter[0]!.properties.tagged).toBe(true);
  });

  it("after() fires post-dispatch with the final event for page() and screen()", async () => {
    const provider = makeProvider("solo");
    const seenAfter: CanonicalEvent[] = [];
    const middleware: Middleware = {
      name: "mw",
      after: (event) => void seenAfter.push(event),
    };
    const analytics = createAnalytics({ provider });
    analytics.use(middleware);

    await analytics.page("home");
    await analytics.screen("checkout");

    expect(seenAfter).toHaveLength(2);
    expect(seenAfter[0]!.name).toBe("home");
    expect(seenAfter[1]!.name).toBe("checkout");
  });

  it("after() does not fire when before() drops the event", async () => {
    const provider = makeProvider("solo");
    const afterCalls: CanonicalEvent[] = [];
    const middleware: Middleware = {
      name: "dropper",
      before: () => undefined,
      after: (event) => void afterCalls.push(event),
    };
    const analytics = createAnalytics({ provider });
    analytics.use(middleware);

    await analytics.track("dropped_event");

    expect(provider.track).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });
});

describe("createAnalytics() middleware wiring -- multi-provider fan-out", () => {
  it("single middleware mutating properties: every provider in the array receives the same mutated (deep-equal) event", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const enrich: Middleware = {
      name: "enrich",
      before: (event) => ({ ...event, properties: { ...event.properties, enriched: true } }),
    };
    const analytics = createAnalytics({ provider: [a, b] });
    analytics.use(enrich);

    await analytics.track("signup", { plan: "pro" });

    expect(a.track).toHaveBeenCalledTimes(1);
    expect(b.track).toHaveBeenCalledTimes(1);
    expect(lastCallEvent(a.track)).toEqual(lastCallEvent(b.track));
    expect(lastCallEvent(a.track).properties).toEqual({ plan: "pro", enriched: true });
  });

  it("drop via before() returning undefined: no provider in the array is called for that call; a subsequent non-dropped call reaches all of them", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    let shouldDrop = true;
    const conditionalDrop: Middleware = {
      name: "conditional-drop",
      before: (event) => (shouldDrop ? undefined : event),
    };
    const analytics = createAnalytics({ provider: [a, b] });
    analytics.use(conditionalDrop);

    await analytics.track("dropped_event");
    expect(a.track).not.toHaveBeenCalled();
    expect(b.track).not.toHaveBeenCalled();

    shouldDrop = false;
    await analytics.track("kept_event");
    expect(a.track).toHaveBeenCalledTimes(1);
    expect(b.track).toHaveBeenCalledTimes(1);
  });

  it("drop via before() returning null behaves identically to undefined for multi-provider", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const dropper: Middleware = { name: "dropper", before: () => null };
    const analytics = createAnalytics({ provider: [a, b] });
    analytics.use(dropper);

    await analytics.track("dropped_event");

    expect(a.track).not.toHaveBeenCalled();
    expect(b.track).not.toHaveBeenCalled();
  });

  it("multiple middlewares thread registration-order transformations for multi-provider fan-out", async () => {
    const a = makeProvider("a");
    const makeTracer = (name: string): Middleware => ({
      name,
      before: (event) => ({
        ...event,
        properties: {
          ...event.properties,
          trace: [...((event.properties.trace as string[] | undefined) ?? []), name],
        },
      }),
    });
    const analytics = createAnalytics({ provider: [a] });
    analytics.use(makeTracer("first"));
    analytics.use(makeTracer("second"));

    await analytics.track("event");

    expect(lastCallEvent(a.track).properties.trace).toEqual(["first", "second"]);
  });

  it("after() still fires when one provider in a multi-provider array rejects/throws in its .track()", async () => {
    stubConsoleWarn();
    const failing = makeProvider("failing", { track: mock(() => Promise.reject(new Error("boom"))) });
    const succeeding = makeProvider("succeeding");
    const afterCalls: CanonicalEvent[] = [];
    const middleware: Middleware = { name: "mw", after: (event) => void afterCalls.push(event) };
    const analytics = createAnalytics({ provider: [failing, succeeding] });
    analytics.use(middleware);

    await analytics.track("event");

    expect(failing.track).toHaveBeenCalledTimes(1);
    expect(succeeding.track).toHaveBeenCalledTimes(1);
    expect(afterCalls).toHaveLength(1);
  });

  it("routing evaluates against the post-middleware event, not the pre-middleware one", async () => {
    const included = makeProvider("included");
    const renamer: Middleware = {
      name: "renamer",
      before: (event) => ({ ...event, name: "renamed_event" }),
    };
    const analytics = createAnalytics({
      provider: [{ provider: included, include: ["renamed_event"] }],
    });
    analytics.use(renamer);

    await analytics.track("original_event");

    expect(included.track).toHaveBeenCalledTimes(1);
    expect(lastCallEvent(included.track).name).toBe("renamed_event");
  });

  it("routing exclude also evaluates post-middleware: an event renamed to match exclude is skipped even though its original name would not have matched", async () => {
    const provider = makeProvider("excluded-after-rename");
    const renamer: Middleware = {
      name: "renamer",
      before: (event) => ({ ...event, name: "internal_event" }),
    };
    const analytics = createAnalytics({
      provider: [{ provider, exclude: ["internal_event"] }],
    });
    analytics.use(renamer);

    await analytics.track("public_event");

    expect(provider.track).not.toHaveBeenCalled();
  });
});

describe("createAnalytics() middleware wiring -- unaffected verbs", () => {
  it("identify()/group()/alias()/reset() still reach every provider even when a middleware would drop every canonical event", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const dropAll: Middleware = { name: "drop-all", before: () => undefined };
    const analytics = createAnalytics({ provider: [a, b] });
    analytics.use(dropAll);

    await analytics.identify("user_1");
    await analytics.group("group_1");
    await analytics.alias("user_2");
    await analytics.reset();

    for (const provider of [a, b]) {
      expect(provider.identify).toHaveBeenCalledTimes(1);
      expect(provider.group).toHaveBeenCalledTimes(1);
      expect(provider.alias).toHaveBeenCalledTimes(1);
      expect(provider.reset).toHaveBeenCalledTimes(1);
    }
  });

  it("flush()/destroy() are unaffected by registered middlewares", async () => {
    const flush = mock(async () => {});
    const destroy = mock(async () => {});
    const provider = makeProvider("solo", { flush, destroy });
    const dropAll: Middleware = { name: "drop-all", before: () => undefined };
    const analytics = createAnalytics({ provider });
    analytics.use(dropAll);

    await analytics.flush();
    await analytics.destroy();

    expect(flush).toHaveBeenCalledTimes(2); // once from flush(), once from destroy()'s own flush phase
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("createAnalytics() middleware wiring -- zero-middleware regression", () => {
  it("zero registered middlewares: track() single-provider fast path returns the provider's own (synchronous) return value untouched", () => {
    const provider = makeProvider("solo", { track: mock(() => undefined) });
    const analytics = createAnalytics({ provider });

    const result = analytics.track("event");

    expect(result).toBeUndefined();
    expect(provider.track).toHaveBeenCalledTimes(1);
  });

  it("zero registered middlewares: multi-provider track() still fans out exactly as Phase 7", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const analytics = createAnalytics({ provider: [a, b] });

    await analytics.track("event", { plan: "pro" });

    expect(a.track).toHaveBeenCalledTimes(1);
    expect(b.track).toHaveBeenCalledTimes(1);
    expect(lastCallEvent(a.track)).toEqual(lastCallEvent(b.track));
  });
});
