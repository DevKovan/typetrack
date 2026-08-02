import { describe, expect, test } from "bun:test";
import type { AnalyticsProvider, CanonicalEvent } from "typetrack";
import { runSignupFlow } from "./index";

// Runs the example's actual entry-point logic (`runSignupFlow`, the exact
// function `bun run index.ts` calls against the real console-logging
// provider) end-to-end against a hand-written recording stub, so the
// asserted call sequence and `CanonicalEvent` shape below can never silently
// drift out of sync with what the README documents.
//
// No colocated `index.test.ts` (unit test) exists for this module:
// `index.ts` contains no non-trivial pure logic of its own -- `loggingProvider`
// is direct `console.log`/`JSON.stringify` calls, and `runSignupFlow` is
// direct `analytics.track()`/`identify()`/`group()` orchestration with no
// pure computation to isolate. That same ground (the exact call sequence and
// `CanonicalEvent` shape produced) is covered here instead.

interface RecordedCall {
  type: "track" | "identify" | "group";
  args: unknown[];
}

function createRecordingProvider(): { provider: AnalyticsProvider; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const provider: AnalyticsProvider = {
    name: "recording-stub",
    capabilities: {
      identify: true,
      group: true,
      alias: false,
      page: false,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },
    track(event) {
      calls.push({ type: "track", args: [event] });
    },
    identify(userId, traits, anonymousId) {
      calls.push({ type: "identify", args: [userId, traits, anonymousId] });
    },
    group(groupId, traits, identity) {
      calls.push({ type: "group", args: [groupId, traits, identity] });
    },
    async flush() {},
    async destroy() {},
  };
  return { provider, calls };
}

describe("canonical-event-shape example", () => {
  test("runSignupFlow calls track -> identify -> group -> track, in that order", async () => {
    const { provider, calls } = createRecordingProvider();

    await runSignupFlow(provider);

    expect(calls.map((call) => call.type)).toEqual(["track", "identify", "group", "track"]);
  });

  test("the first track() call produces the documented CanonicalEvent shape", async () => {
    const { provider, calls } = createRecordingProvider();
    await runSignupFlow(provider);

    const firstTrack = calls[0];
    const event = firstTrack?.args[0] as CanonicalEvent;

    expect(event.name).toBe("User Signed Up");
    expect(event.properties).toEqual({ plan: "pro" });
    expect(event.context).toEqual({ locale: "en-US" });
    expect(event.metadata).toEqual({ source: "web" });
    // Before identify() has run, userId is not yet set.
    expect(event.userId).toBeUndefined();
    expect(typeof event.anonymousId).toBe("string");
    expect(event.anonymousId.length).toBeGreaterThan(0);
    expect(typeof event.sessionId).toBe("string");
    expect(event.sessionId.length).toBeGreaterThan(0);
    expect(typeof event.timestamp).toBe("number");
  });

  test("identify() and group() receive the same anonymousId as the surrounding track() calls", async () => {
    const { provider, calls } = createRecordingProvider();
    await runSignupFlow(provider);

    const [firstTrack, identifyCall, groupCall, secondTrack] = calls;
    const firstEvent = firstTrack?.args[0] as CanonicalEvent;
    const [identifiedUserId, identifiedTraits, identifyAnonymousId] = identifyCall!.args as [
      string,
      Record<string, unknown>,
      string,
    ];
    const [groupId, groupTraits, groupIdentity] = groupCall!.args as [
      string,
      Record<string, unknown>,
      { userId?: string; anonymousId: string },
    ];
    const secondEvent = secondTrack?.args[0] as CanonicalEvent;

    expect(identifiedUserId).toBe("user_42");
    expect(identifiedTraits).toEqual({ email: "ada@example.com", plan: "pro" });
    expect(identifyAnonymousId).toBe(firstEvent.anonymousId);

    expect(groupId).toBe("acme-inc");
    expect(groupTraits).toEqual({ name: "Acme Inc", tier: "enterprise" });
    expect(groupIdentity).toEqual({ userId: "user_42", anonymousId: firstEvent.anonymousId });

    // identify() populates userId for every subsequent event -- the second
    // track() call carries it, the first (pre-identify) one does not.
    expect(secondEvent.name).toBe("Checkout Started");
    expect(secondEvent.properties).toEqual({ cartValue: 129.99, itemCount: 3 });
    expect(secondEvent.userId).toBe("user_42");
    expect(secondEvent.anonymousId).toBe(firstEvent.anonymousId);
    expect(secondEvent.sessionId).toBe(firstEvent.sessionId);
  });

  test("runSignupFlow also runs cleanly end-to-end against the real noopProvider", async () => {
    const { noopProvider } = await import("typetrack");
    await expect(runSignupFlow(noopProvider)).resolves.toBeUndefined();
  });
});
