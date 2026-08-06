import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createPostHogFetchProvider } from "./fetch";

// Snapshot test -- not a correctness assertion (that's `fetch.test.ts`'s
// job), but a regression lock on the exact wire shape PostHog's HTTP
// capture API receives for a realistic, representative canonical event.
// Same `globalThis.fetch`-stubbing approach as `fetch.test.ts`, and the
// same literal `1_700_000_000_000` timestamp constant every adapter test in
// this monorepo already uses, so the snapshot is fully deterministic.

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: string;
  init?: RequestInit;
}

let fetchCalls: FetchCall[];

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    fetchCalls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify({ status: 1 }), { status: 200 }));
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

describe("createPostHogFetchProvider (snapshot)", () => {
  it("track()'s /capture/ request body matches the locked-down wire shape", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await provider.track(makeEvent());

    expect(fetchCalls).toHaveLength(1);
    const body = parseBody(fetchCalls[0]!);
    expect(body).toMatchSnapshot();
  });
});
