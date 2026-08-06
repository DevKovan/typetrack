import { beforeEach, describe, expect, it } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createPostHogProviderWithClient, type PostHogClientLike } from "./index";

// Snapshot test -- not a correctness assertion (that's `index.test.ts`'s
// job), but a regression lock on the exact call-argument shape PostHog's
// `posthog-node` client receives for a realistic, representative canonical
// event. Same hand-written-fake dependency-injection approach as
// `index.test.ts` (never `mock.module("posthog-node", ...)`, per this
// repo's standing rule -- see that file's own header comment), and the same
// literal `1_700_000_000_000` timestamp constant every adapter test in this
// monorepo already uses, so the snapshot is fully deterministic.
interface CaptureCall {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}

let captureCalls: CaptureCall[];

class FakePostHog implements PostHogClientLike {
  capture(props: CaptureCall) {
    captureCalls.push(props);
  }
  identify() {}
  groupIdentify() {}
  alias() {}
  flush() {
    return Promise.resolve();
  }
  shutdown() {
    return Promise.resolve();
  }
}

const client = new FakePostHog();

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
  captureCalls = [];
});

describe("createPostHogProviderWithClient (snapshot)", () => {
  it("track()'s client.capture() call arguments match the locked-down wire shape", () => {
    const provider = createPostHogProviderWithClient(client);

    provider.track(makeEvent());

    expect(captureCalls).toHaveLength(1);
    expect(captureCalls[0]).toMatchSnapshot();
  });
});
