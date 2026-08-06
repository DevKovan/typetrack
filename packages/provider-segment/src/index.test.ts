import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { CanonicalEvent } from "typetrack";
import { createSegmentProviderWithClient, type SegmentClientLike } from "./index";

// Unit tests -- no real network I/O, and no module mocking. `FakeAnalytics`
// below implements `SegmentClientLike` directly and is passed to
// `createSegmentProviderWithClient` -- this used to go through
// `mock.module("@segment/analytics-node", ...)` + a plain
// `createSegmentProvider()` call, but that turned out to leak the fake
// across test files sharing Bun's single test process (confirmed
// empirically). Dependency injection sidesteps the whole
// module-cache-sharing problem instead of fighting it -- see
// `createSegmentProviderWithClient`'s own doc comment in `./index.ts`.
//
// The fake mirrors the real SDK's verified `_isClosed` gate (see
// `dist/esm/app/analytics-node.js`): once `closeAndFlush()` has been called,
// further track/page/screen/group/alias calls are silently dropped instead
// of throwing -- track()/page()/etc. are `void`, not promises, on the real
// client, so there is nothing to reject.
interface TrackCall {
  userId?: string;
  anonymousId?: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}
interface IdentifyCall {
  userId?: string;
  anonymousId?: string;
  traits?: Record<string, unknown>;
}
interface PageCall {
  userId?: string;
  anonymousId?: string;
  name?: string;
  properties?: Record<string, unknown>;
}
interface GroupCall {
  userId?: string;
  anonymousId?: string;
  groupId: string;
  traits?: Record<string, unknown>;
}
interface AliasCall {
  userId: string;
  previousId: string;
}

const trackCalls: TrackCall[] = [];
const identifyCalls: IdentifyCall[] = [];
const pageCalls: PageCall[] = [];
const screenCalls: PageCall[] = [];
const groupCalls: GroupCall[] = [];
const aliasCalls: AliasCall[] = [];
const closeAndFlush = mock(() => Promise.resolve());
const flush = mock(() => Promise.resolve());

class FakeAnalytics implements SegmentClientLike {
  closed = false;

  track(props: TrackCall) {
    if (this.closed) return;
    trackCalls.push(props);
  }

  identify(props: IdentifyCall) {
    if (this.closed) return;
    identifyCalls.push(props);
  }

  page(props: PageCall) {
    if (this.closed) return;
    pageCalls.push(props);
  }

  screen(props: PageCall) {
    if (this.closed) return;
    screenCalls.push(props);
  }

  group(props: GroupCall) {
    if (this.closed) return;
    groupCalls.push(props);
  }

  alias(props: AliasCall) {
    if (this.closed) return;
    aliasCalls.push(props);
  }

  closeAndFlush() {
    this.closed = true;
    return closeAndFlush();
  }

  flush() {
    return flush();
  }
}

const client = new FakeAnalytics();

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

beforeEach(() => {
  client.closed = false;
  trackCalls.length = 0;
  identifyCalls.length = 0;
  pageCalls.length = 0;
  screenCalls.length = 0;
  groupCalls.length = 0;
  aliasCalls.length = 0;
  closeAndFlush.mockClear();
  flush.mockClear();
});

describe("createSegmentProviderWithClient", () => {
  it("track() derives identity from event.anonymousId only, when event.userId is undefined", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.track(makeEvent({ anonymousId: "anon-1", userId: undefined }));

    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0]!.anonymousId).toBe("anon-1");
    expect(trackCalls[0]!.userId).toBeUndefined();
  });

  it("track() derives identity from both event.userId and event.anonymousId when userId is defined", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.track(makeEvent({ anonymousId: "anon-1", userId: "user_1" }));

    expect(trackCalls[0]!.anonymousId).toBe("anon-1");
    expect(trackCalls[0]!.userId).toBe("user_1");
  });

  it("two track() calls with different event.anonymousId values produce different identity objects (no caching)", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.track(makeEvent({ anonymousId: "anon-a" }));
    provider.track(makeEvent({ anonymousId: "anon-b" }));

    expect(trackCalls[0]!.anonymousId).toBe("anon-a");
    expect(trackCalls[1]!.anonymousId).toBe("anon-b");
  });

  it("track() passes event name/properties/timestamp through translation", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.track(makeEvent({ name: "Custom Event", properties: { plan: "pro" }, timestamp: 1234 }));

    expect(trackCalls).toHaveLength(1);
    const call = trackCalls[0]!;
    expect(call.event).toBe("Custom Event");
    expect(call.properties).toEqual({ plan: "pro" });
    expect(call.timestamp).toEqual(new Date(1234));
  });

  it("translates a default-mapped canonical event name", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.track(makeEvent({ name: "Purchase Completed" }));

    expect(trackCalls[0]!.event).toBe("Order Completed");
  });

  it("passes an unmapped event name through unchanged and warns exactly once per name", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const provider = createSegmentProviderWithClient(client);

      provider.track(makeEvent({ name: "Totally Custom Event" }));
      provider.track(makeEvent({ name: "Totally Custom Event" }));

      expect(trackCalls[0]!.event).toBe("Totally Custom Event");
      expect(warnSpy).toHaveBeenCalledTimes(1);

      provider.track(makeEvent({ name: "Another Custom Event" }));
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("eventMap override wins over the default for a colliding key", () => {
    const provider = createSegmentProviderWithClient(client, {
      eventMap: { "Purchase Completed": "Custom Purchase" },
    });

    provider.track(makeEvent({ name: "Purchase Completed" }));

    expect(trackCalls[0]!.event).toBe("Custom Purchase");
  });

  it("eventMap override introduces a brand-new canonical event name", () => {
    const provider = createSegmentProviderWithClient(client, {
      eventMap: { "Newsletter Subscribed": "Newsletter Signup" },
    });

    provider.track(makeEvent({ name: "Newsletter Subscribed" }));

    expect(trackCalls[0]!.event).toBe("Newsletter Signup");
  });

  it("propertyMap: per-event override beats global, global is fallback, unmapped keys pass through", () => {
    const provider = createSegmentProviderWithClient(client, {
      propertyMap: {
        global: { orderId: "global_order_id", currency: "currency" },
        events: {
          "Purchase Completed": { orderId: "per_event_order_id" },
        },
      },
    });

    provider.track(
      makeEvent({
        name: "Purchase Completed",
        properties: { orderId: "o1", total: 42, currency: "USD", unmappedKey: "value" },
      }),
    );

    const properties = trackCalls[0]!.properties!;
    // per-event override beats both the global override and the default
    // ("order_id") for the same key.
    expect(properties["per_event_order_id"]).toBe("o1");
    expect(properties["global_order_id"]).toBeUndefined();
    expect(properties["orderId"]).toBeUndefined();
    // default per-event mapping still applies for keys not overridden.
    expect(properties["revenue"]).toBe(42);
    // global mapping applies as a fallback for keys with no per-event entry.
    expect(properties["currency"]).toBe("USD");
    // unmapped keys pass through unchanged.
    expect(properties["unmappedKey"]).toBe("value");
  });

  it("identify() forwards userId/anonymousId/traits to the client's identify(), storing no state", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.identify?.("user_42", { email: "a@example.com" }, "anon-42");

    expect(identifyCalls).toHaveLength(1);
    const call = identifyCalls[0]!;
    expect(call.userId).toBe("user_42");
    expect(call.anonymousId).toBe("anon-42");
    expect(call.traits).toEqual({ email: "a@example.com" });
  });

  it("page() derives identity from the event and translates properties via the global map only", () => {
    const provider = createSegmentProviderWithClient(client, {
      propertyMap: { global: { referrer: "page_referrer" } },
    });

    provider.page?.(makeEvent({ name: "Home", properties: { referrer: "google" }, userId: "user_7" }));

    expect(pageCalls).toHaveLength(1);
    const call = pageCalls[0]!;
    expect(call.name).toBe("Home");
    expect(call.userId).toBe("user_7");
    expect(call.anonymousId).toBe("anon-1");
    expect(call.properties).toEqual({ page_referrer: "google" });
  });

  it("page() with the empty-string name sentinel omits name", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.page?.(makeEvent({ name: "" }));

    expect(pageCalls[0]!.name).toBeUndefined();
  });

  it("screen() derives identity from the event and forwards to the client's screen()", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.screen?.(makeEvent({ name: "Onboarding", properties: { step: 1 }, userId: "user_9" }));

    expect(screenCalls).toHaveLength(1);
    const call = screenCalls[0]!;
    expect(call.name).toBe("Onboarding");
    expect(call.userId).toBe("user_9");
    expect(call.anonymousId).toBe("anon-1");
    expect(call.properties).toEqual({ step: 1 });
  });

  it("group() forwards to the client's group() with the correct identity shape", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.group?.("group_1", { plan: "enterprise" }, { userId: "user_1", anonymousId: "anon-1" });

    expect(groupCalls).toHaveLength(1);
    const call = groupCalls[0]!;
    expect(call.groupId).toBe("group_1");
    expect(call.userId).toBe("user_1");
    expect(call.anonymousId).toBe("anon-1");
    expect(call.traits).toEqual({ plan: "enterprise" });
  });

  it("group() omits userId when the identity has none", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.group?.("group_1", undefined, { anonymousId: "anon-1" });

    expect(groupCalls[0]!.userId).toBeUndefined();
    expect(groupCalls[0]!.anonymousId).toBe("anon-1");
  });

  it("alias() forwards userId/previousId to the client's alias()", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.alias?.("new_user", "old_user", "anon-1");

    expect(aliasCalls).toHaveLength(1);
    expect(aliasCalls[0]!.userId).toBe("new_user");
    expect(aliasCalls[0]!.previousId).toBe("old_user");
  });

  it("alias() falls back to anonymousId as previousId when previousUserId is undefined", () => {
    const provider = createSegmentProviderWithClient(client);

    provider.alias?.("new_user", undefined, "anon-1");

    expect(aliasCalls[0]!.userId).toBe("new_user");
    expect(aliasCalls[0]!.previousId).toBe("anon-1");
  });

  it("flush() calls the client's non-terminal flush(), never closeAndFlush()", async () => {
    const provider = createSegmentProviderWithClient(client);

    await provider.flush?.();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(closeAndFlush).not.toHaveBeenCalled();
  });

  it("the adapter remains usable for a subsequent track() call after flush() resolves (critical regression test)", async () => {
    const provider = createSegmentProviderWithClient(client);

    provider.track(makeEvent({ name: "before flush" }));
    await provider.flush?.();
    provider.track(makeEvent({ name: "after flush" }));

    expect(trackCalls).toHaveLength(2);
    expect(trackCalls[1]!.event).toBe("after flush");
  });

  it("destroy() calls closeAndFlush(), and a subsequent track() call is silently dropped (verified _isClosed behavior)", async () => {
    const provider = createSegmentProviderWithClient(client);

    await provider.destroy?.();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(closeAndFlush).toHaveBeenCalledTimes(1);

    // Per the installed SDK's verified `_dispatch()` implementation
    // (`dist/esm/app/analytics-node.js`), a call after `closeAndFlush()` is
    // silently dropped (`_isClosed` gate, `call_after_close` emitted) rather
    // than throwing/rejecting -- `track()` itself is synchronous `void`, so
    // there is nothing to reject. This test documents that exact behavior.
    provider.track(makeEvent({ name: "after destroy" }));
    expect(trackCalls).toHaveLength(0);
  });
});
