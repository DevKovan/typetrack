import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createPostHogProvider } from "./index";

// Integration test -- a real HTTP round-trip against a local Bun.serve()
// server standing in for PostHog's ingestion endpoint. Never talks to real
// PostHog infrastructure or credentials.

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
      return new Response(JSON.stringify({ status: 1 }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
});

afterEach(() => {
  server.stop(true);
});

describe("createPostHogProvider (integration)", () => {
  it("sends track() and identify() calls to the local server's /batch/ endpoint", async () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      host: server.url.toString(),
      flushAt: 1,
    });

    provider.identify?.("user_1", { plan: "pro" });
    provider.track("signup_completed", { plan: "pro" }, { timestamp: 1_700_000_000_000 });

    await provider.flush?.();

    const batchRequests = received.filter((r) => r.path === "/batch/");
    expect(batchRequests.length).toBeGreaterThan(0);

    const events = batchRequests.flatMap((r) => (r.body as { batch: Array<Record<string, unknown>> }).batch);

    const identifyEvent = events.find((e) => e["event"] === "$identify");
    expect(identifyEvent).toBeDefined();
    expect(identifyEvent?.["distinct_id"]).toBe("user_1");

    const trackEvent = events.find((e) => e["event"] === "signup_completed");
    expect(trackEvent).toBeDefined();
    expect(trackEvent?.["distinct_id"]).toBe("user_1");
    const properties = trackEvent?.["properties"] as Record<string, unknown>;
    expect(properties?.["plan"]).toBe("pro");
    expect(trackEvent?.["timestamp"]).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("sends page() calls as a $pageview event to /batch/", async () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      host: server.url.toString(),
      flushAt: 1,
    });

    provider.page?.("Home", { referrer: "google" });
    await provider.flush?.();

    const batchRequests = received.filter((r) => r.path === "/batch/");
    const events = batchRequests.flatMap((r) => (r.body as { batch: Array<Record<string, unknown>> }).batch);

    const pageviewEvent = events.find((e) => e["event"] === "$pageview");
    expect(pageviewEvent).toBeDefined();
    const properties = pageviewEvent?.["properties"] as Record<string, unknown>;
    expect(properties?.["name"]).toBe("Home");
    expect(properties?.["referrer"]).toBe("google");
  });
});
