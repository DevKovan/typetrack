import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createSegmentProvider } from "./index";
import { Analytics as RealAnalyticsCheck } from "@segment/analytics-node";

console.log(
  "[DIAG]",
  "Analytics.name=" + RealAnalyticsCheck.name,
  "ctor.length=" + RealAnalyticsCheck.length,
  "proto.page=" + typeof RealAnalyticsCheck.prototype.page,
  "proto.track=" + typeof RealAnalyticsCheck.prototype.track,
  "proto.group=" + typeof RealAnalyticsCheck.prototype.group,
);

// Integration test -- a real HTTP round-trip against a local Bun.serve()
// server standing in for Segment's `{host}{path}` ingestion endpoint. Never
// talks to real Segment infrastructure or write keys.

interface RecordedRequest {
  path: string;
  body: unknown;
}

let server: ReturnType<typeof Bun.serve>;
let received: RecordedRequest[];
// Explicit `127.0.0.1`, never `server.url`'s default `localhost` hostname:
// @segment/analytics-node's internal HTTP client resolves "localhost"
// independently of Bun's own resolver, and on some CI runners that resolves
// to `::1` first -- a hostname `Bun.serve()`'s own default (unspecified)
// bind doesn't necessarily cover, causing every request to silently never
// arrive. Binding and addressing by the literal loopback IPv4 address
// removes the DNS resolution step (and its cross-environment ambiguity)
// entirely.
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
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  serverUrl = `http://127.0.0.1:${server.port}`;
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

function batchEvents(requests: RecordedRequest[]): Array<Record<string, unknown>> {
  return requests
    .filter((r) => r.path === "/v1/batch")
    .flatMap((r) => (r.body as { batch: Array<Record<string, unknown>> }).batch);
}

describe("createSegmentProvider (integration)", () => {
  it("track() -> flush() -> track() again -> group()/alias()/screen() -> destroy() drains everything and is the true end-of-lifecycle op", async () => {
    const provider = createSegmentProvider({
      writeKey: "test",
      host: serverUrl,
    });

    // 1. track() -> flush() -> assert the local server received the batch.
    provider.track(
      makeEvent({
        name: "Purchase Completed",
        properties: { orderId: "o1", total: 42 },
        userId: "user_1",
      }),
    );
    await provider.flush?.();

    let events = batchEvents(received);
    expect(events).toHaveLength(1);
    const firstTrack = events[0]!;
    expect(firstTrack["type"]).toBe("track");
    expect(firstTrack["event"]).toBe("Order Completed");
    expect(firstTrack["userId"]).toBe("user_1");
    expect(firstTrack["anonymousId"]).toBe("anon-1");
    const firstProps = firstTrack["properties"] as Record<string, unknown>;
    expect(firstProps["order_id"]).toBe("o1");
    expect(firstProps["revenue"]).toBe(42);

    // 2. track() again -- proves the adapter is still usable post-flush(),
    // the core regression test for this issue. No error is thrown, and this
    // event is genuinely queued (verified below once it reaches the server
    // via a later flush triggered by destroy()).
    provider.track(makeEvent({ name: "Second Event", properties: {} }));

    // 3. group() -> alias() -> screen().
    provider.group?.("group_1", { plan: "enterprise" }, { userId: "user_1", anonymousId: "anon-1" });
    provider.alias?.("new_user", "user_1", "anon-1");
    provider.screen?.(makeEvent({ name: "Onboarding", properties: { step: 1 }, userId: "user_1" }));

    // 4. destroy() -- the true end-of-lifecycle operation: drains the
    // remaining queue (track()/group()/alias()/screen() above), then closes.
    await provider.destroy?.();

    events = batchEvents(received);
    // The initial "Order Completed" track, plus the second track, group,
    // alias, and screen calls -- five events total, all delivered by the
    // time destroy() resolves.
    expect(events.length).toBeGreaterThanOrEqual(5);

    const secondTrack = events.find((e) => e["event"] === "Second Event");
    expect(secondTrack).toBeDefined();
    expect(secondTrack?.["type"]).toBe("track");

    const groupEvent = events.find((e) => e["type"] === "group");
    expect(groupEvent).toBeDefined();
    expect(groupEvent?.["groupId"]).toBe("group_1");
    expect(groupEvent?.["userId"]).toBe("user_1");
    expect(groupEvent?.["anonymousId"]).toBe("anon-1");
    const groupTraits = groupEvent?.["traits"] as Record<string, unknown> | undefined;
    expect(groupTraits?.["plan"]).toBe("enterprise");

    const aliasEvent = events.find((e) => e["type"] === "alias");
    expect(aliasEvent).toBeDefined();
    expect(aliasEvent?.["userId"]).toBe("new_user");
    expect(aliasEvent?.["previousId"]).toBe("user_1");

    const screenEvent = events.find((e) => e["type"] === "screen");
    expect(screenEvent).toBeDefined();
    expect(screenEvent?.["name"]).toBe("Onboarding");
    expect(screenEvent?.["userId"]).toBe("user_1");
    const screenProps = screenEvent?.["properties"] as Record<string, unknown>;
    expect(screenProps["step"]).toBe(1);

    // destroy() is terminal: further calls make no new requests reach the
    // server.
    const countAfterDestroy = received.length;
    provider.track(makeEvent({ name: "After Destroy" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received.length).toBe(countAfterDestroy);
  });

  it("sends page() calls to /v1/batch with name/properties translated via the global map", async () => {
    const provider = createSegmentProvider({
      writeKey: "test",
      host: serverUrl,
      propertyMap: { global: { referrer: "page_referrer" } },
    });

    provider.page?.(makeEvent({ name: "Home", properties: { referrer: "google" } }));
    await provider.flush?.();

    const events = batchEvents(received);
    const pageEvent = events.find((e) => e["type"] === "page");
    expect(pageEvent).toBeDefined();
    expect(pageEvent?.["name"]).toBe("Home");
    expect(pageEvent?.["anonymousId"]).toBeDefined();
    const properties = pageEvent?.["properties"] as Record<string, unknown>;
    expect(properties["page_referrer"]).toBe("google");
  });

  it("track() before identify() sends only anonymousId (no userId) to the server", async () => {
    const provider = createSegmentProvider({
      writeKey: "test",
      host: serverUrl,
    });

    provider.track(makeEvent({ name: "Anon Event", userId: undefined }));
    await provider.flush?.();

    const events = batchEvents(received);
    const trackEvent = events.find((e) => e["event"] === "Anon Event");
    expect(trackEvent).toBeDefined();
    expect(trackEvent?.["userId"]).toBeFalsy();
    expect(trackEvent?.["anonymousId"]).toBeDefined();
  });

  it("an unmapped event name passes through unchanged to the server", async () => {
    const provider = createSegmentProvider({
      writeKey: "test",
      host: serverUrl,
    });

    provider.track(makeEvent({ name: "Totally Custom Event" }));
    await provider.flush?.();

    const events = batchEvents(received);
    const trackEvent = events.find((e) => e["type"] === "track");
    expect(trackEvent?.["event"]).toBe("Totally Custom Event");
  });
});
