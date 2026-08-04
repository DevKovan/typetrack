import { createAnalytics, piiFilterMiddleware, type AnalyticsProvider } from "typetrack";

// A realistic SaaS-app cookie-consent-banner flow, composing every facet
// Phase 11's "consent-gated-tracking" recipe (issue 008) requires: consent
// `categories` + `defaultState` + `respectBrowserSignals`, `analytics.consent
// .grant`/`.deny`, the global `requiredCategories` gate (issue 002),
// per-provider `ProviderEntry.requiresConsent` (issue 005), `enable()`/
// `disable()` (issue 003), and `piiFilterMiddleware` (issue 007) composed
// alongside. Every log line below (`sink`) is produced by an actual
// `typetrack` run -- nothing here is a hand-authored transcript -- so
// `index.integration.test.ts` can assert against it directly and
// `expected-output.txt` is a literal capture of `bun run index.ts`'s stdout.
//
// No non-trivial pure logic is defined by this example's own code (unlike
// e.g. `examples/middleware/pipeline-basics`'s `orderValueGuardMiddleware`):
// every scenario below is a direct `typetrack` API call, a stub-provider
// construction (structurally identical to other examples' stub providers),
// or minimal `globalThis` stubbing for the one Global Privacy Control
// scenario -- so, per this issue's "a unit test is required only where
// non-trivial pure logic exists" rule, there is no `index.test.ts` in this
// directory. See `index.integration.test.ts`'s own header comment for the
// same note.

export interface CallLogEntry {
  providerName: string;
  eventName: string;
  properties: Record<string, unknown>;
}

// Mirrors `examples/middleware/pipeline-basics/index.ts`'s `makeLog`: pushes
// a human-readable line into `sink` (for assertions) and mirrors it to
// `console.log` (so `bun run index.ts`'s stdout matches `sink` exactly).
function makeLog(sink: string[]): (message: string) => void {
  return (message) => {
    sink.push(message);
    console.log(message);
  };
}

// A hand-written stub provider standing in for either a first-party
// product-analytics tool or a third-party marketing pixel -- both this
// example's providers share this same shape, differing only in `name` and
// the `requiresConsent` category each is wrapped with in `ProviderEntry`
// (see `runConsentGatedTrackingFlow` below). Records every `track()` call it
// receives, both structurally (`callLog`, for assertions) and as a
// human-readable line (`sink`/console).
export function createConsentAwareProvider(name: string, callLog: CallLogEntry[], sink: string[]): AnalyticsProvider {
  const log = makeLog(sink);

  return {
    name,
    capabilities: {
      identify: false,
      group: false,
      alias: false,
      page: false,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },
    track(event) {
      callLog.push({ providerName: name, eventName: event.name, properties: event.properties });
      log(`[provider] ${name} received "${event.name}" ${JSON.stringify(event.properties)}`);
    },
  };
}

// `window`/`navigator` don't exist in a plain Bun script, so scenario 5's
// Global Privacy Control detection (`detectBrowserPrivacySignal()`, backing
// `consent.respectBrowserSignals` -- see `src/consent.ts`) needs them
// stubbed directly on `globalThis`, matching the exact
// `Object.defineProperty(globalThis, ...)` technique established by
// `src/context.test.ts` (Phase 9) and reused by every later browser-reading
// module's own tests/examples (e.g.
// `examples/plugins/landing-page-engagement/index.ts`'s `stubGlobal`).
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function stubGlobal(key: string, value: unknown): void {
  if (!originalDescriptors.has(key)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

function clearStubGlobals(): void {
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }
  originalDescriptors.clear();
}

export interface ConsentGatedTrackingResult {
  // Every log line produced across all 6 scenarios, in the exact order
  // `bun run index.ts` prints them -- this is what `expected-output.txt`
  // captures verbatim.
  sink: string[];
  // What the first-party product-analytics provider actually received, in
  // call order.
  analyticsCallLog: CallLogEntry[];
  // What the third-party marketing-pixel provider actually received, in
  // call order.
  marketingCallLog: CallLogEntry[];
  // What the second, separately-constructed GPC-fail-closed instance's
  // provider actually received (scenario 5 only -- expected to stay empty).
  gpcCallLog: CallLogEntry[];
}

// The example's real entry point: a visitor's full cookie-consent-banner
// session, walked scenario by scenario. Exported (rather than only run
// inline) so `index.integration.test.ts` runs this exact function.
export async function runConsentGatedTrackingFlow(): Promise<ConsentGatedTrackingResult> {
  const sink: string[] = [];
  const log = makeLog(sink);
  const analyticsCallLog: CallLogEntry[] = [];
  const marketingCallLog: CallLogEntry[] = [];
  const gpcCallLog: CallLogEntry[] = [];

  console.log("=== Step 1: construct with two consent-gated providers + piiFilterMiddleware ===");
  const analyticsStub = createConsentAwareProvider("product-analytics", analyticsCallLog, sink);
  const marketingStub = createConsentAwareProvider("marketing-pixel", marketingCallLog, sink);

  const analytics = createAnalytics({
    provider: [
      { provider: analyticsStub, requiresConsent: ["analytics"] },
      { provider: marketingStub, requiresConsent: ["marketing"] },
    ],
    consent: {
      categories: ["analytics", "marketing"],
      defaultState: "denied",
      requiredCategories: ["analytics"],
    },
  });
  analytics.use(piiFilterMiddleware());
  log("[flow] instance constructed: requiredCategories=[\"analytics\"], defaultState=\"denied\", piiFilterMiddleware registered");

  console.log('\n=== Step 2: a visitor arrives before answering the consent banner ("Product Viewed") ===');
  await analytics.track("Product Viewed", { sku: "TT-PLAN-PRO", email: "jane.doe@example.com" });
  log(
    `[flow] provider calls so far: product-analytics=${analyticsCallLog.length}, marketing-pixel=${marketingCallLog.length} ` +
      '(expected 0, 0 -- fully blocked by the global requiredCategories: ["analytics"] gate)',
  );

  console.log('\n=== Step 3: the visitor accepts only the "Analytics" toggle -- consent.grant("analytics") ===');
  analytics.consent.grant("analytics");
  await analytics.track("Product Viewed", { sku: "TT-PLAN-PRO", email: "jane.doe@example.com" });
  log(
    `[flow] provider calls so far: product-analytics=${analyticsCallLog.length}, marketing-pixel=${marketingCallLog.length} ` +
      "(expected 1, 0 -- reaches only the analytics-consent provider; marketing-pixel still requires its own " +
      '"marketing" consent, per-provider gating)',
  );

  console.log('\n=== Step 4: the visitor later also accepts "Marketing" -- consent.grant("marketing") ===');
  analytics.consent.grant("marketing");
  await analytics.track("Newsletter Subscribed", { email: "jane.doe@example.com" });
  log(
    `[flow] provider calls so far: product-analytics=${analyticsCallLog.length}, marketing-pixel=${marketingCallLog.length} ` +
      "(expected 2, 1 -- now reaches both providers, each still redacted by the shared piiFilterMiddleware)",
  );

  console.log('\n=== Step 5: a SECOND, separately-constructed instance detects a Global Privacy Control signal at construction ===');
  stubGlobal("window", {});
  stubGlobal("navigator", { globalPrivacyControl: true });
  const gpcProvider = createConsentAwareProvider("gpc-instance-analytics", gpcCallLog, sink);
  const gpcAnalytics = createAnalytics({
    provider: [{ provider: gpcProvider, requiresConsent: ["analytics"] }],
    consent: {
      categories: ["analytics", "marketing"],
      requiredCategories: ["analytics"],
      respectBrowserSignals: true,
    },
  });
  clearStubGlobals();
  log(
    `[flow] gpcAnalytics.consent.hasConsent("analytics") === ${gpcAnalytics.consent.hasConsent("analytics")} ` +
      "(fail-closed default applied immediately at construction -- no grant()/deny() call has been made yet)",
  );
  await gpcAnalytics.track("Product Viewed", { sku: "TT-PLAN-PRO" });
  log(`[flow] gpc-instance-analytics provider calls: ${gpcCallLog.length} (expected 0 -- blocked by the GPC-driven denied default)`);

  console.log("\n=== Step 6: analytics.disable() on the first instance -- consent/enabled independence ===");
  analytics.disable();
  await analytics.track("Newsletter Subscribed", { email: "jane.doe@example.com" });
  log(
    `[flow] provider calls after disable(): product-analytics=${analyticsCallLog.length}, marketing-pixel=${marketingCallLog.length} ` +
      '(expected still 2, 1 -- "analytics"/"marketing" consent remain granted, but disable() blocks independently)',
  );
  analytics.enable();
  await analytics.track("Newsletter Subscribed", { email: "jane.doe@example.com" });
  log(
    `[flow] provider calls after enable(): product-analytics=${analyticsCallLog.length}, marketing-pixel=${marketingCallLog.length} ` +
      "(expected 3, 2 -- normal behavior restored)",
  );

  return { sink, analyticsCallLog, marketingCallLog, gpcCallLog };
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  await runConsentGatedTrackingFlow();
}
