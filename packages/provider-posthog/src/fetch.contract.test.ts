import { afterEach, beforeEach, mock } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { runProviderContractTests, type ProviderContractHarness } from "@typetrack/provider-contract-kit";
import { createPostHogFetchProvider } from "./fetch";

// Contract test (Phase 16 issue 002) -- reuses this file's own sibling
// `fetch.test.ts`'s exact `globalThis.fetch`-stubbing approach:
// `createProvider()` wires the stub to a 2xx `Response`,
// `createFailingProvider()` wires it to a non-2xx `Response`. Adapter-specific
// field-mapping/wire-format assertions stay in `fetch.test.ts` -- this file
// only proves the generic `AnalyticsProvider` interface contract.

const originalFetch = globalThis.fetch;

let fetchImpl: () => Promise<Response> | Response;

beforeEach(() => {
  fetchImpl = () => new Response(JSON.stringify({ status: 1 }), { status: 200 });
  globalThis.fetch = mock(() => Promise.resolve(fetchImpl())) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

const harness: ProviderContractHarness = {
  name: "PostHog (fetch)",
  createProvider: () => {
    fetchImpl = () => new Response(JSON.stringify({ status: 1 }), { status: 200 });
    return createPostHogFetchProvider({ apiKey: "test-key" });
  },
  createFailingProvider: () => {
    fetchImpl = () => new Response("error", { status: 500 });
    return createPostHogFetchProvider({ apiKey: "test-key" });
  },
  makeEvent,
};

runProviderContractTests(harness);
