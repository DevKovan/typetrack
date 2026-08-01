import { beforeEach, describe, expect, it, mock } from "bun:test";

// Unit tests -- no real network I/O. `@segment/analytics-node`'s `Analytics`
// export is replaced with an in-memory fake before `./index` is imported, so
// `createSegmentProvider` constructs the fake instead of a real client.
interface TrackCall {
  userId?: string;
  anonymousId?: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}
interface IdentifyCall {
  userId: string;
  anonymousId?: string;
  traits?: Record<string, unknown>;
}
interface PageCall {
  userId?: string;
  anonymousId?: string;
  name?: string;
  properties?: Record<string, unknown>;
}

const trackCalls: TrackCall[] = [];
const identifyCalls: IdentifyCall[] = [];
const pageCalls: PageCall[] = [];
const closeAndFlush = mock(() => Promise.resolve());
const flush = mock(() => Promise.resolve());

class FakeAnalytics {
  settings: unknown;

  constructor(settings: unknown) {
    this.settings = settings;
  }

  track(props: TrackCall) {
    trackCalls.push(props);
  }

  identify(props: IdentifyCall) {
    identifyCalls.push(props);
  }

  page(props: PageCall) {
    pageCalls.push(props);
  }

  closeAndFlush() {
    return closeAndFlush();
  }

  flush() {
    return flush();
  }
}

mock.module("@segment/analytics-node", () => ({ Analytics: FakeAnalytics }));

const { createSegmentProvider } = await import("./index");

beforeEach(() => {
  trackCalls.length = 0;
  identifyCalls.length = 0;
  pageCalls.length = 0;
  closeAndFlush.mockClear();
  flush.mockClear();
});

describe("createSegmentProvider", () => {
  it("track() before identify() passes only a generated anonymousId (no userId)", () => {
    const provider = createSegmentProvider({ writeKey: "test" });

    provider.track("signup_started", {}, { timestamp: 1000 });

    expect(trackCalls).toHaveLength(1);
    const call = trackCalls[0]!;
    expect(call.userId).toBeUndefined();
    expect(typeof call.anonymousId).toBe("string");
    expect(call.anonymousId?.length).toBeGreaterThan(0);
  });

  it("uses a different anonymousId per provider instance", () => {
    const a = createSegmentProvider({ writeKey: "test" });
    a.track("event_a", {}, { timestamp: 1000 });
    const firstId = trackCalls[0]!.anonymousId;

    const b = createSegmentProvider({ writeKey: "test" });
    b.track("event_b", {}, { timestamp: 1000 });
    const secondId = trackCalls[1]!.anonymousId;

    expect(firstId).not.toBe(secondId);
  });

  it("track() after identify() passes both userId and the original anonymousId", () => {
    const provider = createSegmentProvider({ writeKey: "test" });

    provider.track("pre_identify", {}, { timestamp: 500 });
    const anonymousId = trackCalls[0]!.anonymousId;

    provider.identify?.("user_1", { plan: "pro" });
    provider.track("signup_completed", { plan: "pro" }, { timestamp: 1234 });

    expect(trackCalls).toHaveLength(2);
    const call = trackCalls[1]!;
    expect(call.userId).toBe("user_1");
    expect(call.anonymousId).toBe(anonymousId);
    expect(call.event).toBe("signup_completed");
    expect(call.properties).toEqual({ plan: "pro" });
    expect(call.timestamp).toEqual(new Date(1234));
  });

  it("identify() forwards userId/anonymousId/traits to the client's identify()", () => {
    const provider = createSegmentProvider({ writeKey: "test" });

    provider.identify?.("user_42", { email: "a@example.com" });

    expect(identifyCalls).toHaveLength(1);
    const call = identifyCalls[0]!;
    expect(call.userId).toBe("user_42");
    expect(typeof call.anonymousId).toBe("string");
    expect(call.traits).toEqual({ email: "a@example.com" });
  });

  it("page() forwards name/props folded into properties, with the current identity", () => {
    const provider = createSegmentProvider({ writeKey: "test" });

    provider.page?.("Home", { referrer: "google" });

    expect(pageCalls).toHaveLength(1);
    const call = pageCalls[0]!;
    expect(call.name).toBe("Home");
    expect(call.properties).toEqual({ referrer: "google" });
    expect(typeof call.anonymousId).toBe("string");
    expect(call.userId).toBeUndefined();
  });

  it("page() after identify() uses the identified userId alongside anonymousId", () => {
    const provider = createSegmentProvider({ writeKey: "test" });

    provider.identify?.("user_7");
    provider.page?.("Pricing");

    expect(pageCalls).toHaveLength(1);
    const call = pageCalls[0]!;
    expect(call.userId).toBe("user_7");
    expect(typeof call.anonymousId).toBe("string");
  });

  it("flush() calls the client's closeAndFlush() and never the non-terminal flush()", async () => {
    const provider = createSegmentProvider({ writeKey: "test" });

    await provider.flush?.();

    expect(closeAndFlush).toHaveBeenCalledTimes(1);
    expect(flush).not.toHaveBeenCalled();
  });
});
