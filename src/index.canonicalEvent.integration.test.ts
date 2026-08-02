// Integration test for issue 002: exercises the whole core lifecycle
// contract end-to-end against a real, hand-written `AnalyticsProvider`
// (not a `mock()`), driving a realistic sequence across every verb and
// asserting the full recorded call sequence -- including the identity
// discontinuity introduced by `reset()`.
import { describe, expect, it } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import type { CanonicalEvent } from "./schema";
import { allCapabilities } from "./test-support";

type AppEvents = {
  signup_completed: { plan: "free" | "pro" };
};

type RecordedCall =
  | { verb: "track"; event: CanonicalEvent }
  | { verb: "identify"; userId: string; traits: Record<string, unknown> | undefined; anonymousId: string }
  | { verb: "group"; groupId: string; traits: Record<string, unknown> | undefined; identity: { userId?: string; anonymousId: string } }
  | { verb: "alias"; newUserId: string; previousUserId: string | undefined; anonymousId: string }
  | { verb: "page"; event: CanonicalEvent }
  | { verb: "screen"; event: CanonicalEvent }
  | { verb: "reset" }
  | { verb: "flush" }
  | { verb: "destroy" };

// A real, hand-written `AnalyticsProvider` implementation (not a mock) that
// pushes every call's received arguments into a plain array, standing in for
// a real vendor SDK adapter.
class RecordingProvider implements AnalyticsProvider {
  name = "recording";
  capabilities = allCapabilities;
  calls: RecordedCall[] = [];

  track(event: CanonicalEvent) {
    this.calls.push({ verb: "track", event });
  }
  identify(userId: string, traits: Record<string, unknown> | undefined, anonymousId: string) {
    this.calls.push({ verb: "identify", userId, traits, anonymousId });
  }
  group(groupId: string, traits: Record<string, unknown> | undefined, identity: { userId?: string; anonymousId: string }) {
    this.calls.push({ verb: "group", groupId, traits, identity });
  }
  alias(newUserId: string, previousUserId: string | undefined, anonymousId: string) {
    this.calls.push({ verb: "alias", newUserId, previousUserId, anonymousId });
  }
  page(event: CanonicalEvent) {
    this.calls.push({ verb: "page", event });
  }
  screen(event: CanonicalEvent) {
    this.calls.push({ verb: "screen", event });
  }
  reset() {
    this.calls.push({ verb: "reset" });
  }
  async flush() {
    this.calls.push({ verb: "flush" });
  }
  async destroy() {
    this.calls.push({ verb: "destroy" });
  }
}

describe("createAnalytics() full lifecycle, real provider, integration", () => {
  it("drives track/identify/group/alias/page/screen/reset/flush/destroy end-to-end with correct CanonicalEvent/identity values at each step", async () => {
    const provider = new RecordingProvider();
    const analytics = createAnalytics<AppEvents>({ provider });

    // 1. track() before identify() -- userId undefined.
    await analytics.track("signup_completed", { plan: "free" });

    // 2. identify() -- updates core's userId.
    await analytics.identify("user_1", { email: "user@example.com" });

    // 3. track() after identify() -- userId now set.
    await analytics.track("signup_completed", { plan: "pro" });

    // 4. group()
    await analytics.group("team_1", { seats: 5 });

    // 5. alias() -- does not mutate core's userId.
    await analytics.alias("user_1_new", "user_1");

    // 6. page()
    await analytics.page("home", { referrer: "google" });

    // 7. screen()
    await analytics.screen("checkout", { step: 2 });

    // 8. reset() -- eagerly regenerates identity.
    const identityBeforeReset = {
      anonymousId: (provider.calls.find((c) => c.verb === "track") as { event: CanonicalEvent }).event.anonymousId,
    };
    await analytics.reset();

    // 9. track() again -- new anonymousId/sessionId, userId cleared.
    await analytics.track("signup_completed", { plan: "free" });

    // 10. flush()
    await analytics.flush();

    // 11. destroy() -- flushes then tears down.
    await analytics.destroy();

    expect(provider.calls.map((c) => c.verb)).toEqual([
      "track",
      "identify",
      "track",
      "group",
      "alias",
      "page",
      "screen",
      "reset",
      "track",
      "flush", // from the standalone flush() call
      "flush", // from destroy()'s drain
      "destroy",
    ]);

    const [
      trackBeforeIdentify,
      identifyCall,
      trackAfterIdentify,
      groupCall,
      aliasCall,
      pageCall,
      screenCall,
      ,
      trackAfterReset,
    ] = provider.calls;

    // Step 1: before identify(), userId is undefined.
    const trackBefore = trackBeforeIdentify as { verb: "track"; event: CanonicalEvent };
    expect(trackBefore.event.name).toBe("signup_completed");
    expect(trackBefore.event.properties).toEqual({ plan: "free" });
    expect(trackBefore.event.userId).toBeUndefined();
    expect(trackBefore.event.anonymousId).toBe(identityBeforeReset.anonymousId);

    // Step 2: identify() forwards traits + anonymousId.
    const identified = identifyCall as { verb: "identify"; userId: string; traits: Record<string, unknown> | undefined; anonymousId: string };
    expect(identified.userId).toBe("user_1");
    expect(identified.traits).toEqual({ email: "user@example.com" });
    expect(identified.anonymousId).toBe(identityBeforeReset.anonymousId);

    // Step 3: after identify(), track() carries the new userId, same identity.
    const trackAfter = trackAfterIdentify as { verb: "track"; event: CanonicalEvent };
    expect(trackAfter.event.userId).toBe("user_1");
    expect(trackAfter.event.anonymousId).toBe(identityBeforeReset.anonymousId);
    expect(trackAfter.event.sessionId).toBe(trackBefore.event.sessionId);

    // Step 4: group() forwards identity.
    const group = groupCall as { verb: "group"; groupId: string; traits: Record<string, unknown> | undefined; identity: { userId?: string; anonymousId: string } };
    expect(group.groupId).toBe("team_1");
    expect(group.traits).toEqual({ seats: 5 });
    expect(group.identity.userId).toBe("user_1");
    expect(group.identity.anonymousId).toBe(identityBeforeReset.anonymousId);

    // Step 5: alias() does not mutate core's userId.
    const alias = aliasCall as { verb: "alias"; newUserId: string; previousUserId: string | undefined; anonymousId: string };
    expect(alias.newUserId).toBe("user_1_new");
    expect(alias.previousUserId).toBe("user_1");
    expect(alias.anonymousId).toBe(identityBeforeReset.anonymousId);

    // Step 6: page() with a name.
    const page = pageCall as { verb: "page"; event: CanonicalEvent };
    expect(page.event.name).toBe("home");
    expect(page.event.properties).toEqual({ referrer: "google" });
    expect(page.event.userId).toBe("user_1"); // alias() did not mutate userId

    // Step 7: screen() with a name.
    const screen = screenCall as { verb: "screen"; event: CanonicalEvent };
    expect(screen.event.name).toBe("checkout");
    expect(screen.event.properties).toEqual({ step: 2 });
    expect(screen.event.userId).toBe("user_1");

    // Step 9: after reset(), track() shows the identity discontinuity --
    // a new anonymousId/sessionId, and userId cleared back to undefined.
    const afterReset = trackAfterReset as { verb: "track"; event: CanonicalEvent };
    expect(afterReset.event.anonymousId).not.toBe(identityBeforeReset.anonymousId);
    expect(afterReset.event.sessionId).not.toBe(trackBefore.event.sessionId);
    expect(afterReset.event.userId).toBeUndefined();
  });
});
