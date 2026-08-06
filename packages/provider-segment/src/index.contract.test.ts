import type { CanonicalEvent } from "typetrack";
import { runProviderContractTests, type ProviderContractHarness } from "@typetrack/provider-contract-kit";
import { createSegmentProviderWithClient, type SegmentClientLike } from "./index";

// Contract test (Phase 16 issue 002) -- reuses this file's own sibling
// `index.test.ts`'s dependency-injection pattern: a hand-written fake
// implementing `SegmentClientLike` passed to
// `createSegmentProviderWithClient` -- never
// `mock.module("@segment/analytics-node", ...)`, per CLAUDE.md's standing
// rule. Adapter-specific field-mapping/wire-format and flush/destroy-
// ordering assertions stay in `index.test.ts` -- this file only proves the
// generic `AnalyticsProvider` interface contract.

class CompliantFakeAnalytics implements SegmentClientLike {
  track() {}
  identify() {}
  group() {}
  alias() {}
  page() {}
  screen() {}
  async flush() {}
  async closeAndFlush() {}
}

class FailingFakeAnalytics implements SegmentClientLike {
  track() {
    throw new Error("simulated track failure");
  }
  identify() {}
  group() {}
  alias() {}
  page() {}
  screen() {}
  async flush() {}
  async closeAndFlush() {}
}

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
  name: "Segment (SDK)",
  createProvider: () => createSegmentProviderWithClient(new CompliantFakeAnalytics()),
  createFailingProvider: () => createSegmentProviderWithClient(new FailingFakeAnalytics()),
  makeEvent,
};

runProviderContractTests(harness);
