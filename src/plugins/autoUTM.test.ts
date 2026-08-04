// Unit tests for Phase 10 issue 005's `autoUTM()`: the UTM-presence branch
// logic exercised by invoking the plugin's own setup function directly
// against a hand-constructed stub `location`/`sessionStorage` and a
// hand-written fake `Analytics` (`{ track: mock fn }`) -- no `createAnalytics()`,
// no providers, no real `sessionStorage`. Full `createAnalytics()`
// round-trip wiring/persistence is exercised by
// `autoUTM.integration.test.ts` instead.
//
// Browser-environment stubbing reuses `src/context.test.ts`'s
// `Object.defineProperty(globalThis, ...)` technique (manual stub, always
// torn down in `afterEach`) -- see that file's header comment for the full
// rationale.
import { afterEach, describe, expect, it, mock } from "bun:test";
import { autoUTM } from "./autoUTM";
import type { Analytics } from "../index";

interface StorageStub {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function makeWorkingStorage(initial: Record<string, string> = {}): {
  storage: StorageStub;
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    storage: {
      getItem: (key: string) => (key in data ? data[key]! : null),
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    },
  };
}

function makeThrowingStorage(): StorageStub {
  return {
    getItem: () => {
      throw new Error("sessionStorage disabled");
    },
    setItem: () => {
      throw new Error("sessionStorage disabled");
    },
  };
}

function stubBrowserGlobals(search = "", storage?: StorageStub | undefined): void {
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "location", { value: { search }, configurable: true, writable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true, writable: true });
}

function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator", "location", "sessionStorage"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearBrowserGlobals();
});

// Hand-written stub satisfying `Plugin`'s `Analytics<any>` setup parameter --
// only `.track` is needed.
function makeTrackStub(): { track: ReturnType<typeof mock>; instance: Analytics<any> } {
  const track = mock(() => {});
  return { track, instance: { track } as unknown as Analytics<any> };
}

describe("autoUTM()", () => {
  it("is a no-op (no throw, no track call) with no window/location present", () => {
    const { track, instance } = makeTrackStub();

    expect(() => autoUTM()(instance)).not.toThrow();
    expect(track).not.toHaveBeenCalled();
  });

  it("fires exactly one Campaign Landing track call with the parsed campaign object when UTM params are present, and persists it to sessionStorage under the default key", () => {
    const { storage, data } = makeWorkingStorage();
    stubBrowserGlobals("?utm_source=newsletter&utm_medium=email&utm_campaign=launch", storage);
    const { track, instance } = makeTrackStub();

    const teardown = autoUTM()(instance);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("Campaign Landing", {
      source: "newsletter",
      medium: "email",
      campaign: "launch",
    });
    expect(JSON.parse(data["typetrack_first_touch_campaign"]!)).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "launch",
    });
    expect(teardown).toBeUndefined();
  });

  it("persists under a custom storageKey when supplied", () => {
    const { storage, data } = makeWorkingStorage();
    stubBrowserGlobals("?utm_source=newsletter", storage);
    const { instance } = makeTrackStub();

    autoUTM({ storageKey: "custom_key" })(instance);

    expect(data["custom_key"]).toBeDefined();
    expect(data["typetrack_first_touch_campaign"]).toBeUndefined();
  });

  it("no UTM params and no prior persisted value: zero track calls, nothing written to storage", () => {
    const { storage, data } = makeWorkingStorage();
    stubBrowserGlobals("", storage);
    const { track, instance } = makeTrackStub();

    autoUTM()(instance);

    expect(track).not.toHaveBeenCalled();
    expect(Object.keys(data)).toHaveLength(0);
  });

  it("no UTM params but a prior persisted value present: zero track calls (no re-fire), existing persisted value left untouched", () => {
    const previouslyPersisted = JSON.stringify({ source: "newsletter" });
    const { storage, data } = makeWorkingStorage({
      typetrack_first_touch_campaign: previouslyPersisted,
    });
    stubBrowserGlobals("", storage);
    const { track, instance } = makeTrackStub();

    autoUTM()(instance);

    expect(track).not.toHaveBeenCalled();
    expect(data["typetrack_first_touch_campaign"]).toBe(previouslyPersisted);
  });

  it("re-fires on a subsequent setup when UTM params are still present in the URL (e.g. a reload)", () => {
    const { storage } = makeWorkingStorage();
    stubBrowserGlobals("?utm_source=newsletter", storage);
    const { track, instance } = makeTrackStub();

    autoUTM()(instance);
    autoUTM()(instance);

    expect(track).toHaveBeenCalledTimes(2);
  });

  it("a throwing sessionStorage on read/write never crashes setup, and still fires the landing event when UTM params are present in the URL", () => {
    stubBrowserGlobals("?utm_source=newsletter", makeThrowingStorage());
    const { track, instance } = makeTrackStub();

    expect(() => autoUTM()(instance)).not.toThrow();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("Campaign Landing", { source: "newsletter" });
  });

  it("a throwing sessionStorage with no UTM params in the URL never crashes setup and results in no track call", () => {
    stubBrowserGlobals("", makeThrowingStorage());
    const { track, instance } = makeTrackStub();

    expect(() => autoUTM()(instance)).not.toThrow();
    expect(track).not.toHaveBeenCalled();
  });

  it("no-ops without throwing when sessionStorage itself is undefined (browser present, storage absent)", () => {
    stubBrowserGlobals("?utm_source=newsletter", undefined);
    const { track, instance } = makeTrackStub();

    expect(() => autoUTM()(instance)).not.toThrow();
    expect(track).toHaveBeenCalledTimes(1);
  });
});
