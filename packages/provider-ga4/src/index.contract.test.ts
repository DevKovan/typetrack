import { afterEach, beforeEach, mock } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { runProviderContractTests, type ProviderContractHarness } from "@typetrack/provider-contract-kit";
import { createGA4Provider } from "./index";

// Contract test (Phase 16 issue 002) -- reuses this file's own sibling
// `index.test.ts`'s exact `globalThis.fetch`-stubbing approach:
// `createProvider()` wires the stub to a 2xx `Response`,
// `createFailingProvider()` wires it to a non-2xx `Response`. Adapter-specific
// field-mapping/wire-format assertions stay in `index.test.ts` -- this file
// only proves the generic `AnalyticsProvider` interface contract.

const originalFetch = globalThis.fetch;

let fetchImpl: () => Promise<Response> | Response;

beforeEach(() => {
  fetchImpl = () => new Response(null, { status: 204 });
  globalThis.fetch = mock(() => Promise.resolve(fetchImpl())) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "Custom Event",
    properties: {},
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    sessionId: "session-1",
    ...overrides,
  };
}

const harness: ProviderContractHarness = {
  name: "GA4",
  createProvider: () => {
    fetchImpl = () => new Response(null, { status: 204 });
    return createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });
  },
  createFailingProvider: () => {
    fetchImpl = () => new Response("error", { status: 500 });
    return createGA4Provider({ measurementId: "G-TEST", apiSecret: "secret" });
  },
  makeEvent,
};

runProviderContractTests(harness);
