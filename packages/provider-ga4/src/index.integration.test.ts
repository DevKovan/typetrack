import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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

describe("createGA4Provider (integration)", () => {
  it("sends track(), identify(), and page() calls to the local /mp/collect endpoint", async () => {
    const provider = createGA4Provider({
      measurementId: "test",
      apiSecret: "test",
      apiHost: server.url.toString(),
    });

    provider.identify?.("user_1", { plan: "pro" });
    await provider.track("signup_completed", { plan: "pro" }, { timestamp: 1_700_000_000_000 });
    await provider.page?.("Home", { referrer: "google" });

    expect(received.length).toBe(2);

    for (const request of received) {
      expect(request.path).toBe("/mp/collect");
      expect(request.query["measurement_id"]).toBe("test");
      expect(request.query["api_secret"]).toBe("test");
      expect(typeof request.body["client_id"]).toBe("string");
      expect(request.body["user_id"]).toBe("user_1");
      expect(request.body["user_properties"]).toEqual({ plan: { value: "pro" } });
    }

    const trackRequest = received[0]!;
    expect(trackRequest.body["events"]).toEqual([
      { name: "signup_completed", params: { plan: "pro" } },
    ]);
    expect(trackRequest.body["timestamp_micros"]).toBe(1_700_000_000_000 * 1000);

    const pageRequest = received[1]!;
    expect(pageRequest.body["events"]).toEqual([
      { name: "page_view", params: { page_title: "Home", referrer: "google" } },
    ]);
  });

  it("track() rejects when the server responds with HTTP 500", async () => {
    respondWithStatus = 500;
    const provider = createGA4Provider({
      measurementId: "test",
      apiSecret: "test",
      apiHost: server.url.toString(),
    });

    await expect(
      provider.track("signup_completed", {}, { timestamp: 1_700_000_000_000 }),
    ).rejects.toThrow();

    expect(received.length).toBe(1);
  });
});
