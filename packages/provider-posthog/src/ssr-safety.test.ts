// Phase 13 issue 004: SSR-safety verification for this package's two
// adapters (`createPostHogProvider`, SDK-based; `createPostHogFetchProvider`,
// zero-vendor-dependency). Deletes every browser global from `globalThis`
// (stub-absent, not stub-falsy -- see `src/ssr-safety.test.ts` in the root
// `typetrack` package for the full rationale) for the duration of this
// file's tests, then exercises a full track()/identify()/flush()/destroy()
// cycle through both adapters -- `globalThis.fetch` is stubbed as a spy
// throughout (mirroring `./fetch.test.ts`'s own convention) so no real
// network call is ever made, by either adapter (the SDK-based one's HTTP
// transport is itself `fetch`-based -- see the `runtimes` research comment
// at the top of `./index.ts`).
//
// Neither adapter has any reason to touch a browser global at all (both are
// server-side/HTTP-only, `posthog-node`'s own `browser` export condition is
// explicitly excluded per `./index.ts`'s header comment) -- this file exists
// to lock that in as regression coverage, not because either adapter was
// suspected of an SSR-unsafe path.
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { CanonicalEvent } from "typetrack";

interface SdkCaptureCall {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}
const sdkCaptureCalls: SdkCaptureCall[] = [];
class FakePostHog {
  constructor(
    public apiKey: string,
    public options: unknown,
  ) {}
  capture(props: SdkCaptureCall) {
    sdkCaptureCalls.push(props);
  }
  identify(props: unknown) {
    sdkCaptureCalls.push(props as SdkCaptureCall);
  }
  flush() {
    return Promise.resolve();
  }
  shutdown() {
    return Promise.resolve();
  }
}
mock.module("posthog-node", () => ({ PostHog: FakePostHog }));

// `mock.module()` mutates the already-loaded `posthog-node` module's
// exports for the rest of the shared, single-process `bun test` run --
// left unrestored, it would silently poison every later file's real
// `createPostHogProvider` (e.g. `index.integration.test.ts`) with this
// fake. `mock.restore()` undoes it once this file's tests finish.
afterAll(() => {
  mock.restore();
});

const { createPostHogProvider } = await import("./index");
const { createPostHogFetchProvider } = await import("./fetch");

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
    return Promise.resolve(new Response(JSON.stringify({ status: 1 }), { status: 200 }));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  deleteBrowserGlobals();
  globalThis.fetch = originalFetch;
  sdkCaptureCalls.length = 0;
});

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "Purchase Completed",
    properties: { total: 42 },
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    userId: "user-1",
    sessionId: "session-1",
    ...overrides,
  };
}

describe("SSR safety: createPostHogProvider (SDK-based)", () => {
  it("track()/identify()/flush()/destroy() cycle: nothing throws with no browser globals present", async () => {
    const provider = createPostHogProvider({ apiKey: "test-key" });

    expect(() => provider.track(makeEvent())).not.toThrow();
    expect(() => provider.identify?.("user-1", { plan: "pro" }, "anon-1")).not.toThrow();
    await expect(provider.flush?.()).resolves.toBeUndefined();
    await expect(provider.destroy?.()).resolves.toBeUndefined();

    // Real work happened (not a silent no-op) -- the fake SDK actually
    // recorded both calls.
    expect(sdkCaptureCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("SSR safety: createPostHogFetchProvider (fetch-based)", () => {
  it("track()/identify()/flush()/destroy() cycle: nothing throws with no browser globals present, no real network call", async () => {
    const provider = createPostHogFetchProvider({ apiKey: "test-key" });

    await expect(provider.track(makeEvent())).resolves.toBeUndefined();
    await expect(provider.identify?.("user-1", { plan: "pro" }, "anon-1")).resolves.toBeUndefined();
    await expect(provider.flush?.()).resolves.toBeUndefined();
    await expect(provider.destroy?.()).resolves.toBeUndefined();

    // Real work happened via the stubbed `fetch` spy (never a real network
    // call) -- track() + identify() each POST once.
    expect(fetchCalls).toHaveLength(2);
    for (const call of fetchCalls) {
      expect(call.url).toBe("https://us.i.posthog.com/capture/");
    }
  });
});
