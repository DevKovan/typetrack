import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createSegmentFetchProvider } from "./fetch";

// Snapshot test -- not a correctness assertion (that's `fetch.test.ts`'s
// job), but a regression lock on the exact wire shape Segment's HTTP
// Tracking API receives for a realistic, representative canonical event.
// Same `globalThis.fetch`-stubbing approach as `fetch.test.ts`, and the
// same literal `1_700_000_000_000` timestamp constant every adapter test in
// this monorepo already uses, so the snapshot is fully deterministic. Only
// the request body is snapshotted here -- the `Authorization` header is
// already pinned exactly by `fetch.test.ts`'s own `toBe()` assertion, with
// no realistic drift risk (a fixed base64 encoding of a fixed write key).

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
    return Promise.resolve(new Response(null, { status: 200 }));
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

describe("createSegmentFetchProvider (snapshot)", () => {
  it("track()'s /v1/track request body matches the locked-down wire shape", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test" });

    await provider.track(makeEvent());

    expect(fetchCalls).toHaveLength(1);
    const body = parseBody(fetchCalls[0]!);
    expect(body).toMatchSnapshot();
  });
});
