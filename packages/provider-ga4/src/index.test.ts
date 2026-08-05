import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createGA4Provider } from "./index";

// Unit tests -- no real network I/O. `globalThis.fetch` is stubbed before
// each test and restored afterward.

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: URL;
  init?: RequestInit;
}

let fetchCalls: FetchCall[];
let fetchImpl: (url: URL, init?: RequestInit) => Promise<Response> | Response;

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = () => new Response(null, { status: 204 });
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

describe("createGA4Provider (unit)", () => {
  it("track() calls fetch with correct query params, method, and body", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await provider.track(
      makeEvent({ name: "Custom Event", properties: { plan: "pro" }, anonymousId: "anon-1" }),
    );

    expect(fetchCalls.length).toBe(1);
    const call = fetchCalls[0]!;
    expect(call.url.pathname).toBe("/mp/collect");
    expect(call.url.searchParams.get("measurement_id")).toBe("G-TEST");
    expect(call.url.searchParams.get("api_secret")).toBe("secret");
    expect(call.init?.method).toBe("POST");

    const body = parseBody(call);
    expect(body["client_id"]).toBe("anon-1");
    expect(body["events"]).toEqual([{ name: "Custom Event", params: { plan: "pro" } }]);
    expect(body["timestamp_micros"]).toBe(1_700_000_000_000 * 1000);
  });

  it("translates a default-mapped canonical event name", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await provider.track(makeEvent({ name: "Purchase Completed", properties: {} }));

    const body = parseBody(fetchCalls[0]!);
    expect((body["events"] as Array<{ name: string }>)[0]!.name).toBe("purchase");
  });

  it("passes an unmapped event name through unchanged and warns exactly once per name", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

      await provider.track(makeEvent({ name: "Totally Custom Event" }));
      await provider.track(makeEvent({ name: "Totally Custom Event" }));

      const body = parseBody(fetchCalls[0]!);
      expect((body["events"] as Array<{ name: string }>)[0]!.name).toBe("Totally Custom Event");
      expect(warnSpy).toHaveBeenCalledTimes(1);

      await provider.track(makeEvent({ name: "Another Custom Event" }));
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("eventMap override wins over the default for a colliding key", async () => {
    const provider = createGA4Provider({
      measurementId: "G-TEST",
      apiSecret: "secret",
      eventMap: { "Purchase Completed": "custom_purchase" },
    });

    await provider.track(makeEvent({ name: "Purchase Completed" }));

    const body = parseBody(fetchCalls[0]!);
    expect((body["events"] as Array<{ name: string }>)[0]!.name).toBe("custom_purchase");
  });

  it("eventMap override introduces a brand-new canonical event name", async () => {
    const provider = createGA4Provider({
      measurementId: "G-TEST",
      apiSecret: "secret",
      eventMap: { "Newsletter Subscribed": "newsletter_signup" },
    });

    await provider.track(makeEvent({ name: "Newsletter Subscribed" }));

    const body = parseBody(fetchCalls[0]!);
    expect((body["events"] as Array<{ name: string }>)[0]!.name).toBe("newsletter_signup");
  });

  it("propertyMap: per-event override beats global, global is fallback, unmapped keys pass through", async () => {
    const provider = createGA4Provider({
      measurementId: "G-TEST",
      apiSecret: "secret",
      propertyMap: {
        global: { orderId: "global_order_id", currency: "currency" },
        events: {
          "Purchase Completed": { orderId: "per_event_order_id" },
        },
      },
    });

    await provider.track(
      makeEvent({
        name: "Purchase Completed",
        properties: { orderId: "o1", total: 42, currency: "USD", unmappedKey: "value" },
      }),
    );

    const body = parseBody(fetchCalls[0]!);
    const params = (body["events"] as Array<{ params: Record<string, unknown> }>)[0]!.params;
    // per-event override ("per_event_order_id") beats both the global
    // override and the default ("transaction_id") for the same key.
    expect(params["per_event_order_id"]).toBe("o1");
    expect(params["global_order_id"]).toBeUndefined();
    expect(params["orderId"]).toBeUndefined();
    // default per-event mapping still applies for keys not overridden.
    expect(params["value"]).toBe(42);
    // global mapping applies as a fallback for keys with no per-event entry.
    expect(params["currency"]).toBe("USD");
    // unmapped keys pass through unchanged.
    expect(params["unmappedKey"]).toBe("value");
  });

  it("two track() calls with different event.anonymousId values produce different client_ids", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await provider.track(makeEvent({ anonymousId: "anon-a" }));
    await provider.track(makeEvent({ anonymousId: "anon-b" }));

    const bodyA = parseBody(fetchCalls[0]!);
    const bodyB = parseBody(fetchCalls[1]!);
    expect(bodyA["client_id"]).toBe("anon-a");
    expect(bodyB["client_id"]).toBe("anon-b");
    expect(bodyA["client_id"]).not.toBe(bodyB["client_id"]);
  });

  it("track()'s user_id comes from event.userId when defined", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await provider.track(makeEvent({ userId: "user_1" }));
    await provider.track(makeEvent({ userId: undefined }));

    const bodyWithUser = parseBody(fetchCalls[0]!);
    const bodyWithoutUser = parseBody(fetchCalls[1]!);
    expect(bodyWithUser["user_id"]).toBe("user_1");
    expect(bodyWithoutUser["user_id"]).toBeUndefined();
  });

  it("identify() triggers zero fetch calls (3-arg signature)", () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    provider.identify?.("user_1", { plan: "pro" }, "anon-1");

    expect(fetchCalls.length).toBe(0);
  });

  it("track() after identify() includes user_properties but no adapter-stored userId leaks in", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    provider.identify?.("user_1", { plan: "pro" }, "anon-1");
    await provider.track(makeEvent({ userId: undefined }));

    const body = parseBody(fetchCalls[0]!);
    expect(body["user_properties"]).toEqual({ plan: { value: "pro" } });
    // identify()'s userId argument is not stored by the adapter -- only
    // event.userId (undefined here) determines user_id.
    expect(body["user_id"]).toBeUndefined();
  });

  it("reset() clears currentUserProperties so a subsequent track() has no user_properties", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    provider.identify?.("user_1", { plan: "pro" }, "anon-1");
    provider.reset?.();
    await provider.track(makeEvent());

    const body = parseBody(fetchCalls[0]!);
    expect(body["user_properties"]).toBeUndefined();
  });

  it("page() sends a page_view event with globally-translated properties", async () => {
    const provider = createGA4Provider({
      measurementId: "G-TEST",
      apiSecret: "secret",
      propertyMap: { global: { referrer: "page_referrer" } },
    });

    await provider.page?.(makeEvent({ name: "Home", properties: { referrer: "google" } }));

    const body = parseBody(fetchCalls[0]!);
    expect(body["events"]).toEqual([
      { name: "page_view", params: { page_title: "Home", page_referrer: "google" } },
    ]);
  });

  it("page() with the empty-string name sentinel omits page_title", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await provider.page?.(makeEvent({ name: "", properties: { referrer: "google" } }));

    const body = parseBody(fetchCalls[0]!);
    const params = (body["events"] as Array<{ params: Record<string, unknown> }>)[0]!.params;
    expect("page_title" in params).toBe(false);
    expect(params["referrer"]).toBe("google");
  });

  it("capabilities matches the declared table exactly", () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    expect(provider.capabilities).toEqual({
      identify: true,
      group: false,
      alias: false,
      page: true,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
      runtimes: ["node", "browser", "edge", "bun", "deno"],
    });
    expect(provider.group).toBeUndefined();
    expect(provider.alias).toBeUndefined();
    expect(provider.screen).toBeUndefined();
  });

  it("declares runtimes: fetch-only, no Node-specific API usage", () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    expect(provider.capabilities.runtimes).toEqual(["node", "browser", "edge", "bun", "deno"]);
  });

  it("flush() resolves without calling fetch", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await expect(provider.flush?.()).resolves.toBeUndefined();
    expect(fetchCalls.length).toBe(0);
  });

  it("destroy() resolves and makes zero fetch calls", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await expect(provider.destroy?.()).resolves.toBeUndefined();
    expect(fetchCalls.length).toBe(0);
  });

  it("track() rejects when fetch resolves with a non-2xx response", async () => {
    fetchImpl = () => new Response("error", { status: 500 });
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await expect(provider.track(makeEvent())).rejects.toThrow();
  });

  it("track() rejects when fetch itself rejects", async () => {
    fetchImpl = () => {
      throw new Error("network error");
    };
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await expect(provider.track(makeEvent())).rejects.toThrow("network error");
  });
});
