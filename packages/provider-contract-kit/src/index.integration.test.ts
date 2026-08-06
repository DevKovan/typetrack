import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AnalyticsProvider, CanonicalEvent } from "typetrack";
import { runProviderContractTests, type ProviderContractHarness } from "./index";

// Integration test -- a real HTTP round-trip against a local Bun.serve()
// server, driving a hand-written fetch-based `AnalyticsProvider` end-to-end
// through `runProviderContractTests` itself, proving the kit's assertions
// hold against a provider whose transport does genuine network I/O (not
// just synchronous in-memory fakes, which is what `index.test.ts` covers).
// Never talks to real vendor infrastructure -- mirrors
// `packages/provider-posthog/src/fetch.integration.test.ts`'s own
// real-HTTP conventions.

interface RecordedRequest {
  path: string;
  body: unknown;
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
      const body = await req.json().catch(() => undefined);
      received.push({ path: url.pathname, body });
      return new Response(null, { status: respondWithStatus });
    },
  });
});

afterEach(() => {
  server.stop(true);
});

function makeHttpProvider(baseUrl: string): AnalyticsProvider {
  async function post(path: string, body: unknown): Promise<void> {
    const response = await fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`request to ${path} failed with status ${response.status}`);
    }
  }

  return {
    name: "fake-http-provider",
    capabilities: {
      identify: false,
      group: false,
      alias: false,
      page: true,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },
    async track(event: CanonicalEvent) {
      await post("/track", event);
    },
    async page(event: CanonicalEvent) {
      await post("/page", event);
    },
    async flush() {
      await post("/flush", {});
    },
    async destroy() {
      await post("/destroy", {});
    },
  };
}

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "Test Event",
    properties: {},
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    sessionId: "session-1",
    ...overrides,
  };
}

const harness: ProviderContractHarness = {
  name: "Fake HTTP provider (integration)",
  createProvider: () => makeHttpProvider(server.url.toString()),
  createFailingProvider: () => {
    respondWithStatus = 500;
    return makeHttpProvider(server.url.toString());
  },
  makeEvent,
};

// Runs the full generic contract suite against a provider whose transport is
// a real HTTP client hitting a real local server.
runProviderContractTests(harness);

describe("fake HTTP provider transport (sanity check the contract suite above actually exercised real I/O)", () => {
  it("track() performs a real POST request that the local server actually receives", async () => {
    const provider = harness.createProvider();

    await provider.track(harness.makeEvent({ name: "Purchase Completed", properties: { total: 42 } }));

    expect(received).toHaveLength(1);
    const request = received[0]!;
    expect(request.path).toBe("/track");
    expect((request.body as CanonicalEvent).name).toBe("Purchase Completed");
    expect((request.body as CanonicalEvent).properties).toEqual({ total: 42 });
  });

  it("a failing provider's track() rejects only after the real server actually responded with a non-2xx status", async () => {
    const provider = harness.createFailingProvider();

    await expect(provider.track(harness.makeEvent())).rejects.toThrow();

    expect(received).toHaveLength(1);
    expect(received[0]?.path).toBe("/track");
  });
});
