// Phase 13 issue 004: SSR-safety regression coverage for `createGA4Provider`.
// A lighter-touch counterpart to the root `typetrack` package's
// `src/ssr-safety.test.ts` and the sibling `provider-posthog`/
// `provider-segment` packages' own `src/ssr-safety.test.ts` files -- this
// adapter already has zero browser-global usage (confirmed by Phase 13 issue
// 003's research: no vendor SDK import, no Node-specific global, the only
// network call is the runtime's native `fetch()`), so this file exists
// purely for completeness/regression-locking, not because a real SSR-unsafe
// path was suspected here.
//
// Deletes every browser global from `globalThis` (stub-absent, not
// stub-falsy -- see `src/ssr-safety.test.ts` in the root `typetrack` package
// for the full rationale) for the duration of this file's tests, then
// exercises a track()/identify()/flush()/destroy() cycle -- `globalThis.fetch`
// is stubbed as a spy (mirroring `./index.test.ts`'s own convention) so no
// real network call is ever made.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createGA4Provider } from "./index";

const BROWSER_GLOBAL_KEYS = ["window", "document", "navigator", "localStorage", "indexedDB", "location"] as const;

function deleteBrowserGlobals(): void {
  for (const key of BROWSER_GLOBAL_KEYS) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

const originalFetch = globalThis.fetch;
let fetchCalls: { url: URL }[];

beforeEach(() => {
  deleteBrowserGlobals();
  fetchCalls = [];
  globalThis.fetch = mock((input: string | URL | Request) => {
    const url = input instanceof URL ? input : new URL(input.toString());
    fetchCalls.push({ url });
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  deleteBrowserGlobals();
  globalThis.fetch = originalFetch;
});

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "Custom Event",
    properties: {},
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    userId: "user-1",
    sessionId: "session-1",
    ...overrides,
  };
}

describe("SSR safety: createGA4Provider", () => {
  it("track()/identify()/flush()/destroy() cycle: nothing throws with no browser globals present, no real network call", async () => {
    const provider = createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });

    await expect(provider.track(makeEvent())).resolves.toBeUndefined();
    expect(() => provider.identify?.("user-1", { plan: "pro" }, "anon-1")).not.toThrow();
    await expect(provider.flush?.()).resolves.toBeUndefined();
    await expect(provider.destroy?.()).resolves.toBeUndefined();

    // track() dispatches via the stubbed fetch spy (never a real network
    // call); identify() makes zero network calls by design (see
    // `createGA4Provider`'s doc comment -- no standalone "set user"
    // endpoint exists in the Measurement Protocol).
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url.pathname).toBe("/mp/collect");
  });
});
