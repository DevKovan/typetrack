import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createGA4Provider } from "./index";

// Unit tests -- no real network I/O. `globalThis.fetch` is stubbed before
// each test and restored afterward.

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: URL;
  init?: RequestInit;
}

let fetchCalls: FetchCall[];
let fetchImpl: (url: URL, init?: RequestInit) => Promise<Response> | Response;

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = () => new Response(null, { status: 204 });
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(input.toString());
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

describe("createGA4Provider (unit)", () => {
  it("track() calls fetch with correct query params, method, and body", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await provider.track("signup_completed", { plan: "pro" }, { timestamp: 1_700_000_000_000 });

    expect(fetchCalls.length).toBe(1);
    const call = fetchCalls[0]!;
    expect(call.url.pathname).toBe("/mp/collect");
    expect(call.url.searchParams.get("measurement_id")).toBe("G-TEST");
    expect(call.url.searchParams.get("api_secret")).toBe("secret");
    expect(call.init?.method).toBe("POST");

    const body = parseBody(call);
    expect(typeof body["client_id"]).toBe("string");
    expect((body["client_id"] as string).length).toBeGreaterThan(0);
    expect(body["events"]).toEqual([{ name: "signup_completed", params: { plan: "pro" } }]);
    expect(body["timestamp_micros"]).toBe(1_700_000_000_000 * 1000);
  });

  it("identify() triggers zero fetch calls", () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    provider.identify?.("user_1", { plan: "pro" });

    expect(fetchCalls.length).toBe(0);
  });

  it("track() after identify() includes user_id and user_properties", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    provider.identify?.("user_1", { plan: "pro" });
    await provider.track("signup_completed", {}, { timestamp: 1_700_000_000_000 });

    expect(fetchCalls.length).toBe(1);
    const body = parseBody(fetchCalls[0]!);
    expect(body["user_id"]).toBe("user_1");
    expect(body["user_properties"]).toEqual({ plan: { value: "pro" } });
  });

  it("page(name, props) sends a page_view event", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await provider.page?.("Home", { referrer: "google" });

    expect(fetchCalls.length).toBe(1);
    const body = parseBody(fetchCalls[0]!);
    expect(body["events"]).toEqual([
      { name: "page_view", params: { page_title: "Home", referrer: "google" } },
    ]);
  });

  it("flush() resolves without calling fetch", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await expect(provider.flush?.()).resolves.toBeUndefined();
    expect(fetchCalls.length).toBe(0);
  });

  it("track() rejects when fetch resolves with a non-2xx response", async () => {
    fetchImpl = () => new Response("error", { status: 500 });
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await expect(
      provider.track("signup_completed", {}, { timestamp: 1_700_000_000_000 }),
    ).rejects.toThrow();
  });

  it("track() rejects when fetch itself rejects", async () => {
    fetchImpl = () => {
      throw new Error("network error");
    };
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await expect(
      provider.track("signup_completed", {}, { timestamp: 1_700_000_000_000 }),
    ).rejects.toThrow("network error");
  });
});
