// Integration tests for Phase 10 issue 003's `autoClicks`/`autoScroll`/
// `autoVisibility`: a real `createAnalytics({ plugins: [...] })`, a
// hand-written recording stub provider (not a mock -- records its own
// received `.track()` calls into a plain array, mirroring
// `autoPage.integration.test.ts`'s convention), and a stubbed browser global
// (reusing `src/context.test.ts`'s `Object.defineProperty(globalThis, ...)`
// technique, extended with minimal `document.addEventListener`/
// `removeEventListener` stubs and top-level `addEventListener`/
// `removeEventListener` stubs, sufficient to simulate click/scroll/
// visibilitychange events) exercising the full round trip for all three
// plugins: setup, simulated interaction, and `destroy()`-driven teardown.
import { afterEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "../index";
import { autoClicks } from "./autoClicks";
import { autoScroll } from "./autoScroll";
import { autoVisibility } from "./autoVisibility";
import type { MinimalElement } from "./autoClicks";
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
    async flush() {},
    async destroy() {},
  };
  return { provider, trackEvents };
}

type Listener = (...args: any[]) => void;

interface StubbedBrowser {
  fireClick: (target: unknown) => void;
  fireScroll: () => void;
  fireVisibilityChange: () => void;
  setScrollState: (state: { scrollY: number; innerHeight: number; scrollHeight: number }) => void;
  setVisibilityState: (state: string) => void;
}

// Stubs `window`/`navigator`/`document`/top-level `addEventListener`/
// `removeEventListener`/`scrollY`/`innerHeight` as top-level `globalThis`
// properties (matching `src/context.test.ts`'s convention, and these
// plugins' own reads off `globalThis` directly rather than nested under a
// `window` object). `document` gets its own `addEventListener`/
// `removeEventListener` pair (for `click`/`visibilitychange`), separate
// from the top-level pair (for `scroll`), mirroring how a real browser
// distinguishes `document.addEventListener` from `window.addEventListener`.
function stubBrowserGlobals(): StubbedBrowser {
  const documentListeners = new Map<string, Set<Listener>>();
  const windowListeners = new Map<string, Set<Listener>>();
  const documentElement = { scrollHeight: 1000 };
  const documentStub = {
    visibilityState: "visible",
    documentElement,
    addEventListener(type: string, listener: Listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      documentListeners.get(type)?.delete(listener);
    },
  };

  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "document", { value: documentStub, configurable: true, writable: true });
  Object.defineProperty(globalThis, "scrollY", { value: 0, configurable: true, writable: true });
  Object.defineProperty(globalThis, "innerHeight", { value: 0, configurable: true, writable: true });
  Object.defineProperty(globalThis, "addEventListener", {
    value: (type: string, listener: Listener, _options?: unknown) => {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type)!.add(listener);
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "removeEventListener", {
    value: (type: string, listener: Listener) => {
      windowListeners.get(type)?.delete(listener);
    },
    configurable: true,
    writable: true,
  });

  return {
    fireClick(target: unknown) {
      for (const listener of documentListeners.get("click") ?? []) listener({ target });
    },
    fireScroll() {
      for (const listener of windowListeners.get("scroll") ?? []) listener();
    },
    fireVisibilityChange() {
      for (const listener of documentListeners.get("visibilitychange") ?? []) listener();
    },
    setScrollState({ scrollY, innerHeight, scrollHeight }) {
      Object.defineProperty(globalThis, "scrollY", { value: scrollY, configurable: true, writable: true });
      Object.defineProperty(globalThis, "innerHeight", { value: innerHeight, configurable: true, writable: true });
      documentElement.scrollHeight = scrollHeight;
    },
    setVisibilityState(state: string) {
      documentStub.visibilityState = state;
    },
  };
}

function clearBrowserGlobals(): void {
  for (const key of [
    "window",
    "navigator",
    "document",
    "scrollY",
    "innerHeight",
    "addEventListener",
    "removeEventListener",
  ] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearBrowserGlobals();
});

// A minimal click-target element chain: `child` is nested inside `button`.
// `closest` walks the parent chain, matching a bare-tag-name selector
// (e.g. "button") or a leading-dot class selector (e.g. ".card") -- this is
// only test-stub plumbing standing in for real DOM `Element.closest`
// behavior, not something the plugin itself implements.
function makeElementChain(): { button: MinimalElement; child: MinimalElement; outsider: MinimalElement } {
  function matches(element: MinimalElement, selector: string): boolean {
    if (selector.startsWith(".")) {
      return (element.className ?? "").split(/\s+/).includes(selector.slice(1));
    }
    return element.tagName.toLowerCase() === selector.toLowerCase();
  }

  function withClosest(element: MinimalElement, parent?: MinimalElement): MinimalElement {
    element.closest = (selector: string) => {
      let current: MinimalElement | undefined = element;
      while (current) {
        if (matches(current, selector)) return current;
        current = current === element ? parent : undefined;
      }
      return null;
    };
    return element;
  }

  const button = withClosest({ tagName: "BUTTON", id: "submit", className: "btn primary", textContent: "Submit" });
  const child = withClosest({ tagName: "SPAN", textContent: "Submit" }, button);
  const outsider = withClosest({ tagName: "DIV", textContent: "outside" });

  return { button, child, outsider };
}

describe("autoClicks() integration", () => {
  it("tracks a click on any Element by default (no selector) with the auto-computed properties", () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();
    const { button } = makeElementChain();

    const analytics = createAnalytics({ provider, plugins: [autoClicks()] });

    browser.fireClick(button);

    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.name).toBe("Element Clicked");
    expect(trackEvents[0]!.properties).toEqual({
      tag: "button",
      id: "submit",
      classes: "btn primary",
      text: "Submit",
      href: undefined,
    });

    void analytics.destroy();
  });

  it("ignores a click whose target is not an Element (e.g. missing tagName)", () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoClicks()] });

    browser.fireClick({ notAnElement: true });
    browser.fireClick(null);

    expect(trackEvents.length).toBe(0);

    void analytics.destroy();
  });

  it("with a selector, ignores a click whose target is not inside a matching ancestor, and tracks one whose target is a descendant (via closest)", () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();
    const { child, outsider } = makeElementChain();

    const analytics = createAnalytics({ provider, plugins: [autoClicks({ selector: "button" })] });

    browser.fireClick(outsider);
    expect(trackEvents.length).toBe(0);

    browser.fireClick(child);
    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.properties?.tag).toBe("button");

    void analytics.destroy();
  });

  it("getProperties: caller-supplied keys override auto-computed ones on collision; non-colliding keys remain", () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();
    const { button } = makeElementChain();

    const analytics = createAnalytics({
      provider,
      plugins: [autoClicks({ getProperties: () => ({ tag: "custom-tag", extra: "value" }) })],
    });

    browser.fireClick(button);

    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.properties).toEqual({
      tag: "custom-tag",
      id: "submit",
      classes: "btn primary",
      text: "Submit",
      href: undefined,
      extra: "value",
    });

    void analytics.destroy();
  });

  it("teardown removes the click listener -- no further track() calls after destroy()", async () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();
    const { button } = makeElementChain();

    const analytics = createAnalytics({ provider, plugins: [autoClicks()] });
    browser.fireClick(button);
    expect(trackEvents.length).toBe(1);

    await analytics.destroy();

    browser.fireClick(button);
    expect(trackEvents.length).toBe(1);
  });

  it("never throws and attaches no listener when no window/navigator/document are present", async () => {
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoClicks()] });
    }).not.toThrow();

    expect(trackEvents.length).toBe(0);
    await expect(analytics.destroy()).resolves.toBeUndefined();
  });
});

describe("autoScroll() integration", () => {
  it("fires each configured threshold at most once across multiple scroll events that repeatedly cross the same threshold", () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoScroll({ thresholds: [25, 50, 100] })] });

    // 25% scrolled.
    browser.setScrollState({ scrollY: 150, innerHeight: 100, scrollHeight: 1000 });
    browser.fireScroll();
    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.name).toBe("Scroll Depth Reached");
    expect(trackEvents[0]!.properties).toEqual({ percent: 25 });

    // Still within the 25% band -- repeated crossing does not refire.
    browser.fireScroll();
    expect(trackEvents.length).toBe(1);

    // 50% scrolled.
    browser.setScrollState({ scrollY: 400, innerHeight: 100, scrollHeight: 1000 });
    browser.fireScroll();
    expect(trackEvents.length).toBe(2);
    expect(trackEvents[1]!.properties).toEqual({ percent: 50 });

    // 100% scrolled -- both remaining un-fired thresholds below it are
    // already fired, so only 100 fires now.
    browser.setScrollState({ scrollY: 900, innerHeight: 100, scrollHeight: 1000 });
    browser.fireScroll();
    expect(trackEvents.length).toBe(3);
    expect(trackEvents[2]!.properties).toEqual({ percent: 100 });

    // Further scroll events at 100% never refire anything.
    browser.fireScroll();
    expect(trackEvents.length).toBe(3);

    void analytics.destroy();
  });

  it("uses the default [25, 50, 75, 100] thresholds when none are supplied", () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoScroll()] });

    browser.setScrollState({ scrollY: 1000, innerHeight: 0, scrollHeight: 1000 });
    browser.fireScroll();

    expect(trackEvents.map((e) => e.properties?.percent)).toEqual([25, 50, 75, 100]);

    void analytics.destroy();
  });

  it("teardown removes the scroll listener -- no further track() calls after destroy()", async () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoScroll({ thresholds: [50] })] });

    browser.setScrollState({ scrollY: 500, innerHeight: 0, scrollHeight: 1000 });
    browser.fireScroll();
    expect(trackEvents.length).toBe(1);

    await analytics.destroy();

    browser.setScrollState({ scrollY: 1000, innerHeight: 0, scrollHeight: 1000 });
    browser.fireScroll();
    expect(trackEvents.length).toBe(1);
  });

  it("never throws and attaches no listener when no window/navigator/document are present", async () => {
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoScroll()] });
    }).not.toThrow();

    expect(trackEvents.length).toBe(0);
    await expect(analytics.destroy()).resolves.toBeUndefined();
  });
});

describe("autoVisibility() integration", () => {
  it("fires once per simulated visibilitychange event with the current document.visibilityState", () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoVisibility()] });

    browser.setVisibilityState("hidden");
    browser.fireVisibilityChange();
    expect(trackEvents.length).toBe(1);
    expect(trackEvents[0]!.name).toBe("Page Visibility Changed");
    expect(trackEvents[0]!.properties).toEqual({ state: "hidden" });

    browser.setVisibilityState("visible");
    browser.fireVisibilityChange();
    expect(trackEvents.length).toBe(2);
    expect(trackEvents[1]!.properties).toEqual({ state: "visible" });

    void analytics.destroy();
  });

  it("teardown removes the visibilitychange listener -- no further track() calls after destroy()", async () => {
    const browser = stubBrowserGlobals();
    const { provider, trackEvents } = makeRecordingProvider();

    const analytics = createAnalytics({ provider, plugins: [autoVisibility()] });

    browser.fireVisibilityChange();
    expect(trackEvents.length).toBe(1);

    await analytics.destroy();

    browser.fireVisibilityChange();
    expect(trackEvents.length).toBe(1);
  });

  it("never throws and attaches no listener when no window/navigator/document are present", async () => {
    const { provider, trackEvents } = makeRecordingProvider();

    let analytics!: ReturnType<typeof createAnalytics>;
    expect(() => {
      analytics = createAnalytics({ provider, plugins: [autoVisibility()] });
    }).not.toThrow();

    expect(trackEvents.length).toBe(0);
    await expect(analytics.destroy()).resolves.toBeUndefined();
  });
});
