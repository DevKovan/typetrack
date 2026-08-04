// Integration tests for Phase 10 issue 005: a real `createAnalytics({
// plugins: [autoUTM()] })`, a hand-written recording stub provider (not a
// mock -- records its own received `.track()` calls into a plain array,
// mirroring `autoPage.integration.test.ts`'s convention), a realistic
// in-memory `sessionStorage` stub, and a stubbed browser global (reusing
// `src/context.test.ts`'s `Object.defineProperty(globalThis, ...)`
// technique), exercising the full round trip: UTM-present (landing event +
// persistence), UTM-absent-with-persisted-value (no re-fire, persisted
// value untouched), UTM-absent-with-nothing-persisted (no-op), and the
// non-browser no-op.
import { afterEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "../index";
import { autoUTM } from "./autoUTM";
import type { AnalyticsProvider } from "../providers";
import type { CanonicalEvent } from "../schema";
import { allCapabilities } from "../test-support";

function makeRecordingProvider(): { provider: AnalyticsProvider; trackEvents: CanonicalEvent[] } {
  const trackEvents: CanonicalEvent[] = [];
  const provider: AnalyticsProvider = {
    name: "recording",
    capabilities: allCapabilities,
    track(event) {
      trackEvents.push(event);
    },
    page() {},
    async flush() {},
    async destroy() {},
  };
  return { provider, trackEvents };
}

// A realistic in-memory `sessionStorage` stub -- implements the
// `Storage`-like subset this plugin actually uses (`getItem`/`setItem`), so
// integration tests exercise real read-after-write persistence semantics
// rather than a hand-wired recording double.
function makeSessionStorage(): { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (key: string) => (key in data ? data[key]! : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

function stubBrowserGlobals(search = "", sessionStorage?: unknown): void {
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "location", { value: { search }, configurable: true, writable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
}

function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator", "location", "sessionStorage"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearBrowserGlobals();
});

describe("autoUTM() integration", () => {
  it("UTM params present: fires exactly one Campaign Landing track call via a real createAnalytics() round trip, and persists the campaign to sessionStorage", async () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserGlobals(
      "?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_term=analytics&utm_content=cta-button",
      sessionStorage,
    );
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoUTM()] });

    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.name).toBe("Campaign Landing");
    expect(trackEvents[0]!.properties).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "launch",
      term: "analytics",
      content: "cta-button",
    });

    expect(JSON.parse(sessionStorage.data["typetrack_first_touch_campaign"]!)).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "launch",
      term: "analytics",
      content: "cta-button",
    });

    await analytics.destroy();
  });

  it("a custom storageKey is honored for persistence", async () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserGlobals("?utm_source=newsletter", sessionStorage);
    const { provider } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoUTM({ storageKey: "my_custom_key" })] });

    expect(sessionStorage.data["my_custom_key"]).toBeDefined();
    expect(sessionStorage.data["typetrack_first_touch_campaign"]).toBeUndefined();

    await analytics.destroy();
  });

  it("UTM params absent but a value was persisted earlier this session: no re-fire, persisted value left untouched", async () => {
    const sessionStorage = makeSessionStorage();
    // Simulate an earlier page load this session having already persisted a
    // first-touch campaign.
    sessionStorage.setItem("typetrack_first_touch_campaign", JSON.stringify({ source: "newsletter" }));
    stubBrowserGlobals("", sessionStorage);
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoUTM()] });

    expect(trackEvents.length).toBe(0);
    expect(sessionStorage.data["typetrack_first_touch_campaign"]).toBe(JSON.stringify({ source: "newsletter" }));

    await analytics.destroy();
  });

  it("UTM params absent and nothing persisted: zero track calls, nothing written to storage", async () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserGlobals("", sessionStorage);
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoUTM()] });

    expect(trackEvents.length).toBe(0);
    expect(Object.keys(sessionStorage.data)).toHaveLength(0);

    await analytics.destroy();
  });

  it("never throws and delivers zero track calls when no window/navigator/location are present", async () => {
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoUTM()] });
    }).not.toThrow();

    expect(trackEvents.length).toBe(0);

    await expect(analytics.destroy()).resolves.toBeUndefined();
  });

  it("a throwing sessionStorage still fires the landing event through a real createAnalytics() round trip, without crashing setup", async () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("sessionStorage disabled");
      },
      setItem: () => {
        throw new Error("sessionStorage disabled");
      },
    };
    stubBrowserGlobals("?utm_source=newsletter", throwingStorage);
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoUTM()] });
    }).not.toThrow();

    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.name).toBe("Campaign Landing");

    await analytics.destroy();
  });
});
