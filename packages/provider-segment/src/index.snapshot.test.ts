import { beforeEach, describe, expect, it } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createSegmentProviderWithClient, type SegmentClientLike } from "./index";

// Snapshot test -- not a correctness assertion (that's `index.test.ts`'s
// job), but a regression lock on the exact call-argument shape Segment's
// `@segment/analytics-node` client receives for a realistic, representative
// canonical event. Same hand-written-fake dependency-injection approach as
// `index.test.ts` (never `mock.module("@segment/analytics-node", ...)`, per
// this repo's standing rule -- see that file's own header comment), and the
// same literal `1_700_000_000_000` timestamp constant every adapter test in
// this monorepo already uses, so the snapshot is fully deterministic.
interface TrackCall {
  userId?: string;
  anonymousId?: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}

let trackCalls: TrackCall[];

class FakeAnalytics implements SegmentClientLike {
  track(props: TrackCall) {
    trackCalls.push(props);
  }
  identify() {}
  group() {}
  alias() {}
  page() {}
  screen() {}
  flush() {
    return Promise.resolve();
  }
  closeAndFlush() {
    return Promise.resolve();
  }
}

const client = new FakeAnalytics();

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

beforeEach(() => {
  trackCalls = [];
});

describe("createSegmentProviderWithClient (snapshot)", () => {
  it("track()'s client.track() call arguments match the locked-down wire shape", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.track(makeEvent());

    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0]).toMatchSnapshot();
  });
});
