import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createGA4Provider } from "./index";

// Integration test -- a real HTTP round-trip against a local Bun.serve()
// server standing in for GA4's Measurement Protocol `/mp/collect` endpoint.
// Never talks to real Google infrastructure or credentials.

interface RecordedRequest {
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
}

let server: ReturnType<typeof Bun.serve>;
let received: RecordedRequest[];
let respondWithStatus = 204;

beforeEach(() => {
  received = [];
  respondWithStatus = 204;
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = (await req.json()) as Record<string, unknown>;
      received.push({
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body,
      });
      return new Response(null, { status: respondWithStatus });
    },
  });
});

afterEach(() => {
  server.stop(true);
});

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

describe("createGA4Provider (integration)", () => {
  it("sends track(), identify(), and page() calls to the local /mp/collect endpoint", async () => {
    const provider = createGA4Provider({
      measurementId: "test",
      apiSecret: "test",
      apiHost: server.url.toString(),
    });

    provider.identify?.("user_1", { plan: "pro" }, "anon-1");
    await provider.track(
      makeEvent({ name: "Purchase Completed", properties: { orderId: "o1", total: 42 }, userId: "user_1" }),
    );
    await provider.page?.(makeEvent({ name: "Home", properties: { referrer: "google" }, userId: "user_1" }));

    expect(received.length).toBe(2);

    for (const request of received) {
      expect(request.path).toBe("/mp/collect");
      expect(request.query["measurement_id"]).toBe("test");
      expect(request.query["api_secret"]).toBe("test");
      expect(request.body["client_id"]).toBe("anon-1");
      expect(request.body["user_id"]).toBe("user_1");
      expect(request.body["user_properties"]).toEqual({ plan: { value: "pro" } });
    }

    const trackRequest = received[0]!;
    expect(trackRequest.body["events"]).toEqual([
      { name: "purchase", params: { transaction_id: "o1", value: 42 } },
    ]);
    expect(trackRequest.body["timestamp_micros"]).toBe(1_700_000_000_000 * 1000);

    const pageRequest = received[1]!;
    expect(pageRequest.body["events"]).toEqual([
      { name: "page_view", params: { page_title: "Home", referrer: "google" } },
    ]);
  });

  it("track() with an unmapped-then-mapped event name sequence produces the correct translated events[0]", async () => {
    const provider = createGA4Provider({
      measurementId: "test",
      apiSecret: "test",
      apiHost: server.url.toString(),
    });

    await provider.track(makeEvent({ name: "Totally Custom Event", properties: { foo: "bar" } }));
    await provider.track(makeEvent({ name: "Product Viewed", properties: { productId: "p1", name: "Widget" } }));

    expect(received.length).toBe(2);

    const unmapped = received[0]!;
    expect(unmapped.body["events"]).toEqual([{ name: "Totally Custom Event", params: { foo: "bar" } }]);

    const mapped = received[1]!;
    expect(mapped.body["events"]).toEqual([
      { name: "view_item", params: { item_id: "p1", item_name: "Widget" } },
    ]);
  });

  it("track() rejects when the server responds with HTTP 500", async () => {
    respondWithStatus = 500;
    const provider = createGA4Provider({
      measurementId: "test",
      apiSecret: "test",
      apiHost: server.url.toString(),
    });

    await expect(provider.track(makeEvent())).rejects.toThrow();

    expect(received.length).toBe(1);
  });

  it("destroy() resolves cleanly and the server receives no further requests after", async () => {
    const provider = createGA4Provider({
      measurementId: "test",
      apiSecret: "test",
      apiHost: server.url.toString(),
    });

    await provider.track(makeEvent({ name: "Purchase Completed", properties: { orderId: "o1", total: 42 } }));
    expect(received.length).toBe(1);

    await expect(provider.destroy?.()).resolves.toBeUndefined();

    expect(received.length).toBe(1);
  });
});
