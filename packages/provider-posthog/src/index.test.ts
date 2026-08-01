import { beforeEach, describe, expect, it, mock } from "bun:test";

// Unit tests -- no real network I/O. `posthog-node`'s `PostHog` export is
// replaced with an in-memory fake before `./index` is imported, so
// `createPostHogProvider` constructs the fake instead of a real client.
interface CaptureCall {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}
interface IdentifyCall {
  distinctId: string;
  properties?: Record<string, unknown>;
}

const captureCalls: CaptureCall[] = [];
const identifyCalls: IdentifyCall[] = [];
const flush = mock(() => Promise.resolve());
const shutdown = mock(() => Promise.resolve());

class FakePostHog {
  apiKey: string;
  options: unknown;

  constructor(apiKey: string, options: unknown) {
    this.apiKey = apiKey;
    this.options = options;
  }

  capture(props: CaptureCall) {
    captureCalls.push(props);
  }

  identify(props: IdentifyCall) {
    identifyCalls.push(props);
  }

  flush() {
    return flush();
  }

  shutdown() {
    return shutdown();
  }
}

mock.module("posthog-node", () => ({ PostHog: FakePostHog }));

const { createPostHogProvider } = await import("./index");

beforeEach(() => {
  captureCalls.length = 0;
  identifyCalls.length = 0;
  flush.mockClear();
  shutdown.mockClear();
});

describe("createPostHogProvider", () => {
  it("uses a generated, non-hardcoded anonymous distinctId for track() before identify()", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.track("signup_started", {}, { timestamp: 1000 });

    expect(captureCalls).toHaveLength(1);
    const call = captureCalls[0]!;
    expect(typeof call.distinctId).toBe("string");
    expect(call.distinctId.length).toBeGreaterThan(0);
    expect(call.distinctId).not.toBe("anonymous");
  });

  it("uses a different anonymous distinctId per provider instance", () => {
    const a = createPostHogProvider({ apiKey: "test" });
    a.track("event_a", {}, { timestamp: 1000 });
    const firstId = captureCalls[0]!.distinctId;

    const b = createPostHogProvider({ apiKey: "test" });
    b.track("event_b", {}, { timestamp: 1000 });
    const secondId = captureCalls[1]!.distinctId;

    expect(firstId).not.toBe(secondId);
  });

  it("switches to the identified distinctId for subsequent track() calls", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.identify?.("user_1", { plan: "pro" });
    provider.track("signup_completed", { plan: "pro" }, { timestamp: 1234 });

    expect(captureCalls).toHaveLength(1);
    const call = captureCalls[0]!;
    expect(call.distinctId).toBe("user_1");
    expect(call.event).toBe("signup_completed");
    expect(call.properties).toEqual({ plan: "pro" });
    expect(call.timestamp).toEqual(new Date(1234));
  });

  it("forwards userId/traits to identify() with distinctId/properties field names", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.identify?.("user_42", { email: "a@example.com" });

    expect(identifyCalls).toHaveLength(1);
    expect(identifyCalls[0]).toEqual({
      distinctId: "user_42",
      properties: { email: "a@example.com" },
    });
  });

  it("page() captures a $pageview event folding name/props into properties", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.page?.("Home", { referrer: "google" });

    expect(captureCalls).toHaveLength(1);
    const call = captureCalls[0]!;
    expect(call.event).toBe("$pageview");
    expect(call.properties).toEqual({ referrer: "google", name: "Home" });
    expect(typeof call.distinctId).toBe("string");
  });

  it("page() after identify() uses the identified distinctId", () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    provider.identify?.("user_7");
    provider.page?.();

    expect(captureCalls).toHaveLength(1);
    expect(captureCalls[0]!.distinctId).toBe("user_7");
  });

  it("flush() calls the client's flush() and never shutdown()", async () => {
    const provider = createPostHogProvider({ apiKey: "test" });

    await provider.flush?.();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(shutdown).not.toHaveBeenCalled();
  });
});
