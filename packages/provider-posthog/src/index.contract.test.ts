import type { CanonicalEvent } from "typetrack";
import { runProviderContractTests, type ProviderContractHarness } from "@typetrack/provider-contract-kit";
import { createPostHogProviderWithClient, type PostHogClientLike } from "./index";

// Contract test (Phase 16 issue 002) -- reuses this file's own sibling
// `index.test.ts`'s dependency-injection pattern: a hand-written fake
// implementing `PostHogClientLike` passed to
// `createPostHogProviderWithClient` -- never `mock.module("posthog-node",
// ...)`, per CLAUDE.md's standing rule. Adapter-specific field-mapping/
// wire-format and flush/destroy-ordering assertions stay in `index.test.ts`
// -- this file only proves the generic `AnalyticsProvider` interface
// contract.

class CompliantFakePostHog implements PostHogClientLike {
  capture() {}
  identify() {}
  groupIdentify() {}
  alias() {}
  async flush() {}
  async shutdown() {}
}

class FailingFakePostHog implements PostHogClientLike {
  capture() {
    throw new Error("simulated capture failure");
  }
  identify() {}
  groupIdentify() {}
  alias() {}
  async flush() {}
  async shutdown() {}
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

const harness: ProviderContractHarness = {
  name: "PostHog (SDK)",
  createProvider: () => createPostHogProviderWithClient(new CompliantFakePostHog()),
  createFailingProvider: () => createPostHogProviderWithClient(new FailingFakePostHog()),
  makeEvent,
};

runProviderContractTests(harness);
