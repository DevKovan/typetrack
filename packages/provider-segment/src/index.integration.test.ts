import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createSegmentProvider } from "./index";

// Integration test -- a real HTTP round-trip against a local Bun.serve()
// server standing in for Segment's `{host}{path}` ingestion endpoint. Never
// talks to real Segment infrastructure or write keys.

interface RecordedRequest {
  path: string;
  body: unknown;
}

let server: ReturnType<typeof Bun.serve>;
let received: RecordedRequest[];

beforeEach(() => {
  received = [];
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      let body: unknown;
      if (req.method === "POST") {
        const bytes = new Uint8Array(await req.arrayBuffer());
        const decoded =
          req.headers.get("content-encoding") === "gzip" ? Bun.gunzipSync(bytes) : bytes;
        body = JSON.parse(new TextDecoder().decode(decoded));
      }
      received.push({ path: url.pathname, body });
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
});

afterEach(() => {
  server.stop(true);
});

describe("createSegmentProvider (integration)", () => {
  it("sends track() and identify() calls to the local server's /v1/batch endpoint", async () => {
    const provider = createSegmentProvider({
      writeKey: "test",
      host: server.url.toString(),
    });

    provider.identify?.("user_1", { plan: "pro" });
    provider.track("signup_completed", { plan: "pro" }, { timestamp: 1_700_000_000_000 });

    await provider.flush?.();

    const batchRequests = received.filter((r) => r.path === "/v1/batch");
    expect(batchRequests.length).toBeGreaterThan(0);

    const events = batchRequests.flatMap(
      (r) => (r.body as { batch: Array<Record<string, unknown>> }).batch,
    );

    const identifyEvent = events.find((e) => e["type"] === "identify");
    expect(identifyEvent).toBeDefined();
    expect(identifyEvent?.["userId"]).toBe("user_1");
    expect(identifyEvent?.["anonymousId"]).toBeDefined();
    const identifyTraits = identifyEvent?.["traits"] as Record<string, unknown>;
    expect(identifyTraits?.["plan"]).toBe("pro");

    const trackEvent = events.find((e) => e["type"] === "track");
    expect(trackEvent).toBeDefined();
    expect(trackEvent?.["event"]).toBe("signup_completed");
    expect(trackEvent?.["userId"]).toBe("user_1");
    expect(trackEvent?.["anonymousId"]).toBe(identifyEvent?.["anonymousId"]);
    const trackProperties = trackEvent?.["properties"] as Record<string, unknown>;
    expect(trackProperties?.["plan"]).toBe("pro");
    expect(trackEvent?.["timestamp"]).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("sends page() calls to /v1/batch with name/props folded into properties", async () => {
    const provider = createSegmentProvider({
      writeKey: "test",
      host: server.url.toString(),
    });

    provider.page?.("Home", { referrer: "google" });
    await provider.flush?.();

    const batchRequests = received.filter((r) => r.path === "/v1/batch");
    const events = batchRequests.flatMap(
      (r) => (r.body as { batch: Array<Record<string, unknown>> }).batch,
    );

    const pageEvent = events.find((e) => e["type"] === "page");
    expect(pageEvent).toBeDefined();
    expect(pageEvent?.["name"]).toBe("Home");
    expect(pageEvent?.["anonymousId"]).toBeDefined();
    const properties = pageEvent?.["properties"] as Record<string, unknown>;
    expect(properties?.["referrer"]).toBe("google");
  });

  it("track() before identify() sends only anonymousId (no userId) to the server", async () => {
    const provider = createSegmentProvider({
      writeKey: "test",
      host: server.url.toString(),
    });

    provider.track("anon_event", {}, { timestamp: 1_700_000_000_000 });
    await provider.flush?.();

    const batchRequests = received.filter((r) => r.path === "/v1/batch");
    const events = batchRequests.flatMap(
      (r) => (r.body as { batch: Array<Record<string, unknown>> }).batch,
    );

    const trackEvent = events.find((e) => e["event"] === "anon_event");
    expect(trackEvent).toBeDefined();
    expect(trackEvent?.["userId"]).toBeFalsy();
    expect(trackEvent?.["anonymousId"]).toBeDefined();
  });
});
