// Unit tests for issue 002's wiring of the middleware chain
// (`runBeforeChain`/`runAfterChain`, `src/middleware.ts`) into
// `createAnalytics()`'s `track()`/`page()`/`screen()`. Chain-logic-in-
// isolation tests live in `src/middleware.test.ts`; this file only tests
// that `src/index.ts` invokes that chain at the right place, in the right
// order, relative to routing/dispatch. Issue 003 extends this file with
// `onError` fan-out coverage (before()/after() throws, provider-dispatch
// rejections, broken `onError` handlers, and the before()-drop regression
// check) -- see the "onError wiring" describe block below. A full,
// hand-computed-outcome integration test lives in
// `src/index.middleware.error.integration.test.ts`.
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
  // Variadic signature (issue 003) so callers can index into
  // `warn.mock.calls[i]![0]` to inspect the warned message -- matches the
  // pattern already established in `index.multiProvider.test.ts`.
  const warn = mock((..._args: unknown[]) => {});
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

// Issue 003: `onError` fan-out wiring.
type OnErrorCall = { error: unknown; event: CanonicalEvent; ctx: { source: "middleware" | "provider"; providerName?: string } };

function recordingErrorMiddleware(name: string, log: OnErrorCall[]): Middleware {
  return {
    name,
    onError(error, event, ctx) {
      log.push({ error, event, ctx });
    },
  };
}

describe("createAnalytics() middleware wiring -- onError fan-out", () => {
  it("before()-throw: onError fires on the thrower and everyone before it (registration order); later middlewares never receive it; provider is never dispatched; track() resolves normally", async () => {
    const provider = makeProvider("solo");
    const boom = new Error("before boom");
    const logA: OnErrorCall[] = [];
    const logB: OnErrorCall[] = [];
    const logC: OnErrorCall[] = [];
    const first: Middleware = { ...recordingErrorMiddleware("first", logA), before: (event) => event };
    const thrower: Middleware = {
      ...recordingErrorMiddleware("thrower", logB),
      before: () => {
        throw boom;
      },
    };
    const never: Middleware = { ...recordingErrorMiddleware("never", logC), before: (event) => event };

    const analytics = createAnalytics({ provider });
    analytics.use(first);
    analytics.use(thrower);
    analytics.use(never);

    await expect(analytics.track("event")).resolves.toBeUndefined();

    expect(provider.track).not.toHaveBeenCalled();
    expect(logA).toHaveLength(1);
    expect(logA[0]!.error).toBe(boom);
    expect(logA[0]!.ctx).toEqual({ source: "middleware" });
    expect(logB).toHaveLength(1);
    expect(logB[0]!.error).toBe(boom);
    expect(logB[0]!.ctx).toEqual({ source: "middleware" });
    expect(logC).toHaveLength(0);
  });

  it("before()-throw via a rejected Promise is treated identically to a synchronous throw", async () => {
    const provider = makeProvider("solo");
    const boom = new Error("async before boom");
    const log: OnErrorCall[] = [];
    const thrower: Middleware = { ...recordingErrorMiddleware("thrower", log), before: () => Promise.reject(boom) };
    const analytics = createAnalytics({ provider });
    analytics.use(thrower);

    await analytics.track("event");

    expect(provider.track).not.toHaveBeenCalled();
    expect(log).toHaveLength(1);
    expect(log[0]!.error).toBe(boom);
  });

  it("after()-throw: onError fires on the thrower and everyone before it; provider was still dispatched (dispatch already happened); track() resolves normally", async () => {
    const provider = makeProvider("solo");
    const boom = new Error("after boom");
    const logA: OnErrorCall[] = [];
    const logB: OnErrorCall[] = [];
    const logC: OnErrorCall[] = [];
    let thirdAfterRan = false;
    const first: Middleware = { ...recordingErrorMiddleware("first", logA), after: () => {} };
    const thrower: Middleware = {
      ...recordingErrorMiddleware("thrower", logB),
      after: () => {
        throw boom;
      },
    };
    const third: Middleware = {
      ...recordingErrorMiddleware("third", logC),
      after: () => void (thirdAfterRan = true),
    };

    const analytics = createAnalytics({ provider });
    analytics.use(first);
    analytics.use(thrower);
    analytics.use(third);

    await expect(analytics.track("event")).resolves.toBeUndefined();

    expect(provider.track).toHaveBeenCalledTimes(1);
    expect(thirdAfterRan).toBe(false);
    expect(logA).toHaveLength(1);
    expect(logA[0]!.error).toBe(boom);
    expect(logA[0]!.ctx).toEqual({ source: "middleware" });
    expect(logB).toHaveLength(1);
    expect(logB[0]!.error).toBe(boom);
    expect(logC).toHaveLength(0);
  });

  it("single-provider dispatch failure: every registered middleware's onError fires once with source: provider and the correct providerName; console.warn still fires; track() resolves normally", async () => {
    const warn = stubConsoleWarn();
    const boom = new Error("provider boom");
    const provider = makeProvider("flaky", { track: mock(() => Promise.reject(boom)) });
    const logA: OnErrorCall[] = [];
    const logB: OnErrorCall[] = [];
    const analytics = createAnalytics({ provider });
    analytics.use(recordingErrorMiddleware("a", logA));
    analytics.use(recordingErrorMiddleware("b", logB));

    await expect(analytics.track("event")).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("flaky");
    for (const log of [logA, logB]) {
      expect(log).toHaveLength(1);
      expect(log[0]!.error).toBe(boom);
      expect(log[0]!.ctx).toEqual({ source: "provider", providerName: "flaky" });
    }
  });

  it("single-provider dispatch failure via a synchronous throw is handled identically to a rejected Promise", async () => {
    stubConsoleWarn();
    const boom = new Error("sync provider boom");
    const provider = makeProvider("sync-flaky", {
      track: mock(() => {
        throw boom;
      }),
    });
    const log: OnErrorCall[] = [];
    const analytics = createAnalytics({ provider });
    analytics.use(recordingErrorMiddleware("a", log));

    await analytics.track("event");

    expect(log).toHaveLength(1);
    expect(log[0]!.error).toBe(boom);
    expect(log[0]!.ctx).toEqual({ source: "provider", providerName: "sync-flaky" });
  });

  it("multi-provider partial failure: onError fires once per failing provider per middleware with the correct providerName; the succeeding provider never triggers onError; console.warn fires once per failure", async () => {
    const warn = stubConsoleWarn();
    const boomA = new Error("a boom");
    const boomC = new Error("c boom");
    const a = makeProvider("a", { track: mock(() => Promise.reject(boomA)) });
    const b = makeProvider("b");
    const c = makeProvider("c", {
      track: mock(() => {
        throw boomC;
      }),
    });
    const log: OnErrorCall[] = [];
    const analytics = createAnalytics({ provider: [a, b, c] });
    analytics.use(recordingErrorMiddleware("mw", log));

    await analytics.track("event");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(log).toHaveLength(2);
    const byProvider = new Map(log.map((entry) => [entry.ctx.providerName, entry]));
    expect(byProvider.get("a")!.error).toBe(boomA);
    expect(byProvider.get("a")!.ctx).toEqual({ source: "provider", providerName: "a" });
    expect(byProvider.get("c")!.error).toBe(boomC);
    expect(byProvider.get("c")!.ctx).toEqual({ source: "provider", providerName: "c" });
    expect(byProvider.has("b")).toBe(false);
  });

  it("a broken onError handler (itself throws) is swallowed and warned, and does not prevent other middlewares' onError from being called for the same failure", async () => {
    const warn = stubConsoleWarn();
    const boom = new Error("provider boom");
    const provider = makeProvider("flaky", { track: mock(() => Promise.reject(boom)) });
    const broken: Middleware = {
      name: "broken",
      onError: () => {
        throw new Error("onError itself is broken");
      },
    };
    const log: OnErrorCall[] = [];
    const healthy = recordingErrorMiddleware("healthy", log);

    const analytics = createAnalytics({ provider });
    analytics.use(broken);
    analytics.use(healthy);

    await expect(analytics.track("event")).resolves.toBeUndefined();

    expect(log).toHaveLength(1);
    expect(log[0]!.error).toBe(boom);
    // One warn for the provider rejection itself, one for the broken onError handler.
    expect(warn).toHaveBeenCalledTimes(2);
    const warnedMessages = warn.mock.calls.map((call) => call[0]);
    expect(warnedMessages.some((message) => String(message).includes("broken"))).toBe(true);
  });

  it("a broken before()-throw onError handler is swallowed and warned, and does not prevent a later middleware's onError from firing", async () => {
    const warn = stubConsoleWarn();
    const provider = makeProvider("solo");
    const boom = new Error("before boom");
    const broken: Middleware = {
      name: "broken",
      before: () => {
        throw boom;
      },
      onError: () => {
        throw new Error("broken handler");
      },
    };
    const log: OnErrorCall[] = [];
    const healthy = recordingErrorMiddleware("healthy", log);

    const analytics = createAnalytics({ provider });
    analytics.use(broken);
    analytics.use(healthy);

    await expect(analytics.track("event")).resolves.toBeUndefined();

    expect(log).toHaveLength(0); // "healthy" is registered after "broken" -- the before-chain stops at "broken"'s throw, so "healthy" is never reached/notified.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("broken");
  });

  it("drop via before() returning undefined: onError is never called (regression check against issue 002's drop contract)", async () => {
    const provider = makeProvider("solo");
    const log: OnErrorCall[] = [];
    const dropper: Middleware = { ...recordingErrorMiddleware("dropper", log), before: () => undefined };
    const analytics = createAnalytics({ provider });
    analytics.use(dropper);

    await analytics.track("dropped_event");

    expect(provider.track).not.toHaveBeenCalled();
    expect(log).toHaveLength(0);
  });

  it("drop via before() returning null: onError is never called", async () => {
    const provider = makeProvider("solo");
    const log: OnErrorCall[] = [];
    const dropper: Middleware = { ...recordingErrorMiddleware("dropper", log), before: () => null };
    const analytics = createAnalytics({ provider });
    analytics.use(dropper);

    await analytics.track("dropped_event");

    expect(log).toHaveLength(0);
  });
});
