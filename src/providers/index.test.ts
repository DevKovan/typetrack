// Unit tests for `noopProvider` (issue 001). Pure logic, no I/O: every
// method is asserted to be a genuine no-op that never throws, and
// `capabilities` is asserted to be all-`true` per the rationale documented
// alongside `noopProvider` in `./index.ts`.
import { describe, expect, it } from "bun:test";
import type { CanonicalEvent } from "../schema";
import { noopProvider } from "./index";

const sampleEvent: CanonicalEvent = {
  name: "signup_completed",
  properties: { plan: "pro" },
  timestamp: Date.now(),
  anonymousId: "anon-1",
  sessionId: "session-1",
};

describe("noopProvider", () => {
  it("declares all ten capabilities as true", () => {
    expect(noopProvider.capabilities).toEqual({
      identify: true,
      group: true,
      alias: true,
      page: true,
      screen: true,
      batching: true,
      offline: true,
      featureFlags: true,
      sessionReplay: true,
      heatmaps: true,
    });
  });

  it("track() does not throw", () => {
    expect(() => noopProvider.track(sampleEvent)).not.toThrow();
  });

  it("identify() does not throw", () => {
    expect(() => noopProvider.identify?.("user-1", { plan: "pro" }, "anon-1")).not.toThrow();
  });

  it("group() does not throw", () => {
    expect(() =>
      noopProvider.group?.("group-1", { tier: "enterprise" }, { userId: "user-1", anonymousId: "anon-1" }),
    ).not.toThrow();
  });

  it("alias() does not throw", () => {
    expect(() => noopProvider.alias?.("user-1", "user-0", "anon-1")).not.toThrow();
  });

  it("page() does not throw", () => {
    expect(() => noopProvider.page?.(sampleEvent)).not.toThrow();
  });

  it("screen() does not throw", () => {
    expect(() => noopProvider.screen?.(sampleEvent)).not.toThrow();
  });

  it("flush() does not throw and resolves", async () => {
    await expect(noopProvider.flush?.()).resolves.toBeUndefined();
  });

  it("reset() does not throw", () => {
    expect(() => noopProvider.reset?.()).not.toThrow();
  });

  it("destroy() does not throw and resolves", async () => {
    await expect(noopProvider.destroy?.()).resolves.toBeUndefined();
  });
});
