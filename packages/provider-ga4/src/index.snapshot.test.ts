import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createGA4Provider } from "./index";

// Snapshot test -- not a correctness assertion (that's `index.test.ts`'s
// job), but a regression lock on the exact wire shape GA4's Measurement
// Protocol receives for a realistic, representative canonical event. Same
// `globalThis.fetch`-stubbing approach as `index.test.ts`, and the same
// literal `1_700_000_000_000` timestamp constant every adapter test in this
// monorepo already uses, so the snapshot is fully deterministic.

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: URL;
  init?: RequestInit;
}

let fetchCalls: FetchCall[];

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(input.toString());
    fetchCalls.push({ url, init });
    return Promise.resolve(new Response(null, { status: 204 }));
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
    properties: { orderId: "order_1", total: 99.99, currency: "USD" },
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    sessionId: "session-1",
    userId: "user_1",
    ...overrides,
  };
}

describe("createGA4Provider (snapshot)", () => {
  it("track()'s Measurement Protocol request body matches the locked-down wire shape", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await provider.track(makeEvent());

    expect(fetchCalls).toHaveLength(1);
    const body = parseBody(fetchCalls[0]!);
    expect(body).toMatchSnapshot();
  });
});
