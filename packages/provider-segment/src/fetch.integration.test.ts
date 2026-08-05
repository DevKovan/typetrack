import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createSegmentFetchProvider } from "./fetch";

// Integration test -- a real HTTP round-trip against a local Bun.serve()
// server standing in for Segment's HTTP Tracking API. Never talks to real
// Segment infrastructure or write keys. Same pattern as
// `packages/provider-ga4/src/index.integration.test.ts`.

interface RecordedRequest {
  path: string;
  authorization: string | null;
  contentType: string | null;
  body: Record<string, unknown>;
}

let server: ReturnType<typeof Bun.serve>;
let received: RecordedRequest[];
let respondWithStatus = 200;

beforeEach(() => {
  received = [];
  respondWithStatus = 200;
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = (await req.json()) as Record<string, unknown>;
      received.push({
        path: url.pathname,
        authorization: req.headers.get("authorization"),
        contentType: req.headers.get("content-type"),
        body,
      });
      return new Response(JSON.stringify({ success: true }), {
        status: respondWithStatus,
        headers: { "Content-Type": "application/json" },
      });
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

describe("createSegmentFetchProvider (integration)", () => {
  it("track()/identify()/flush()/destroy() sequence dispatches real HTTP requests to the correct endpoints", async () => {
    const provider = createSegmentFetchProvider({
      writeKey: "test-write-key",
      host: server.url.toString(),
    });

    await provider.identify?.("user_1", { plan: "pro" }, "anon-1");
    await provider.track(
      makeEvent({
        name: "Purchase Completed",
        properties: { orderId: "o1", total: 42 },
        userId: "user_1",
      }),
    );
    await provider.flush?.();
    await provider.destroy?.();

    expect(received).toHaveLength(2);

    for (const request of received) {
      expect(request.contentType).toBe("application/json");
      expect(request.authorization).toBe(`Basic ${btoa("test-write-key:")}`);
    }

    const identifyRequest = received[0]!;
    expect(identifyRequest.path).toBe("/v1/identify");
    expect(identifyRequest.body["userId"]).toBe("user_1");
    expect(identifyRequest.body["anonymousId"]).toBe("anon-1");
    expect(identifyRequest.body["traits"]).toEqual({ plan: "pro" });

    const trackRequest = received[1]!;
    expect(trackRequest.path).toBe("/v1/track");
    expect(trackRequest.body["event"]).toBe("Order Completed");
    expect(trackRequest.body["userId"]).toBe("user_1");
    expect(trackRequest.body["anonymousId"]).toBe("anon-1");
    expect(trackRequest.body["properties"]).toEqual({ order_id: "o1", revenue: 42 });
  });

  it("page()/screen()/group()/alias() each hit their own distinct endpoint", async () => {
    const provider = createSegmentFetchProvider({
      writeKey: "test-write-key",
      host: server.url.toString(),
    });

    await provider.page?.(makeEvent({ name: "Home", properties: { referrer: "google" } }));
    await provider.screen?.(makeEvent({ name: "Onboarding", properties: { step: 1 } }));
    await provider.group?.("group_1", { plan: "enterprise" }, { userId: "user_1", anonymousId: "anon-1" });
    await provider.alias?.("new_user", "old_user", "anon-1");

    expect(received.map((r) => r.path)).toEqual(["/v1/page", "/v1/screen", "/v1/group", "/v1/alias"]);

    expect(received[0]!.body["name"]).toBe("Home");
    expect(received[1]!.body["name"]).toBe("Onboarding");
    expect(received[2]!.body["groupId"]).toBe("group_1");
    expect(received[3]!.body["previousId"]).toBe("old_user");
  });

  it("track() rejects when the server responds with HTTP 500", async () => {
    respondWithStatus = 500;
    const provider = createSegmentFetchProvider({
      writeKey: "test-write-key",
      host: server.url.toString(),
    });

    await expect(provider.track(makeEvent())).rejects.toThrow();
    expect(received).toHaveLength(1);
  });
});
