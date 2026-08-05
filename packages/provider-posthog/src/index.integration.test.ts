import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createPostHogProvider } from "./index";
import { PostHog as RealPostHogCheck } from "posthog-node";

console.log(
  "[DIAG]",
  "PostHog.name=" + RealPostHogCheck.name,
  "ctor.length=" + RealPostHogCheck.length,
  "proto.capture=" + typeof RealPostHogCheck.prototype.capture,
  "proto.groupIdentify=" + typeof RealPostHogCheck.prototype.groupIdentify,
);

// Integration test -- a real HTTP round-trip against a local Bun.serve()
// server standing in for PostHog's ingestion endpoint (`{host}/batch/`).
// Never talks to real PostHog infrastructure or credentials.

interface RecordedRequest {
  path: string;
  body: unknown;
}

let server: ReturnType<typeof Bun.serve>;
let received: RecordedRequest[];
// Explicit `127.0.0.1`, never `server.url`'s default `localhost` hostname:
// posthog-node's internal HTTP client resolves "localhost" independently of
// Bun's own resolver, and on some CI runners that resolves to `::1` first --
// a hostname `Bun.serve()`'s own default (unspecified) bind doesn't
// necessarily cover, causing every request to silently never arrive. Binding
// and addressing by the literal loopback IPv4 address removes the DNS
// resolution step (and its cross-environment ambiguity) entirely.
let serverUrl: string;

beforeEach(() => {
  received = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
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
  serverUrl = `http://127.0.0.1:${server.port}`;
});

afterEach(() => {
  server.stop(true);
});

function batchEvents(): Array<Record<string, unknown>> {
  return received
    .filter((r) => r.path === "/batch/")
    .flatMap((r) => (r.body as { batch: Array<Record<string, unknown>> }).batch);
}

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

describe("createPostHogProvider (integration)", () => {
  it("sends track() calls with distinctId derived directly from the event, before and after a simulated identity change", async () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      host: serverUrl,
      flushAt: 1,
    });

    provider.track(makeEvent({ name: "Purchase Completed", anonymousId: "anon-1", userId: undefined }));
    provider.track(makeEvent({ name: "Purchase Completed", anonymousId: "anon-1", userId: "user_1" }));

    await provider.flush?.();

    const events = batchEvents().filter((e) => e["event"] === "Purchase Completed");
    expect(events).toHaveLength(2);
    expect(events[0]?.["distinct_id"]).toBe("anon-1");
    expect(events[1]?.["distinct_id"]).toBe("user_1");
    expect(events[1]?.["timestamp"]).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("sends page() calls as a $pageview event to /batch/", async () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      host: serverUrl,
      flushAt: 1,
    });

    provider.page?.(makeEvent({ name: "Home", properties: { referrer: "google" } }));
    await provider.flush?.();

    const pageviewEvent = batchEvents().find((e) => e["event"] === "$pageview");
    expect(pageviewEvent).toBeDefined();
    const properties = pageviewEvent?.["properties"] as Record<string, unknown>;
    expect(properties?.["name"]).toBe("Home");
    expect(properties?.["referrer"]).toBe("google");
  });

  it("sends screen() calls as a $screen event to /batch/", async () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      host: serverUrl,
      flushAt: 1,
    });

    provider.screen?.(makeEvent({ name: "Onboarding", properties: { step: 1 } }));
    await provider.flush?.();

    const screenEvent = batchEvents().find((e) => e["event"] === "$screen");
    expect(screenEvent).toBeDefined();
    const properties = screenEvent?.["properties"] as Record<string, unknown>;
    expect(properties?.["name"]).toBe("Onboarding");
    expect(properties?.["step"]).toBe(1);
  });

  it("sends group() calls with the fixed groupType/groupKey to /batch/", async () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      host: serverUrl,
      flushAt: 1,
    });

    provider.group?.("acme", { plan: "pro" }, { anonymousId: "anon-1" });
    await provider.flush?.();

    const groupEvent = batchEvents().find((e) => e["event"] === "$groupidentify");
    expect(groupEvent).toBeDefined();
    const properties = groupEvent?.["properties"] as Record<string, unknown>;
    expect(properties?.["$group_type"]).toBe("group");
    expect(properties?.["$group_key"]).toBe("acme");
    expect(properties?.["$group_set"]).toEqual({ plan: "pro" });
  });

  it("sends alias() calls with the correct distinctId/alias fields to /batch/", async () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      host: serverUrl,
      flushAt: 1,
    });

    provider.alias?.("user_new", "user_old", "anon-1");
    await provider.flush?.();

    const aliasEvent = batchEvents().find((e) => e["event"] === "$create_alias");
    expect(aliasEvent).toBeDefined();
    expect(aliasEvent?.["distinct_id"]).toBe("user_new");
    const properties = aliasEvent?.["properties"] as Record<string, unknown>;
    expect(properties?.["alias"]).toBe("user_old");
  });

  it("destroy() flushes pending events and the server receives no further requests after it resolves", async () => {
    const provider = createPostHogProvider({
      apiKey: "test",
      host: serverUrl,
      flushAt: 10,
      flushInterval: 60_000,
    });

    provider.track(makeEvent({ name: "Purchase Completed" }));

    await provider.destroy?.();

    const events = batchEvents().filter((e) => e["event"] === "Purchase Completed");
    expect(events).toHaveLength(1);

    const requestCountAfterDestroy = received.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received.length).toBe(requestCountAfterDestroy);
  });
});
