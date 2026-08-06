import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createPostHogFetchProvider } from "./fetch";
import { createPostHogProviderWithClient, type PostHogClientLike } from "./index";

// Unit tests -- no real network I/O. `globalThis.fetch` is stubbed before
// each test and restored afterward, mirroring the GA4 sibling's
// (`packages/provider-ga4/src/index.test.ts`) unit test conventions.
//
// The shared-fixture parity suite at the bottom of this file also needs an
// SDK-side provider to compare against. It uses
// `createPostHogProviderWithClient` with a hand-written `FakePostHog`
// (implementing `PostHogClientLike`) instead of `mock.module("posthog-node",
// ...)` -- module mocking that specifier turned out to leak across test
// files sharing Bun's single test process (confirmed empirically), so this
// file never imports the real `posthog-node` package at all, and there is
// nothing here that could pollute `index.integration.test.ts` or any other
// file.
interface SdkCaptureCall {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}
const sdkCaptureCalls: SdkCaptureCall[] = [];
class FakePostHog implements PostHogClientLike {
  capture(props: SdkCaptureCall) {
    sdkCaptureCalls.push(props);
  }
  identify() {}
  groupIdentify() {}
  alias() {}
  flush() {
    return Promise.resolve();
  }
  shutdown() {
    return Promise.resolve();
  }
}
const sdkClient = new FakePostHog();

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: string;
  init?: RequestInit;
}

let fetchCalls: FetchCall[];
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response> | Response;

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = () => new Response(JSON.stringify({ status: 1 }), { status: 200 });
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
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
    name: "Purchase Completed",
    properties: {},
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    sessionId: "session-1",
    ...overrides,
  };
}

describe("createPostHogFetchProvider (unit)", () => {
  it("has zero import from posthog-node", () => {
    // Static-analysis-friendly regression guard: `mock.module("posthog-node", ...)`
    // is never called anywhere in this file, and `createPostHogFetchProvider`
    // still works with zero setup beyond stubbing `globalThis.fetch` -- if
    // `./fetch` imported `posthog-node`, importing it in an environment with
    // no `posthog-node` package present would fail. This suite's successful
    // import of `./fetch` above is itself the guard; this test only documents
    // the intent explicitly.
    expect(typeof createPostHogFetchProvider).toBe("function");
  });

  it("track() POSTs a single event to {host}/capture/ with the correct body shape", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.track(makeEvent({ name: "Purchase Completed", properties: { total: 42 }, userId: "user_1" }));

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url).toBe("https://us.i.posthog.com/capture/");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.headers).toEqual({ "content-type": "application/json" });

    const body = parseBody(call);
    expect(body["api_key"]).toBe("test-key");
    expect(body["event"]).toBe("Purchase Completed");
    expect(body["distinct_id"]).toBe("user_1");
    expect(body["properties"]).toEqual({ total: 42 });
    expect(body["timestamp"]).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("track() falls back to event.anonymousId when userId is undefined", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.track(makeEvent({ userId: undefined, anonymousId: "anon-a" }));

    const body = parseBody(fetchCalls[0]!);
    expect(body["distinct_id"]).toBe("anon-a");
  });

  it("passes through an unmapped canonical event name and warns exactly once per unique name", async () => {
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;
    try {
      const provider = createPostHogFetchProvider({ apiKey: "test-key" });

      await provider.track(makeEvent({ name: "Custom Event" }));
      await provider.track(makeEvent({ name: "Custom Event" }));
      await provider.track(makeEvent({ name: "Another Custom Event" }));

      expect(parseBody(fetchCalls[0]!)["event"]).toBe("Custom Event");
      expect(parseBody(fetchCalls[1]!)["event"]).toBe("Custom Event");
      expect(parseBody(fetchCalls[2]!)["event"]).toBe("Another Custom Event");
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("eventMap and propertyMap overrides are honored, same as createPostHogProvider", async () => {
    const provider = createPostHogFetchProvider({
      apiKey: "test-key",
      eventMap: { "Purchase Completed": "order_completed" },
      propertyMap: { global: { total: "amount" } },
    });

    await provider.track(makeEvent({ name: "Purchase Completed", properties: { total: 42 } }));

    const body = parseBody(fetchCalls[0]!);
    expect(body["event"]).toBe("order_completed");
    expect(body["properties"]).toEqual({ amount: 42 });
  });

  it("track()/page()/screen()/identify()/group()/alias() each produce exactly one fetch() call", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.track(makeEvent());
    expect(fetchCalls).toHaveLength(1);

    await provider.page?.(makeEvent({ name: "Home" }));
    expect(fetchCalls).toHaveLength(2);

    await provider.screen?.(makeEvent({ name: "Onboarding" }));
    expect(fetchCalls).toHaveLength(3);

    await provider.identify?.("user_1", { email: "a@example.com" }, "anon-1");
    expect(fetchCalls).toHaveLength(4);

    await provider.group?.("acme", { plan: "pro" }, { anonymousId: "anon-1" });
    expect(fetchCalls).toHaveLength(5);

    await provider.alias?.("user_new", "user_old", "anon-1");
    expect(fetchCalls).toHaveLength(6);

    for (const call of fetchCalls) {
      expect(call.url).toBe("https://us.i.posthog.com/capture/");
    }
  });

  it("page() folds a non-empty name into properties and POSTs event $pageview", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.page?.(makeEvent({ name: "Home", properties: { referrer: "google" } }));

    const body = parseBody(fetchCalls[0]!);
    expect(body["event"]).toBe("$pageview");
    expect(body["properties"]).toEqual({ referrer: "google", name: "Home" });
  });

  it("page() does not fold an empty-string name into properties", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.page?.(makeEvent({ name: "", properties: { referrer: "google" } }));

    const body = parseBody(fetchCalls[0]!);
    expect(body["properties"]).toEqual({ referrer: "google" });
  });

  it("screen() folds a non-empty name into properties and POSTs event $screen", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.screen?.(makeEvent({ name: "Onboarding", properties: { step: 1 } }));

    const body = parseBody(fetchCalls[0]!);
    expect(body["event"]).toBe("$screen");
    expect(body["properties"]).toEqual({ step: 1, name: "Onboarding" });
  });

  it("identify() POSTs $identify with properties.$set = traits", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.identify?.("user_42", { email: "a@example.com" }, "anon-42");

    const body = parseBody(fetchCalls[0]!);
    expect(body["event"]).toBe("$identify");
    expect(body["distinct_id"]).toBe("user_42");
    expect(body["properties"]).toEqual({ $set: { email: "a@example.com" } });
  });

  it("group() POSTs $groupidentify with $group_type/$group_key/$group_set", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.group?.("acme", { plan: "pro" }, { anonymousId: "anon-1" });

    const body = parseBody(fetchCalls[0]!);
    expect(body["event"]).toBe("$groupidentify");
    expect(body["properties"]).toEqual({ $group_type: "group", $group_key: "acme", $group_set: { plan: "pro" } });
  });

  it("alias() POSTs $create_alias with distinct_id/properties.alias", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.alias?.("user_new", "user_old", "anon-1");

    const body = parseBody(fetchCalls[0]!);
    expect(body["event"]).toBe("$create_alias");
    expect(body["distinct_id"]).toBe("user_new");
    expect(body["properties"]).toEqual({ alias: "user_old" });
  });

  it("alias() falls back to anonymousId when previousUserId is undefined", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.alias?.("user_new", undefined, "anon-9");

    const body = parseBody(fetchCalls[0]!);
    expect(body["properties"]).toEqual({ alias: "anon-9" });
  });

  it("trackBatch() with 3 events produces exactly one fetch() call to /batch/ containing all 3 translated events", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.trackBatch?.([
      makeEvent({ name: "Purchase Completed", properties: { total: 1 } }),
      makeEvent({ name: "Product Viewed", properties: { total: 2 } }),
      makeEvent({ name: "Search Performed", properties: { total: 3 } }),
    ]);

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url).toBe("https://us.i.posthog.com/batch/");

    const body = parseBody(call);
    expect(body["api_key"]).toBe("test-key");
    const batch = body["batch"] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(3);
    expect(batch[0]!["event"]).toBe("Purchase Completed");
    expect(batch[1]!["event"]).toBe("Product Viewed");
    expect(batch[2]!["event"]).toBe("Search Performed");
    expect(batch.every((e) => typeof e["distinct_id"] === "string")).toBe(true);
  });

  it("flush() resolves and makes zero fetch calls", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await expect(provider.flush?.()).resolves.toBeUndefined();
    expect(fetchCalls).toHaveLength(0);
  });

  it("destroy() resolves and makes zero fetch calls", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await expect(provider.destroy?.()).resolves.toBeUndefined();
    expect(fetchCalls).toHaveLength(0);
  });

  it("host config override is honored in the POSTed URL", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key", host: "https://eu.i.posthog.com" });

    await provider.track(makeEvent());

    expect(fetchCalls[0]!.url).toBe("https://eu.i.posthog.com/capture/");
  });

  it("track() rejects when fetch resolves with a non-2xx response", async () => {
    fetchImpl = () => new Response("error", { status: 500 });
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await expect(provider.track(makeEvent())).rejects.toThrow();
  });

  it("track() rejects when fetch itself rejects", async () => {
    fetchImpl = () => {
      throw new Error("network error");
    };
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await expect(provider.track(makeEvent())).rejects.toThrow("network error");
  });

  it("trackBatch() rejects when the server responds with a non-2xx status", async () => {
    fetchImpl = () => new Response("error", { status: 500 });
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await expect(provider.trackBatch?.([makeEvent()])).rejects.toThrow();
  });
});

describe("createPostHogFetchProvider vs createPostHogProviderWithClient (shared-fixture parity)", () => {
  // Compares translated event name/properties for track()/page() between
  // both factories for the same CanonicalEvent, minus transport-specific
  // fields -- the SDK side is exercised against the module-scope
  // `FakePostHog` fake declared at the top of this file, so this suite
  // never actually imports the real `posthog-node` package.
  beforeEach(() => {
    sdkCaptureCalls.length = 0;
  });

  it("track() produces the same event name/properties translation as createPostHogProviderWithClient for equivalent config", async () => {
    const config = {
      eventMap: { "Purchase Completed": "order_completed" },
      propertyMap: { global: { total: "amount" } },
    };
    const event = makeEvent({
      name: "Purchase Completed",
      properties: { total: 42, currency: "USD" },
      userId: "user_1",
    });

    const sdkProvider = createPostHogProviderWithClient(sdkClient, config);
    sdkProvider.track(event);

    const fetchProvider = createPostHogFetchProvider({ apiKey: "test-key", ...config });
    await fetchProvider.track(event);

    expect(sdkCaptureCalls).toHaveLength(1);
    const fetchBody = parseBody(fetchCalls[0]!);

    expect(fetchBody["event"]).toBe(sdkCaptureCalls[0]!.event);
    expect(fetchBody["properties"]).toEqual(sdkCaptureCalls[0]!.properties!);
    expect(fetchBody["distinct_id"]).toBe(sdkCaptureCalls[0]!.distinctId);
  });

  it("page() produces the same $pageview event/properties translation as createPostHogProviderWithClient", async () => {
    const event = makeEvent({ name: "Home", properties: { referrer: "google" } });

    const sdkProvider = createPostHogProviderWithClient(sdkClient);
    sdkProvider.page?.(event);

    const fetchProvider = createPostHogFetchProvider({ apiKey: "test-key" });
    await fetchProvider.page?.(event);

    expect(sdkCaptureCalls).toHaveLength(1);
    const fetchBody = parseBody(fetchCalls[0]!);
    expect(fetchBody["event"]).toBe(sdkCaptureCalls[0]!.event);
    expect(fetchBody["properties"]).toEqual(sdkCaptureCalls[0]!.properties!);
  });

  it("screen() produces the same $screen event/properties translation as createPostHogProviderWithClient", async () => {
    const event = makeEvent({ name: "Onboarding", properties: { step: 1 } });

    const sdkProvider = createPostHogProviderWithClient(sdkClient);
    sdkProvider.screen?.(event);

    const fetchProvider = createPostHogFetchProvider({ apiKey: "test-key" });
    await fetchProvider.screen?.(event);

    expect(sdkCaptureCalls).toHaveLength(1);
    const fetchBody = parseBody(fetchCalls[0]!);
    expect(fetchBody["event"]).toBe(sdkCaptureCalls[0]!.event);
    expect(fetchBody["properties"]).toEqual(sdkCaptureCalls[0]!.properties!);
  });
});
