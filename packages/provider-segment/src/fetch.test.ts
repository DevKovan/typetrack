import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createSegmentFetchProvider } from "./fetch";

// Unit tests -- no real network I/O. `globalThis.fetch` is stubbed before
// each test and restored afterward, same pattern as
// `packages/provider-ga4/src/index.test.ts`.

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: URL;
  init?: RequestInit;
}

let fetchCalls: FetchCall[];
let fetchImpl: (url: URL, init?: RequestInit) => Promise<Response> | Response;

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = () => new Response(null, { status: 200 });
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(input.toString());
    fetchCalls.push({ url, init });
    return Promise.resolve(fetchImpl(url, init));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function parseBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(call.init?.body as string) as Record<string, unknown>;
}

function headerValue(call: FetchCall, name: string): string | null {
  const headers = call.init?.headers;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key?.toLowerCase() === name.toLowerCase())?.[1] ?? null;
  }
  return (headers as Record<string, string> | undefined)?.[name] ?? null;
}

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "Custom Event",
    properties: {},
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    sessionId: "session-1",
    ...overrides,
  };
}

describe("createSegmentFetchProvider (unit)", () => {
  it("track() POSTs to /v1/track with the correct body shape", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.track(makeEvent({ name: "Custom Event", properties: { plan: "pro" }, userId: "user_1" }));

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url.pathname).toBe("/v1/track");
    expect(call.init?.method).toBe("POST");

    const body = parseBody(call);
    expect(body["event"]).toBe("Custom Event");
    expect(body["properties"]).toEqual({ plan: "pro" });
    expect(body["userId"]).toBe("user_1");
    expect(body["anonymousId"]).toBe("anon-1");
    expect(body["timestamp"]).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("every Segment request carries the correct Authorization: Basic header (writeKey + ':' base64-encoded)", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "abc123" });

    await provider.track(makeEvent());

    const call = fetchCalls[0]!;
    const authHeader = headerValue(call, "Authorization");
    expect(authHeader).toBe(`Basic ${btoa("abc123:")}`);

    // Decode and assert on the underlying value directly, per acceptance
    // criteria -- not just a string comparison against a re-derived
    // expectation.
    const encoded = authHeader!.replace("Basic ", "");
    expect(atob(encoded)).toBe("abc123:");
  });

  it("Content-Type header is application/json", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.track(makeEvent());

    expect(headerValue(fetchCalls[0]!, "Content-Type")).toBe("application/json");
  });

  it("translates a default-mapped canonical event name", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.track(makeEvent({ name: "Purchase Completed", properties: { orderId: "o1", total: 42 } }));

    const body = parseBody(fetchCalls[0]!);
    expect(body["event"]).toBe("Order Completed");
    expect(body["properties"]).toEqual({ order_id: "o1", revenue: 42 });
  });

  it("passes an unmapped event name through unchanged and warns exactly once per name", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const provider = createSegmentFetchProvider({ writeKey: "test" });

      await provider.track(makeEvent({ name: "Totally Custom Event" }));
      await provider.track(makeEvent({ name: "Totally Custom Event" }));

      expect(parseBody(fetchCalls[0]!)["event"]).toBe("Totally Custom Event");
      expect(warnSpy).toHaveBeenCalledTimes(1);

      await provider.track(makeEvent({ name: "Another Custom Event" }));
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("eventMap override wins over the default for a colliding key", async () => {
    const provider = createSegmentFetchProvider({
      writeKey: "test",
      eventMap: { "Purchase Completed": "Custom Purchase" },
    });

    await provider.track(makeEvent({ name: "Purchase Completed" }));

    expect(parseBody(fetchCalls[0]!)["event"]).toBe("Custom Purchase");
  });

  it("propertyMap: per-event override beats global, global is fallback, unmapped keys pass through", async () => {
    const provider = createSegmentFetchProvider({
      writeKey: "test",
      propertyMap: {
        global: { orderId: "global_order_id", currency: "currency" },
        events: { "Purchase Completed": { orderId: "per_event_order_id" } },
      },
    });

    await provider.track(
      makeEvent({
        name: "Purchase Completed",
        properties: { orderId: "o1", total: 42, currency: "USD", unmappedKey: "value" },
      }),
    );

    const properties = parseBody(fetchCalls[0]!)["properties"] as Record<string, unknown>;
    expect(properties["per_event_order_id"]).toBe("o1");
    expect(properties["global_order_id"]).toBeUndefined();
    expect(properties["orderId"]).toBeUndefined();
    expect(properties["revenue"]).toBe(42);
    expect(properties["currency"]).toBe("USD");
    expect(properties["unmappedKey"]).toBe("value");
  });

  it("identify() POSTs to /v1/identify with userId/anonymousId/traits", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.identify?.("user_42", { email: "a@example.com" }, "anon-42");

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url.pathname).toBe("/v1/identify");
    const body = parseBody(call);
    expect(body["userId"]).toBe("user_42");
    expect(body["anonymousId"]).toBe("anon-42");
    expect(body["traits"]).toEqual({ email: "a@example.com" });
  });

  it("group() POSTs to /v1/group with the correct identity shape", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.group?.("group_1", { plan: "enterprise" }, { userId: "user_1", anonymousId: "anon-1" });

    const call = fetchCalls[0]!;
    expect(call.url.pathname).toBe("/v1/group");
    const body = parseBody(call);
    expect(body["groupId"]).toBe("group_1");
    expect(body["userId"]).toBe("user_1");
    expect(body["anonymousId"]).toBe("anon-1");
    expect(body["traits"]).toEqual({ plan: "enterprise" });
  });

  it("group() omits userId when the identity has none", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.group?.("group_1", undefined, { anonymousId: "anon-1" });

    const body = parseBody(fetchCalls[0]!);
    expect(body["userId"]).toBeUndefined();
    expect(body["anonymousId"]).toBe("anon-1");
  });

  it("alias() POSTs to /v1/alias with userId/previousId", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.alias?.("new_user", "old_user", "anon-1");

    const call = fetchCalls[0]!;
    expect(call.url.pathname).toBe("/v1/alias");
    const body = parseBody(call);
    expect(body["userId"]).toBe("new_user");
    expect(body["previousId"]).toBe("old_user");
  });

  it("alias() falls back to anonymousId as previousId when previousUserId is undefined", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.alias?.("new_user", undefined, "anon-1");

    const body = parseBody(fetchCalls[0]!);
    expect(body["previousId"]).toBe("anon-1");
  });

  it("page() POSTs to /v1/page, translating properties via the global map only", async () => {
    const provider = createSegmentFetchProvider({
      writeKey: "test",
      propertyMap: { global: { referrer: "page_referrer" } },
    });

    await provider.page?.(makeEvent({ name: "Home", properties: { referrer: "google" }, userId: "user_7" }));

    const call = fetchCalls[0]!;
    expect(call.url.pathname).toBe("/v1/page");
    const body = parseBody(call);
    expect(body["name"]).toBe("Home");
    expect(body["userId"]).toBe("user_7");
    expect(body["anonymousId"]).toBe("anon-1");
    expect(body["properties"]).toEqual({ page_referrer: "google" });
  });

  it("page() with the empty-string name sentinel omits name", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.page?.(makeEvent({ name: "" }));

    expect(parseBody(fetchCalls[0]!)["name"]).toBeUndefined();
  });

  it("screen() POSTs to /v1/screen", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.screen?.(makeEvent({ name: "Onboarding", properties: { step: 1 }, userId: "user_9" }));

    const call = fetchCalls[0]!;
    expect(call.url.pathname).toBe("/v1/screen");
    const body = parseBody(call);
    expect(body["name"]).toBe("Onboarding");
    expect(body["userId"]).toBe("user_9");
    expect(body["anonymousId"]).toBe("anon-1");
    expect(body["properties"]).toEqual({ step: 1 });
  });

  it("host config override is honored", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test", host: "https://custom.example.com" });

    await provider.track(makeEvent());

    expect(fetchCalls[0]!.url.origin).toBe("https://custom.example.com");
  });

  it("capabilities matches the exact declared table (no batch key)", () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    expect(provider.capabilities).toEqual({
      identify: true,
      group: true,
      alias: true,
      page: true,
      screen: true,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
      runtimes: ["node", "browser", "edge", "bun", "deno"],
    });
    expect("batch" in provider.capabilities).toBe(false);
  });

  it("declares runtimes: fetch-only, no vendor SDK import", () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    expect(provider.capabilities.runtimes).toEqual(["node", "browser", "edge", "bun", "deno"]);
  });

  it("flush() resolves without calling fetch", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await expect(provider.flush?.()).resolves.toBeUndefined();
    expect(fetchCalls).toHaveLength(0);
  });

  it("destroy() resolves without calling fetch", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await expect(provider.destroy?.()).resolves.toBeUndefined();
    expect(fetchCalls).toHaveLength(0);
  });

  it("reset() makes no fetch call", () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    provider.reset?.();

    expect(fetchCalls).toHaveLength(0);
  });

  it("track() rejects when fetch resolves with a non-2xx response", async () => {
    fetchImpl = () => new Response("error", { status: 500 });
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await expect(provider.track(makeEvent())).rejects.toThrow();
  });

  it("track() rejects when fetch itself rejects", async () => {
    fetchImpl = () => {
      throw new Error("network error");
    };
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await expect(provider.track(makeEvent())).rejects.toThrow("network error");
  });
});

describe("createSegmentFetchProvider vs createSegmentProvider (mapping parity)", () => {
  // `createSegmentProvider` (SDK-based) requires `@segment/analytics-node`
  // to be mocked before `./index` is imported -- an in-memory fake capturing
  // the exact arguments passed to the vendor client's `track()`, mirroring
  // `./index.test.ts`'s own fake.
  interface TrackCall {
    userId?: string;
    anonymousId?: string;
    event: string;
    properties?: Record<string, unknown>;
    timestamp?: Date;
  }

  const trackCalls: TrackCall[] = [];

  class FakeAnalytics {
    track(props: TrackCall) {
      trackCalls.push(props);
    }
    identify() {}
    page() {}
    screen() {}
    group() {}
    alias() {}
    closeAndFlush() {
      return Promise.resolve();
    }
    flush() {
      return Promise.resolve();
    }
  }

  mock.module("@segment/analytics-node", () => ({ Analytics: FakeAnalytics }));

  it("produces the same translated event name/properties as createSegmentProvider for equivalent config", async () => {
    const { createSegmentProvider } = await import("./index");

    trackCalls.length = 0;
    const sdkProvider = createSegmentProvider({ writeKey: "test" });
    const fetchProvider = createSegmentFetchProvider({ writeKey: "test" });

    const event = makeEvent({
      name: "Purchase Completed",
      properties: { orderId: "o1", total: 42, unmapped: "value" },
      userId: "user_1",
      anonymousId: "anon-1",
    });

    sdkProvider.track(event);
    await fetchProvider.track(event);

    expect(trackCalls).toHaveLength(1);
    const sdkCall = trackCalls[0]!;
    const fetchBody = parseBody(fetchCalls[0]!);

    expect(fetchBody["event"]).toBe(sdkCall.event);
    expect(fetchBody["properties"]).toEqual(sdkCall.properties!);
    expect(fetchBody["userId"]).toBe(sdkCall.userId);
    expect(fetchBody["anonymousId"]).toBe(sdkCall.anonymousId);
  });
});
