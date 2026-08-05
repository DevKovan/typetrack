import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "typetrack";
import { createPostHogFetchProvider } from "./fetch";

// Integration test -- a real HTTP round-trip against a local Bun.serve()
// server standing in for PostHog's `{host}/capture/`+`/batch/` ingestion
// endpoints, driven end-to-end through a real `typetrack` `Analytics`
// instance (not the adapter's methods called directly). Never talks to real
// PostHog infrastructure or credentials. Mirrors
// `packages/provider-posthog/src/index.integration.test.ts`'s own real-HTTP
// conventions for its SDK-based sibling.

interface RecordedRequest {
  path: string;
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
      received.push({ path: url.pathname, body });
      return new Response(JSON.stringify({ status: 1 }), {
        status: respondWithStatus,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
});

afterEach(() => {
  server.stop(true);
});

describe("createPostHogFetchProvider (integration)", () => {
  it("a real typetrack Analytics instance drives track()/identify()/flush()/destroy() end-to-end through the fetch provider", async () => {
    const analytics = createAnalytics({
      provider: createPostHogFetchProvider({ apiKey: "test-key", host: server.url.toString() }),
    });

    analytics.identify("user_1", { plan: "pro" });
    await analytics.track("Purchase Completed", { orderId: "o1", total: 42 });
    await analytics.flush();
    await analytics.destroy();

    expect(received).toHaveLength(2);

    const identifyRequest = received.find((r) => r.body["event"] === "$identify");
    expect(identifyRequest).toBeDefined();
    expect(identifyRequest?.path).toBe("/capture/");
    expect(identifyRequest?.body["distinct_id"]).toBe("user_1");
    expect(identifyRequest?.body["properties"]).toEqual({ $set: { plan: "pro" } });

    const trackRequest = received.find((r) => r.body["event"] === "Purchase Completed");
    expect(trackRequest).toBeDefined();
    expect(trackRequest?.path).toBe("/capture/");
    expect(trackRequest?.body["api_key"]).toBe("test-key");
    expect(trackRequest?.body["properties"]).toEqual({ orderId: "o1", total: 42 });
  });

  it("trackBatch() POSTs a real single /batch/ request containing all translated events", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key", host: server.url.toString() });

    await provider.trackBatch?.([
      { name: "Purchase Completed", properties: { total: 1 }, timestamp: 1_700_000_000_000, anonymousId: "anon-1", sessionId: "s1" },
      { name: "Product Viewed", properties: { total: 2 }, timestamp: 1_700_000_000_001, anonymousId: "anon-1", sessionId: "s1" },
      { name: "Search Performed", properties: { total: 3 }, timestamp: 1_700_000_000_002, anonymousId: "anon-1", sessionId: "s1" },
    ]);

    expect(received).toHaveLength(1);
    const request = received[0]!;
    expect(request.path).toBe("/batch/");
    const batch = request.body["batch"] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(3);
    expect(batch.map((e) => e["event"])).toEqual(["Purchase Completed", "Product Viewed", "Search Performed"]);
  });

  it("track() rejects when the real server responds with HTTP 500, and destroy() still resolves cleanly afterward", async () => {
    respondWithStatus = 500;
    const provider = createPostHogFetchProvider({ apiKey: "test-key", host: server.url.toString() });

    await expect(
      provider.track({
        name: "Purchase Completed",
        properties: {},
        timestamp: 1_700_000_000_000,
        anonymousId: "anon-1",
        sessionId: "s1",
      }),
    ).rejects.toThrow();

    expect(received).toHaveLength(1);

    await expect(provider.destroy?.()).resolves.toBeUndefined();
    expect(received).toHaveLength(1);
  });

  it("group() and alias() reach the real server with the documented $groupidentify/$create_alias shapes", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key", host: server.url.toString() });

    await provider.group?.("acme", { plan: "pro" }, { anonymousId: "anon-1" });
    await provider.alias?.("user_new", "user_old", "anon-1");

    expect(received).toHaveLength(2);

    const groupRequest = received.find((r) => r.body["event"] === "$groupidentify");
    expect(groupRequest?.body["properties"]).toEqual({ $group_type: "group", $group_key: "acme", $group_set: { plan: "pro" } });

    const aliasRequest = received.find((r) => r.body["event"] === "$create_alias");
    expect(aliasRequest?.body["distinct_id"]).toBe("user_new");
    expect(aliasRequest?.body["properties"]).toEqual({ alias: "user_old" });
  });
});
