// Unit tests for `src/consent.ts` (Phase 11 issue 001). Pure logic, no I/O
// beyond reading browser globals -- per the issue's "Test requirements",
// this module has nothing meaningful to integration-test in isolation
// (issue 002's integration tests cover the wired-in behavior once this
// module is consumed by `createAnalytics()`).
//
// Browser-environment stubbing reuses the exact `Object.defineProperty(globalThis,
// ...)` technique `src/context.test.ts` established, always torn down in
// `afterEach`.
import { afterEach, describe, expect, it } from "bun:test";
import {
  detectBrowserPrivacySignal,
  hasConsent,
  isConsentedForCategories,
  isConsentedForProvider,
  resolveDefaultState,
} from "./consent";
import type { ConsentState } from "./consent";

interface PrivacyStub {
  doNotTrack?: string;
  globalPrivacyControl?: boolean;
}

function stubBrowserGlobals(stub: PrivacyStub = {}): void {
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: { doNotTrack: stub.doNotTrack, globalPrivacyControl: stub.globalPrivacyControl },
    configurable: true,
    writable: true,
  });
}

function stubThrowingNavigator(): void {
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    get() {
      throw new Error("boom");
    },
    configurable: true,
  });
}

function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearBrowserGlobals();
});

describe("hasConsent", () => {
  it("returns true when the category is explicitly granted", () => {
    const state: ConsentState = { analytics: "granted" };
    expect(hasConsent(state, "analytics", "denied")).toBe(true);
  });

  it("returns false when the category is explicitly denied", () => {
    const state: ConsentState = { analytics: "denied" };
    expect(hasConsent(state, "analytics", "granted")).toBe(false);
  });

  it("falls back to defaultState when the category has no explicit entry", () => {
    const state: ConsentState = {};
    expect(hasConsent(state, "analytics", "granted")).toBe(true);
    expect(hasConsent(state, "analytics", "denied")).toBe(false);
  });

  it("is pure and never mutates its inputs", () => {
    const state: ConsentState = { analytics: "granted" };
    const snapshot = { ...state };
    hasConsent(state, "marketing", "denied");
    expect(state).toEqual(snapshot);
  });

  it("never throws", () => {
    expect(() => hasConsent({}, "anything", "denied")).not.toThrow();
  });
});

describe("isConsentedForCategories", () => {
  it("returns true when categories is undefined, regardless of state (vacuous case)", () => {
    const state: ConsentState = { analytics: "denied" };
    expect(isConsentedForCategories(state, undefined, "denied")).toBe(true);
  });

  it("returns true when categories is an empty array, regardless of state (vacuous case)", () => {
    const state: ConsentState = { analytics: "denied" };
    expect(isConsentedForCategories(state, [], "denied")).toBe(true);
  });

  it("returns true only if every listed category resolves granted", () => {
    const state: ConsentState = { analytics: "granted", marketing: "granted" };
    expect(isConsentedForCategories(state, ["analytics", "marketing"], "denied")).toBe(true);
  });

  it("returns false when one of several required categories is denied", () => {
    const state: ConsentState = { analytics: "granted", marketing: "denied" };
    expect(isConsentedForCategories(state, ["analytics", "marketing"], "granted")).toBe(false);
  });

  it("falls back to defaultState for categories with no explicit entry", () => {
    const state: ConsentState = {};
    expect(isConsentedForCategories(state, ["analytics"], "granted")).toBe(true);
    expect(isConsentedForCategories(state, ["analytics"], "denied")).toBe(false);
  });

  it("is pure and never mutates its inputs", () => {
    const state: ConsentState = { analytics: "granted" };
    const snapshot = { ...state };
    isConsentedForCategories(state, ["analytics"], "denied");
    expect(state).toEqual(snapshot);
  });

  it("never throws", () => {
    expect(() => isConsentedForCategories({}, ["analytics"], "denied")).not.toThrow();
  });
});

describe("isConsentedForProvider", () => {
  it("returns true when requiresConsent is undefined, without ever invoking fn", () => {
    let called = false;
    const fn = () => {
      called = true;
      return false;
    };
    expect(isConsentedForProvider(undefined, fn)).toBe(true);
    expect(called).toBe(false);
  });

  it("returns true when requiresConsent is an empty array, without ever invoking fn", () => {
    let called = false;
    const fn = () => {
      called = true;
      return false;
    };
    expect(isConsentedForProvider([], fn)).toBe(true);
    expect(called).toBe(false);
  });

  it("returns true only if every listed category is consented via the predicate", () => {
    const fn = (category: string) => category === "analytics" || category === "marketing";
    expect(isConsentedForProvider(["analytics", "marketing"], fn)).toBe(true);
  });

  it("returns false when one of several required categories is denied via the predicate", () => {
    const fn = (category: string) => category === "analytics";
    expect(isConsentedForProvider(["analytics", "marketing"], fn)).toBe(false);
  });

  it("never throws", () => {
    expect(() => isConsentedForProvider(["analytics"], () => true)).not.toThrow();
  });
});

describe("detectBrowserPrivacySignal", () => {
  it("returns false in the default (non-DOM) Bun test environment", () => {
    expect(detectBrowserPrivacySignal()).toBe(false);
  });

  it('returns true when navigator.doNotTrack is "1"', () => {
    stubBrowserGlobals({ doNotTrack: "1" });
    expect(detectBrowserPrivacySignal()).toBe(true);
  });

  it('returns true when navigator.doNotTrack is "yes"', () => {
    stubBrowserGlobals({ doNotTrack: "yes" });
    expect(detectBrowserPrivacySignal()).toBe(true);
  });

  it("returns true when navigator.globalPrivacyControl is true", () => {
    stubBrowserGlobals({ globalPrivacyControl: true });
    expect(detectBrowserPrivacySignal()).toBe(true);
  });

  it("returns false when neither signal is set, in a browser environment", () => {
    stubBrowserGlobals();
    expect(detectBrowserPrivacySignal()).toBe(false);
  });

  it('returns false when doNotTrack is some other, non-matching value (e.g. "0")', () => {
    stubBrowserGlobals({ doNotTrack: "0" });
    expect(detectBrowserPrivacySignal()).toBe(false);
  });

  it("never throws when navigator itself is stubbed to throw on property access", () => {
    stubThrowingNavigator();
    expect(() => detectBrowserPrivacySignal()).not.toThrow();
    expect(detectBrowserPrivacySignal()).toBe(false);
  });
});

describe("resolveDefaultState", () => {
  it("returns 'denied' when options is undefined", () => {
    expect(resolveDefaultState(undefined)).toBe("denied");
  });

  it("returns 'denied' when options is an empty object", () => {
    expect(resolveDefaultState({})).toBe("denied");
  });

  it("returns 'granted' when defaultState is 'granted' and respectBrowserSignals is unset", () => {
    expect(resolveDefaultState({ defaultState: "granted" })).toBe("granted");
  });

  it("returns 'denied' when defaultState is unset and respectBrowserSignals is false, no signal present", () => {
    expect(resolveDefaultState({ respectBrowserSignals: false })).toBe("denied");
  });

  it("returns 'denied' when defaultState is 'granted' but respectBrowserSignals is true and a signal is present", () => {
    stubBrowserGlobals({ globalPrivacyControl: true });
    expect(resolveDefaultState({ defaultState: "granted", respectBrowserSignals: true })).toBe(
      "denied",
    );
  });

  it("returns 'granted' when defaultState is 'granted', respectBrowserSignals is true, but no signal is present", () => {
    stubBrowserGlobals();
    expect(resolveDefaultState({ defaultState: "granted", respectBrowserSignals: true })).toBe(
      "granted",
    );
  });

  it("returns 'denied' when defaultState is unset, respectBrowserSignals is true, and a signal is present", () => {
    stubBrowserGlobals({ doNotTrack: "1" });
    expect(resolveDefaultState({ respectBrowserSignals: true })).toBe("denied");
  });

  it("returns 'denied' when defaultState is unset, respectBrowserSignals is true, and no signal is present", () => {
    stubBrowserGlobals();
    expect(resolveDefaultState({ respectBrowserSignals: true })).toBe("denied");
  });

  it("respectBrowserSignals=true with no signal present outside a browser environment: falls back to defaultState ?? 'denied'", () => {
    expect(resolveDefaultState({ defaultState: "granted", respectBrowserSignals: true })).toBe(
      "granted",
    );
    expect(resolveDefaultState({ respectBrowserSignals: true })).toBe("denied");
  });
});
