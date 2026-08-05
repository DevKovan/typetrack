// Phase 13 issue 004: dedicated SSR-safety verification. Every browser-global
// access in this codebase already goes through `isBrowserEnvironment()`
// (Phase 9, `src/context.ts`) or an equivalent try/catch-never-throw guard
// (Phase 12's storage adapters, Phase 11's `detectBrowserPrivacySignal`) --
// this file does not add new guards, it adds explicit, dedicated,
// phase-13-owned test coverage proving that contract holds end-to-end, at a
// full `Analytics` instance level (not just per-module, the way
// `src/context.test.ts`/`src/consent.test.ts`/`src/reliability/storage.test.ts`
// already do in isolation).
//
// "SSR" here means: `typetrack` (core) must be importable and usable in a
// server-side/non-browser JavaScript environment (a Next.js/Remix/etc.
// server-rendering pass, a Cloudflare Worker, a Vercel Edge Function) where
// `window`/`document`/`navigator`/`localStorage`/`indexedDB`/`location` are
// either fully absent or must never be touched unconditionally.
//
// Design decision: stub-absent, not stub-falsy. `delete
// (globalThis as Record<string, unknown>)[key]` removes each browser global
// from `globalThis` entirely (rather than assigning `undefined` to a still-
// existing property) -- the more faithful simulation of a real edge/Worker
// runtime, where these globals genuinely do not exist on `globalThis` at
// all, matching how Cloudflare Workers/Vercel Edge actually behave. Mirrors
// `src/context.test.ts`'s `clearBrowserGlobals()` technique exactly, extended
// to also cover `localStorage`/`indexedDB` (Phase 12's reliability storage
// globals, not touched by `src/context.ts` itself).
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  autoClicks,
  autoErrors,
  autoPage,
  autoPerformance,
  autoScroll,
  autoUTM,
  autoVisibility,
  autoWebVitals,
  createAnalytics,
} from "./index";
import { detectBestStorage } from "./reliability/storage";

const BROWSER_GLOBAL_KEYS = ["window", "document", "navigator", "localStorage", "indexedDB", "location"] as const;

// Deletes every browser global from `globalThis`, if present. A no-op for a
// key that's already absent (the default in this repo's `bun test`
// environment -- see `src/context.test.ts`'s header comment) -- called both
// before and after every test in this file for defense-in-depth against
// cross-file leakage (this repo's own `src/index.global.integration.test.ts`
// documents that registering real DOM globals, e.g. via
// `@happy-dom/global-registrator`, leaks across the entire `bun test`
// process since every test file shares one process).
function deleteBrowserGlobals(): void {
  for (const key of BROWSER_GLOBAL_KEYS) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

beforeEach(() => {
  deleteBrowserGlobals();
});

afterEach(() => {
  deleteBrowserGlobals();
});

// Spies on both `console.warn` and `console.error` simultaneously, restoring
// both originals via the returned `restore()`. Used by the "every opt-in
// option enabled" scenario below to prove that no plugin setup failure (or
// any other swallow-and-warn path) is hiding a real crash behind a quietly
// logged warning -- `src/index.ts`'s plugin-setup loop swallows a throwing
// plugin's exception and reports it via exactly one `console.warn` call
// (verified by reading `src/index.ts` and `src/plugins.ts` directly), so
// "createAnalytics() didn't throw" alone would not be sufficient proof that
// every plugin's setup function actually completed without incident.
function stubConsole() {
  const warn = mock(() => {});
  const error = mock(() => {});
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = warn as unknown as typeof console.warn;
  console.error = error as unknown as typeof console.error;
  return {
    warn,
    error,
    restore() {
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}

describe("SSR safety: createAnalytics() with no browser globals present", () => {
  it("construct + every verb + flush + destroy: nothing throws", async () => {
    expect(() => createAnalytics()).not.toThrow();

    const analytics = createAnalytics();

    expect(() => analytics.track("Test Event", { foo: "bar" })).not.toThrow();
    expect(() => analytics.page("Home")).not.toThrow();
    expect(() => analytics.screen("Onboarding")).not.toThrow();
    expect(() => analytics.identify("user-1", { plan: "pro" })).not.toThrow();
    expect(() => analytics.group("acme", { plan: "pro" })).not.toThrow();
    expect(() => analytics.alias("user-2", "user-1")).not.toThrow();
    await expect(analytics.flush()).resolves.toBeUndefined();
    await expect(analytics.destroy()).resolves.toBeUndefined();
  });
});

describe("SSR safety: createAnalytics() with every opt-in browser-touching option enabled", () => {
  it("construct + every verb + destroy: nothing throws, zero console.warn/console.error calls", async () => {
    const console_ = stubConsole();

    try {
      let analytics: ReturnType<typeof createAnalytics> | undefined;

      expect(() => {
        analytics = createAnalytics({
          // Phase 9
          context: true,
          // Phase 10 -- every built-in plugin, all browser-only, all
          // guarded on `isBrowserEnvironment()` at the top of their own
          // setup function (verified by reading each plugin file directly).
          plugins: [
            autoPage(),
            autoClicks(),
            autoScroll(),
            autoVisibility(),
            autoErrors(),
            autoWebVitals(),
            autoPerformance(),
            autoUTM(),
          ],
          // Phase 11
          consent: { respectBrowserSignals: true },
          // Deliberately `false` (not omitted) -- confirms the *non*-
          // cookieless path (which would otherwise assume storage exists,
          // e.g. `autoUTM`'s sessionStorage persistence) doesn't crash
          // either, since `autoUTM` still bails out on
          // `!isBrowserEnvironment()` before ever reaching its
          // cookieless-gated sessionStorage calls.
          cookieless: false,
          // Phase 12
          reliability: { storage: "auto", flushOnUnload: true },
        });
      }).not.toThrow();

      const instance = analytics!;

      expect(() => instance.track("Test Event", { foo: "bar" })).not.toThrow();
      expect(() => instance.page("Home")).not.toThrow();
      expect(() => instance.screen("Onboarding")).not.toThrow();
      expect(() => instance.identify("user-1", { plan: "pro" })).not.toThrow();
      expect(() => instance.group("acme", { plan: "pro" })).not.toThrow();
      expect(() => instance.alias("user-2", "user-1")).not.toThrow();
      await expect(instance.flush()).resolves.toBeUndefined();
      await expect(instance.destroy()).resolves.toBeUndefined();

      // The core assertion: zero plugins threw during setup (which would
      // have surfaced as a `typetrack: plugin "..." threw during setup --
      // ...` console.warn, per `src/index.ts`'s plugin-setup loop), and
      // nothing else along the way (construction, every verb, destroy)
      // logged an unexpected warning/error either -- e.g. no capability-
      // gating warning (`noopProvider`, the default here, declares every
      // capability `true`), no provider-failure warning (`noopProvider`
      // never fails), no corrupt-storage warning (the resolved `"auto"`
      // storage adapter is the memory adapter outside a browser
      // environment -- see the dedicated test below -- which never logs).
      expect(console_.warn).not.toHaveBeenCalled();
      expect(console_.error).not.toHaveBeenCalled();
    } finally {
      console_.restore();
    }
  });
});

describe("SSR safety: reliability storage 'auto' resolution outside a browser environment", () => {
  it("detectBestStorage() resolves directly to the memory adapter (kind: 'memory')", () => {
    // Exercises Phase 12's `detectBestStorage`'s non-browser branch
    // directly -- not just indirectly via "createAnalytics({ reliability: {
    // storage: 'auto' } }) didn't throw" (the scenario above already proves
    // that much; this proves *which* adapter it actually resolved to).
    const adapter = detectBestStorage("ssr-safety-test");

    expect(adapter.kind).toBe("memory");
  });
});
