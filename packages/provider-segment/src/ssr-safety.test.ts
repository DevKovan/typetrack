// Phase 13 issue 004: SSR-safety verification for this package's two
// adapters (`createSegmentProvider`, SDK-based; `createSegmentFetchProvider`,
// zero-vendor-dependency). Deletes every browser global from `globalThis`
// (stub-absent, not stub-falsy -- see `src/ssr-safety.test.ts` in the root
// `typetrack` package for the full rationale) for the duration of this
// file's tests, then exercises a full track()/identify()/flush()/destroy()
// cycle through both adapters -- `globalThis.fetch` is stubbed as a spy
// throughout (mirroring `./fetch.test.ts`'s own convention) so no real
// network call is ever made, by either adapter (`@segment/analytics-node`'s
// own HTTP transport is itself `fetch`-based -- see the `runtimes` research
// comment at the top of `./index.ts`).
//
// Neither adapter has any reason to touch a browser global at all (both are
// server-side/HTTP-only) -- this file exists to lock that in as regression
// coverage, not because either adapter was suspected of an SSR-unsafe path.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { CanonicalEvent } from "typetrack";

interface TrackCall {
  userId?: string;
  anonymousId?: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}
interface IdentifyCall {
  userId: string;
  anonymousId?: string;
  traits?: Record<string, unknown>;
}

const trackCalls: TrackCall[] = [];
const identifyCalls: IdentifyCall[] = [];
const closeAndFlush = mock(() => Promise.resolve());
const flush = mock(() => Promise.resolve());

class FakeAnalytics {
  closed = false;
  constructor(public settings: unknown) {}

  track(props: TrackCall) {
    if (this.closed) return;
    trackCalls.push(props);
  }
  identify(props: IdentifyCall) {
    if (this.closed) return;
    identifyCalls.push(props);
  }
  closeAndFlush() {
    this.closed = true;
    return closeAndFlush();
  }
  flush() {
    return flush();
  }
}

mock.module("@segment/analytics-node", () => ({ Analytics: FakeAnalytics }));
const { createSegmentProvider } = await import("./index");
const { createSegmentFetchProvider } = await import("./fetch");

const BROWSER_GLOBAL_KEYS = ["window", "document", "navigator", "localStorage", "indexedDB", "location"] as const;

function deleteBrowserGlobals(): void {
  for (const key of BROWSER_GLOBAL_KEYS) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

const originalFetch = globalThis.fetch;
let fetchCalls: { url: string }[];

beforeEach(() => {
  deleteBrowserGlobals();
  fetchCalls = [];
  globalThis.fetch = mock((input: string | URL | Request) => {
    fetchCalls.push({ url: input.toString() });
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  deleteBrowserGlobals();
  globalThis.fetch = originalFetch;
  trackCalls.length = 0;
  identifyCalls.length = 0;
});

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "Custom Event",
    properties: { total: 42 },
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    userId: "user-1",
    sessionId: "session-1",
    ...overrides,
  };
}

describe("SSR safety: createSegmentProvider (SDK-based)", () => {
  it("track()/identify()/flush()/destroy() cycle: nothing throws with no browser globals present", async () => {
    const provider = createSegmentProvider({ writeKey: "test-key" });

    expect(() => provider.track(makeEvent())).not.toThrow();
    expect(() => provider.identify?.("user-1", { plan: "pro" }, "anon-1")).not.toThrow();
    await expect(provider.flush?.()).resolves.toBeUndefined();
    await expect(provider.destroy?.()).resolves.toBeUndefined();

    // Real work happened (not a silent no-op) -- the fake SDK actually
    // recorded both calls.
    expect(trackCalls).toHaveLength(1);
    expect(identifyCalls).toHaveLength(1);
  });
});

describe("SSR safety: createSegmentFetchProvider (fetch-based)", () => {
  it("track()/identify()/flush()/destroy() cycle: nothing throws with no browser globals present, no real network call", async () => {
    const provider = createSegmentFetchProvider({ writeKey: "test-key" });

    await expect(provider.track(makeEvent())).resolves.toBeUndefined();
    await expect(provider.identify?.("user-1", { plan: "pro" }, "anon-1")).resolves.toBeUndefined();
    await expect(provider.flush?.()).resolves.toBeUndefined();
    await expect(provider.destroy?.()).resolves.toBeUndefined();

    // Real work happened via the stubbed `fetch` spy (never a real network
    // call) -- track() + identify() each POST once.
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0]!.url).toBe("https://api.segment.io/v1/track");
    expect(fetchCalls[1]!.url).toBe("https://api.segment.io/v1/identify");
  });
});
