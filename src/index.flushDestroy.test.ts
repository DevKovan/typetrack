// Unit tests for issue 004: multi-provider `flush()`/`destroy()`'s
// `AggregateError` contract, distinct from `dispatchToProviders`'
// swallow-and-warn behavior used by every other fan-out verb (covered in
// `src/index.multiProvider.test.ts`). Single bare provider regression check
// (unchanged from Phase 6) also lives here.
import { afterEach, describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities } from "./test-support";

const originalConsoleWarn = console.warn;

afterEach(() => {
  console.warn = originalConsoleWarn;
});

function stubConsoleWarn() {
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

describe("createAnalytics() multi-provider flush()/destroy() AggregateError contract", () => {
  it("flush(): all providers succeed -- resolves, no throw", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const analytics = createAnalytics({ provider: [a, b] });

    await expect(analytics.flush()).resolves.toBeUndefined();
  });

  it("flush(): one of three providers rejects -- the other two still had flush() called, outer flush() rejects with an AggregateError whose .errors contains exactly the one rejection reason", async () => {
    const reason = new Error("flush boom");
    const flushA = mock(async () => {
      throw reason;
    });
    const flushB = mock(async () => {});
    const flushC = mock(async () => {});
    const a = makeProvider("a", { flush: flushA });
    const b = makeProvider("b", { flush: flushB });
    const c = makeProvider("c", { flush: flushC });
    const analytics = createAnalytics({ provider: [a, b, c] });

    let thrown: unknown;
    try {
      await analytics.flush();
    } catch (err) {
      thrown = err;
    }

    expect(flushA).toHaveBeenCalledTimes(1);
    expect(flushB).toHaveBeenCalledTimes(1);
    expect(flushC).toHaveBeenCalledTimes(1);
    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregate = thrown as AggregateError;
    expect(aggregate.errors).toHaveLength(1);
    expect(aggregate.errors[0]).toBe(reason);
  });

  it("flush(): two of three providers reject -- AggregateError.errors contains both reasons", async () => {
    const reasonA = new Error("boom a");
    const reasonC = new Error("boom c");
    const a = makeProvider("a", {
      flush: mock(async () => {
        throw reasonA;
      }),
    });
    const b = makeProvider("b");
    const c = makeProvider("c", {
      flush: mock(async () => {
        throw reasonC;
      }),
    });
    const analytics = createAnalytics({ provider: [a, b, c] });

    let thrown: unknown;
    try {
      await analytics.flush();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregate = thrown as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors).toContain(reasonA);
    expect(aggregate.errors).toContain(reasonC);
  });

  it("destroy(): a provider's flush() rejects but its destroy() does not -- that provider's destroy() is still called, and the final AggregateError.errors contains the flush rejection", async () => {
    const flushReason = new Error("flush failed");
    const destroyMethod = mock(async () => {});
    const a = makeProvider("a", {
      flush: mock(async () => {
        throw flushReason;
      }),
      destroy: destroyMethod,
    });
    const b = makeProvider("b");
    const analytics = createAnalytics({ provider: [a, b] });

    let thrown: unknown;
    try {
      await analytics.destroy();
    } catch (err) {
      thrown = err;
    }

    expect(destroyMethod).toHaveBeenCalledTimes(1);
    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregate = thrown as AggregateError;
    expect(aggregate.errors).toContain(flushReason);
  });

  it("destroy(): both a flush() and a destroy() reject -- AggregateError.errors contains both reasons (length 2 at minimum across the two phases)", async () => {
    const flushReason = new Error("flush failed");
    const destroyReason = new Error("destroy failed");
    const a = makeProvider("a", {
      flush: mock(async () => {
        throw flushReason;
      }),
    });
    const b = makeProvider("b", {
      destroy: mock(async () => {
        throw destroyReason;
      }),
    });
    const analytics = createAnalytics({ provider: [a, b] });

    let thrown: unknown;
    try {
      await analytics.destroy();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregate = thrown as AggregateError;
    expect(aggregate.errors.length).toBeGreaterThanOrEqual(2);
    expect(aggregate.errors).toContain(flushReason);
    expect(aggregate.errors).toContain(destroyReason);
  });

  it("destroy()/flush(): no rejections -- resolves normally, thrown value is never an AggregateError", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const analytics = createAnalytics({ provider: [a, b] });

    await expect(analytics.flush()).resolves.toBeUndefined();
    await expect(analytics.destroy()).resolves.toBeUndefined();
  });

  it("single bare provider whose flush() rejects: the rejection propagates as the original error, not wrapped in AggregateError", async () => {
    const reason = new Error("bare flush boom");
    const provider = makeProvider("bare", {
      flush: mock(async () => {
        throw reason;
      }),
    });
    const analytics = createAnalytics({ provider });

    let thrown: unknown;
    try {
      await analytics.flush();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe(reason);
    expect(thrown).not.toBeInstanceOf(AggregateError);
  });

  it("single bare provider whose destroy() rejects: the rejection propagates as the original error, not wrapped in AggregateError", async () => {
    const reason = new Error("bare destroy boom");
    const provider = makeProvider("bare", {
      destroy: mock(async () => {
        throw reason;
      }),
    });
    const analytics = createAnalytics({ provider });

    let thrown: unknown;
    try {
      await analytics.destroy();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe(reason);
    expect(thrown).not.toBeInstanceOf(AggregateError);
  });

  it("console.warn is not called by the multi-provider flush()/destroy() rejection path", async () => {
    const warn = stubConsoleWarn();
    const a = makeProvider("a", {
      flush: mock(async () => {
        throw new Error("flush boom");
      }),
      destroy: mock(async () => {
        throw new Error("destroy boom");
      }),
    });
    const b = makeProvider("b");
    const analytics = createAnalytics({ provider: [a, b] });

    await expect(analytics.flush()).rejects.toBeInstanceOf(AggregateError);
    await expect(analytics.destroy()).rejects.toBeInstanceOf(AggregateError);

    expect(warn).not.toHaveBeenCalled();
  });
});
