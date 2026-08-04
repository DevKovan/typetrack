// Unit tests for `src/context.ts` (Phase 9 issue 001). Pure logic, no I/O --
// per the issue's "Test requirements", this module has nothing meaningful to
// integration-test in isolation (issue 002's integration tests cover the
// wired-in behavior once this module is consumed by `createAnalytics()`).
//
// Browser-environment stubbing is done via `Object.defineProperty(globalThis,
// ...)` rather than a DOM test-environment dependency (e.g.
// `@happy-dom/global-registrator`, already a devDependency elsewhere in this
// repo) -- this repo's own test files (see `src/index.global.integration.test.ts`'s
// comments) flag that registering real DOM globals leaks across the *entire*
// `bun test` process (a single repo-wide run), which would be unacceptable
// collateral for a module that needs many different, narrow UA/location/
// referrer/viewport combinations per test. Manual stubbing gives full control
// per test and is always torn down in `afterEach`, restoring the ambient
// "no browser globals" state the rest of the suite (and this file's own
// `isBrowserEnvironment() === false` assertions) depends on.
import { afterEach, describe, expect, it } from "bun:test";
import {
  captureDynamicContext,
  captureStaticContext,
  isBrowserEnvironment,
  parseCampaign,
  parseUserAgent,
} from "./context";

interface BrowserStub {
  userAgent?: string;
  language?: string;
  innerWidth?: number;
  innerHeight?: number;
  referrer?: string;
  search?: string;
}

function stubBrowserGlobals(stub: BrowserStub = {}): void {
  Object.defineProperty(globalThis, "window", {
    value: { innerWidth: stub.innerWidth, innerHeight: stub.innerHeight },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: stub.userAgent ?? "", language: stub.language },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: { referrer: stub.referrer ?? "" },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "location", {
    value: { search: stub.search ?? "" },
    configurable: true,
    writable: true,
  });
}

function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator", "document", "location"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearBrowserGlobals();
});

describe("isBrowserEnvironment", () => {
  it("returns false in the default (non-DOM) test environment", () => {
    expect(isBrowserEnvironment()).toBe(false);
  });

  it("returns true once both `window` and `navigator` are stubbed present", () => {
    stubBrowserGlobals();
    expect(isBrowserEnvironment()).toBe(true);
  });

  it("returns false if only `window` is present without `navigator`", () => {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
    expect(isBrowserEnvironment()).toBe(false);
  });
});

describe("parseUserAgent", () => {
  it("Chrome on Windows desktop", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(parseUserAgent(ua)).toEqual({
      browser: { name: "Chrome", version: "120.0.0.0" },
      os: { name: "Windows", version: "10.0" },
      device: { type: "desktop" },
    });
  });

  it("Safari on macOS desktop", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(parseUserAgent(ua)).toEqual({
      browser: { name: "Safari", version: "17.0" },
      os: { name: "macOS", version: "10.15.7" },
      device: { type: "desktop" },
    });
  });

  it("Safari on iOS (iPhone, mobile)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toEqual({
      browser: { name: "Safari", version: "17.0" },
      os: { name: "iOS", version: "17.0" },
      device: { type: "mobile" },
    });
  });

  it("Chrome on Android (mobile)", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(parseUserAgent(ua)).toEqual({
      browser: { name: "Chrome", version: "120.0.0.0" },
      os: { name: "Android", version: "13" },
      device: { type: "mobile" },
    });
  });

  it("Firefox on Linux desktop", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0";
    expect(parseUserAgent(ua)).toEqual({
      browser: { name: "Firefox", version: "121.0" },
      os: { name: "Linux" },
      device: { type: "desktop" },
    });
  });

  it("an iPad UA (tablet)", () => {
    const ua =
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toEqual({
      browser: { name: "Safari", version: "17.0" },
      os: { name: "iOS", version: "17.0" },
      device: { type: "tablet" },
    });
  });

  it("garbage/unrecognized UA string: returns {} rather than guessing", () => {
    expect(parseUserAgent("not-a-real-user-agent-string")).toEqual({});
  });

  it("empty-string UA: returns {}, never throws", () => {
    expect(() => parseUserAgent("")).not.toThrow();
    expect(parseUserAgent("")).toEqual({});
  });
});

describe("captureStaticContext", () => {
  it("always includes non-empty locale/timezone; browser/os/device absent outside a browser environment", () => {
    const result = captureStaticContext();

    expect(typeof result.locale).toBe("string");
    expect(result.locale?.length).toBeGreaterThan(0);
    expect(typeof result.timezone).toBe("string");
    expect(result.timezone?.length).toBeGreaterThan(0);

    expect(result.browser).toBeUndefined();
    expect(result.os).toBeUndefined();
    expect(result.device).toBeUndefined();
    expect("browser" in result).toBe(false);
    expect("os" in result).toBe(false);
    expect("device" in result).toBe(false);
  });

  it("includes browser/os/device once a browser environment is stubbed, parsed from navigator.userAgent", () => {
    stubBrowserGlobals({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      language: "en-US",
    });

    const result = captureStaticContext();

    expect(typeof result.locale).toBe("string");
    expect(result.locale?.length).toBeGreaterThan(0);
    expect(typeof result.timezone).toBe("string");
    expect(result.browser).toEqual({ name: "Chrome", version: "120.0.0.0" });
    expect(result.os).toEqual({ name: "Windows", version: "10.0" });
    expect(result.device).toEqual({ type: "desktop" });
  });

  it("prefers navigator.language over Intl's locale when in a browser environment", () => {
    stubBrowserGlobals({ userAgent: "irrelevant-for-this-assertion", language: "fr-FR" });

    const result = captureStaticContext();

    expect(result.locale).toBe("fr-FR");
  });
});

describe("captureDynamicContext", () => {
  it("no ContextOptions supplied: never throws, no featureFlags key", () => {
    expect(() => captureDynamicContext(undefined)).not.toThrow();
    const result = captureDynamicContext(undefined);
    expect("featureFlags" in result).toBe(false);
  });

  it("featureFlags getter supplied: mirrors its return value verbatim, regardless of browser environment", () => {
    const result = captureDynamicContext({ featureFlags: () => ({ foo: true }) });
    expect(result.featureFlags).toEqual({ foo: true });
  });

  it("featureFlags getter supplied in a stubbed browser environment: still mirrored verbatim", () => {
    stubBrowserGlobals();
    const result = captureDynamicContext({ featureFlags: () => ({ foo: true, bar: 42 }) });
    expect(result.featureFlags).toEqual({ foo: true, bar: 42 });
  });

  it("featureFlags getter that throws: omitted, does not propagate", () => {
    const result = captureDynamicContext({
      featureFlags: () => {
        throw new Error("boom");
      },
    });
    expect("featureFlags" in result).toBe(false);
  });

  it("full UTM query string in a stubbed browser environment: all five campaign fields populated", () => {
    stubBrowserGlobals({
      search: "?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_term=analytics&utm_content=cta-button",
    });

    const result = captureDynamicContext(undefined);

    expect(result.campaign).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "launch",
      term: "analytics",
      content: "cta-button",
    });
  });

  it("partial UTM query string: only present params are populated, others omitted (not present as keys)", () => {
    stubBrowserGlobals({ search: "?utm_source=newsletter&utm_medium=email" });

    const result = captureDynamicContext(undefined);

    expect(result.campaign).toEqual({ source: "newsletter", medium: "email" });
    expect(result.campaign && "campaign" in result.campaign).toBe(false);
    expect(result.campaign && "term" in result.campaign).toBe(false);
    expect(result.campaign && "content" in result.campaign).toBe(false);
  });

  it("no UTM params at all: campaign is omitted entirely, not an empty object", () => {
    stubBrowserGlobals({ search: "?foo=bar" });

    const result = captureDynamicContext(undefined);

    expect(result.campaign).toBeUndefined();
    expect("campaign" in result).toBe(false);
  });

  it("outside a browser environment: campaign is omitted even with UTM-shaped state elsewhere", () => {
    const result = captureDynamicContext(undefined);
    expect("campaign" in result).toBe(false);
  });

  it("non-empty document.referrer in a stubbed browser environment: included verbatim", () => {
    stubBrowserGlobals({ referrer: "https://example.com/" });

    const result = captureDynamicContext(undefined);

    expect(result.referrer).toBe("https://example.com/");
  });

  it("empty-string document.referrer: omitted entirely", () => {
    stubBrowserGlobals({ referrer: "" });

    const result = captureDynamicContext(undefined);

    expect("referrer" in result).toBe(false);
  });

  it("outside a browser environment: referrer is omitted", () => {
    const result = captureDynamicContext(undefined);
    expect("referrer" in result).toBe(false);
  });

  it("live window.innerWidth/innerHeight in a stubbed browser environment: included as viewport", () => {
    stubBrowserGlobals({ innerWidth: 1280, innerHeight: 720 });

    const result = captureDynamicContext(undefined);

    expect(result.viewport).toEqual({ width: 1280, height: 720 });
  });

  it("outside a browser environment: viewport is omitted", () => {
    const result = captureDynamicContext(undefined);
    expect("viewport" in result).toBe(false);
  });

  it("re-reads window/document/location live on every call (not cached across calls)", () => {
    stubBrowserGlobals({ innerWidth: 800, innerHeight: 600, referrer: "https://first.example/" });
    const first = captureDynamicContext(undefined);
    expect(first.viewport).toEqual({ width: 800, height: 600 });
    expect(first.referrer).toBe("https://first.example/");

    stubBrowserGlobals({ innerWidth: 1024, innerHeight: 768, referrer: "https://second.example/" });
    const second = captureDynamicContext(undefined);
    expect(second.viewport).toEqual({ width: 1024, height: 768 });
    expect(second.referrer).toBe("https://second.example/");
  });
});

// `parseCampaign` itself is exercised thoroughly (all-five-present,
// subset-present, none-present) via `captureDynamicContext`'s existing
// tests above -- this is a minimal smoke test confirming the Phase 10
// issue 005 export change (module-private -> exported) didn't alter
// behavior, not a duplicate of that coverage.
describe("parseCampaign (Phase 10 issue 005's newly public export)", () => {
  it("parses UTM params directly from a search string, independent of captureDynamicContext/location", () => {
    expect(parseCampaign("?utm_source=newsletter&utm_medium=email")).toEqual({
      source: "newsletter",
      medium: "email",
    });
  });

  it("returns undefined when no UTM params are present", () => {
    expect(parseCampaign("?foo=bar")).toBeUndefined();
  });
});
