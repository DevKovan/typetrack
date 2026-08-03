import { createAnalytics, type AnalyticsProvider, type CanonicalEvent } from "typetrack";

// Phase 9's `context: true` opt-in, demonstrated end to end. Since real
// `window`/`navigator`/`document`/`location` globals don't exist in a plain
// Bun script, this example simulates a "real page load" by stubbing those
// globals before calling into `typetrack` -- the exact same
// `Object.defineProperty(globalThis, ...)` technique `src/context.test.ts`
// (issue 001's unit tests) already established, reused here rather than
// inventing a second approach.

interface BrowserStub {
  userAgent?: string;
  language?: string;
  innerWidth?: number;
  innerHeight?: number;
  referrer?: string;
  search?: string;
}

export function stubBrowserGlobals(stub: BrowserStub = {}): void {
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

export function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator", "document", "location"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

interface RecordedCall {
  type: "track" | "page";
  event: CanonicalEvent;
}

// A hand-written recording stub, not a mock -- collects every `track()`/
// `page()` call's real `CanonicalEvent` (including whatever `context` core
// merged onto it) so this example's flow, and `index.integration.test.ts`,
// can inspect the exact shape `typetrack` produced.
export function createRecordingProvider(): { provider: AnalyticsProvider; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const provider: AnalyticsProvider = {
    name: "context-capture-recorder",
    capabilities: {
      identify: false,
      group: false,
      alias: false,
      page: true,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },
    track(event) {
      calls.push({ type: "track", event });
    },
    page(event) {
      calls.push({ type: "page", event });
    },
  };
  return { provider, calls };
}

function logContext(label: string, context: Record<string, unknown> | undefined): void {
  console.log(`${label} ->\n${JSON.stringify(context, null, 2)}`);
}

export interface ContextCaptureResult {
  // A real page load, in a stubbed Chrome-on-macOS browser, having arrived
  // via a newsletter campaign link from a Google search results referrer:
  // shows every auto-captured `context` field populated.
  browserPageLoad: CanonicalEvent;
  // A subsequent `track()` call on the same instance: `context.session
  // .eventCount` has incremented from the page load above.
  browserCheckoutStarted: CanonicalEvent;
  // A third call, this time supplying an explicit `TrackOptions.context`
  // that overrides `locale`: demonstrates the caller-wins merge/precedence
  // rule -- `locale` is the caller's value, everything else auto-captured
  // (including `session`) is still present.
  browserSignupOverride: CanonicalEvent;
  // A separate instance configured with a `featureFlags` getter: shows the
  // getter's return value mirrored verbatim into `context.featureFlags`.
  featureFlagsPage: CanonicalEvent;
  // The same `context: true` config, but with no browser globals stubbed at
  // all (a plain server/Node/Bun process) -- the safe-no-op guarantee this
  // whole feature depends on: `locale`/`timezone`/`session` still populate,
  // `browser`/`os`/`device`/`viewport`/`referrer`/`campaign` are absent
  // entirely (not `undefined` keys).
  nodeFallbackTrack: CanonicalEvent;
}

// The example's real entry point: one coherent flow simulating a real page
// load, a couple of follow-up interactions in the same session, an
// app-owned feature-flags getter, and -- critically -- the same config run
// with no browser present at all. Exported (rather than only run inline) so
// `index.integration.test.ts` runs this exact function.
export async function runContextCaptureFlow(): Promise<ContextCaptureResult> {
  const { provider, calls } = createRecordingProvider();

  // --- A real page load: Chrome on macOS, arriving from a Google search,
  // via a newsletter campaign link, on a 1440x900 laptop viewport. ---
  stubBrowserGlobals({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    language: "en-US",
    innerWidth: 1440,
    innerHeight: 900,
    referrer: "https://www.google.com/search?q=typetrack+analytics",
    search: "?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale",
  });

  const analytics = createAnalytics({ context: true, provider });

  await analytics.page("Home");

  // A subsequent interaction in the same session: `context.session
  // .eventCount` increments (2nd event on this instance).
  await analytics.track("Checkout Started", { plan: "pro" });

  // Merge/precedence: this call's explicit `context.locale` wins over the
  // auto-captured one, while `timezone`/`session`/`browser`/etc. remain
  // (shallow merge, not deep -- only the `locale` key is overwritten).
  await analytics.track("Signup Completed", { plan: "pro" }, { context: { locale: "fr-FR" } });

  // --- The `featureFlags` getter: app-owned, re-invoked on every call,
  // mirrored verbatim onto `context.featureFlags`. A second instance, since
  // the first was never configured with a getter. ---
  const flaggedAnalytics = createAnalytics({
    context: {
      autoCapture: true,
      featureFlags: () => ({ betaCheckout: true, newPricing: "variant-b" }),
    },
    provider,
  });

  await flaggedAnalytics.page("Pricing");

  // --- The safe-no-op guarantee: same `context: true` config, but no
  // browser globals stubbed at all -- a plain server/Node/Bun process. ---
  clearBrowserGlobals();

  const serverAnalytics = createAnalytics({ context: true, provider });
  await serverAnalytics.track("Checkout Started", { plan: "pro" });

  for (const call of calls) {
    logContext(`${call.type}("${call.event.name}") context`, call.event.context);
  }

  return {
    browserPageLoad: calls[0]!.event,
    browserCheckoutStarted: calls[1]!.event,
    browserSignupOverride: calls[2]!.event,
    featureFlagsPage: calls[3]!.event,
    nodeFallbackTrack: calls[4]!.event,
  };
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  await runContextCaptureFlow();
}
