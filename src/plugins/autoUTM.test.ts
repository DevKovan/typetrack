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
// only `.track` (and, since Phase 11 issue 006, `.cookieless`) is needed.
// `cookieless` defaults to `false`, matching `createAnalytics()`'s own
// default, so every pre-issue-006 call site below is unaffected.
function makeTrackStub(cookieless = false): { track: ReturnType<typeof mock>; instance: Analytics<any> } {
  const track = mock(() => {});
  return { track, instance: { track, cookieless } as unknown as Analytics<any> };
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

  describe("cookieless mode (Phase 11 issue 006)", () => {
    it("cookieless: true, UTM params present: fires the Campaign Landing track call but never calls sessionStorage.setItem", () => {
      const { storage, data } = makeWorkingStorage();
      const setItem = mock(storage.setItem);
      stubBrowserGlobals("?utm_source=newsletter&utm_medium=email&utm_campaign=launch", {
        ...storage,
        setItem,
      });
      const { track, instance } = makeTrackStub(true);

      const teardown = autoUTM()(instance);

      expect(track).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenCalledWith("Campaign Landing", {
        source: "newsletter",
        medium: "email",
        campaign: "launch",
      });
      expect(setItem).not.toHaveBeenCalled();
      expect(Object.keys(data)).toHaveLength(0);
      expect(teardown).toBeUndefined();
    });

    it("cookieless: true, no UTM params in the current URL: no Campaign Landing event fires, and sessionStorage.getItem is never called", () => {
      const previouslyPersisted = JSON.stringify({ source: "newsletter" });
      const { storage } = makeWorkingStorage({
        typetrack_first_touch_campaign: previouslyPersisted,
      });
      const getItem = mock(storage.getItem);
      stubBrowserGlobals("", { ...storage, getItem });
      const { track, instance } = makeTrackStub(true);

      autoUTM()(instance);

      expect(track).not.toHaveBeenCalled();
      expect(getItem).not.toHaveBeenCalled();
    });

    it("cookieless: false (explicit): zero behavior change -- still persists to sessionStorage exactly as the omitted-cookieless case does", () => {
      const { storage, data } = makeWorkingStorage();
      stubBrowserGlobals("?utm_source=newsletter", storage);
      const { track, instance } = makeTrackStub(false);

      autoUTM()(instance);

      expect(track).toHaveBeenCalledTimes(1);
      expect(JSON.parse(data["typetrack_first_touch_campaign"]!)).toEqual({ source: "newsletter" });
    });
  });
});
