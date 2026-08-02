import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { CanonicalEvent } from "typetrack";

// Unit tests -- no real network I/O. `posthog-node`'s `PostHog` export is
// replaced with an in-memory fake before `./index` is imported, so
// `createPostHogProvider` constructs the fake instead of a real client.
interface CaptureCall {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}
interface IdentifyCall {
  distinctId: string;
  properties?: Record<string, unknown>;
}
interface GroupIdentifyCall {
  groupType: string;
  groupKey: string;
  properties?: Record<string, unknown>;
}
interface AliasCall {
  distinctId: string;
  alias: string;
}

const captureCalls: CaptureCall[] = [];
const identifyCalls: IdentifyCall[] = [];
const groupIdentifyCalls: GroupIdentifyCall[] = [];
const aliasCalls: AliasCall[] = [];
const callOrder: string[] = [];
const flush = mock(() => {
  callOrder.push("flush");
  return Promise.resolve();
});
const shutdown = mock(() => {
  callOrder.push("shutdown");
  return Promise.resolve();
});

class FakePostHog {
  apiKey: string;
  options: unknown;

  constructor(apiKey: string, options: unknown) {
    this.apiKey = apiKey;
    this.options = options;
  }

  capture(props: CaptureCall) {
    captureCalls.push(props);
  }

  identify(props: IdentifyCall) {
    identifyCalls.push(props);
  }

  groupIdentify(props: GroupIdentifyCall) {
    groupIdentifyCalls.push(props);
  }

  alias(props: AliasCall) {
    aliasCalls.push(props);
  }

  flush() {
    return flush();
  }

  shutdown() {
    return shutdown();
  }
}

mock.module("posthog-node", () => ({ PostHog: FakePostHog }));

const { createPostHogProvider } = await import("./index");

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "Purchase Completed",
    properties: {},
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    sessionId: "session-1",
    ...overrides,
  };
}

beforeEach(() => {
  captureCalls.length = 0;
  identifyCalls.length = 0;
  groupIdentifyCalls.length = 0;
  aliasCalls.length = 0;
  callOrder.length = 0;
  flush.mockClear();
  shutdown.mockClear();
});

describe("createPostHogProvider", () => {
  it("track() uses event.userId as distinctId when set", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.track(makeEvent({ userId: "user_1", anonymousId: "anon-1" }));

    expect(captureCalls).toHaveLength(1);
    expect(captureCalls[0]!.distinctId).toBe("user_1");
  });

  it("track() falls back to event.anonymousId when userId is undefined, with no adapter-side caching across calls", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.track(makeEvent({ userId: undefined, anonymousId: "anon-a" }));
    provider.track(makeEvent({ userId: undefined, anonymousId: "anon-b" }));

    expect(captureCalls).toHaveLength(2);
    expect(captureCalls[0]!.distinctId).toBe("anon-a");
    expect(captureCalls[1]!.distinctId).toBe("anon-b");
  });

  it("passes through an unmapped canonical event name and warns exactly once per unique name", () => {
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;
    try {
      const provider = createPostHogProvider({ apiKey: "test" });

      provider.track(makeEvent({ name: "Custom Event" }));
      provider.track(makeEvent({ name: "Custom Event" }));
      provider.track(makeEvent({ name: "Another Custom Event" }));

      expect(captureCalls[0]!.event).toBe("Custom Event");
      expect(captureCalls[1]!.event).toBe("Custom Event");
      expect(captureCalls[2]!.event).toBe("Another Custom Event");
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("does not warn for the default canonical event names", () => {
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;
    try {
      const provider = createPostHogProvider({ apiKey: "test" });
      provider.track(makeEvent({ name: "Purchase Completed" }));
      expect(warnSpy).not.toHaveBeenCalled();
      expect(captureCalls[0]!.event).toBe("Purchase Completed");
    } finally {
      console.warn = originalWarn;
    }
  });

  it("eventMap config override wins over the default for a colliding key", () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      eventMap: { "Purchase Completed": "order_completed" },
    });

    provider.track(makeEvent({ name: "Purchase Completed" }));

    expect(captureCalls[0]!.event).toBe("order_completed");
  });

  it("eventMap config override honors a brand-new custom key not in the default table", () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      eventMap: { "Widget Clicked": "widget_clicked" },
    });

    provider.track(makeEvent({ name: "Widget Clicked" }));

    expect(captureCalls[0]!.event).toBe("widget_clicked");
  });

  it("propertyMap per-event override beats global, global is a fallback, unmapped keys pass through", () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      propertyMap: {
        global: { total: "amount_global", orderId: "order_id_global" },
        events: {
          "Purchase Completed": { total: "amount_specific" },
        },
      },
    });

    provider.track(
      makeEvent({
        name: "Purchase Completed",
        properties: { total: 42, orderId: "o1", untouched: true },
      }),
    );

    const properties = captureCalls[0]!.properties!;
    expect(properties["amount_specific"]).toBe(42);
    expect(properties["order_id_global"]).toBe("o1");
    expect(properties["untouched"]).toBe(true);
  });

  it("forwards identify() with the new 3-arg signature and distinctId/properties field names", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.identify?.("user_42", { email: "a@example.com" }, "anon-42");

    expect(identifyCalls).toHaveLength(1);
    expect(identifyCalls[0]).toEqual({
      distinctId: "user_42",
      properties: { email: "a@example.com" },
    });
  });

  it("group() calls client.groupIdentify() with a fixed groupType constant", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.group?.("acme", { plan: "pro" }, { anonymousId: "a1" });

    expect(groupIdentifyCalls).toHaveLength(1);
    expect(groupIdentifyCalls[0]).toEqual({
      groupType: "group",
      groupKey: "acme",
      properties: { plan: "pro" },
    });
  });

  it("alias() forwards to the client's alias method with the correct field names", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.alias?.("user_new", "user_old", "anon-1");

    expect(aliasCalls).toHaveLength(1);
    expect(aliasCalls[0]).toEqual({ distinctId: "user_new", alias: "user_old" });
  });

  it("alias() falls back to anonymousId when previousUserId is undefined", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.alias?.("user_new", undefined, "anon-9");

    expect(aliasCalls[0]).toEqual({ distinctId: "user_new", alias: "anon-9" });
  });

  it("screen() calls client.capture() with event $screen and folds a non-empty name into properties", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.screen?.(makeEvent({ name: "Onboarding", properties: { step: 1 } }));

    expect(captureCalls).toHaveLength(1);
    expect(captureCalls[0]!.event).toBe("$screen");
    expect(captureCalls[0]!.properties).toEqual({ step: 1, name: "Onboarding" });
  });

  it("screen() does not fold an empty-string name into properties", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.screen?.(makeEvent({ name: "", properties: { step: 1 } }));

    expect(captureCalls[0]!.properties).toEqual({ step: 1 });
  });

  it("page() calls client.capture() with event $pageview and folds a non-empty name into properties", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.page?.(makeEvent({ name: "Home", properties: { referrer: "google" } }));

    expect(captureCalls).toHaveLength(1);
    expect(captureCalls[0]!.event).toBe("$pageview");
    expect(captureCalls[0]!.properties).toEqual({ referrer: "google", name: "Home" });
  });

  it("capabilities matches the declared table exactly", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    expect(provider.capabilities).toEqual({
      identify: true,
      group: true,
      alias: true,
      page: true,
      screen: true,
      batching: true,
      offline: false,
      featureFlags: true,
      sessionReplay: false,
      heatmaps: false,
    });
  });

  it("flush() calls client.flush() and never client.shutdown()", async () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    await provider.flush?.();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("destroy() calls client.flush() then client.shutdown(), in that order", async () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    await provider.destroy?.();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["flush", "shutdown"]);
  });

  it("reset() does not throw and does not call any client method", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    expect(() => provider.reset?.()).not.toThrow();

    expect(captureCalls).toHaveLength(0);
    expect(identifyCalls).toHaveLength(0);
    expect(groupIdentifyCalls).toHaveLength(0);
    expect(aliasCalls).toHaveLength(0);
    expect(flush).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });
});
