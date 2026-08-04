import { autoUTM, createAnalytics, type AnalyticsProvider } from "typetrack";

// A privacy-first "no consent banner needed" architecture recipe -- an EU
// site that avoids needing a cookie/consent banner at all by never
// processing personal data or persisting anything client-side. Composes
// `anonymousMode` (issue 004), `cookieless` (issue 006) + `autoUTM()`'s
// cookieless-aware behavior (issue 006/Phase 10 issue 005). Every log line
// below (`sink`) is produced by an actual `typetrack` run -- nothing here is
// a hand-authored transcript -- so `index.integration.test.ts` can assert
// against it directly and `expected-output.txt` is a literal capture of
// `bun run index.ts`'s stdout.
//
// IMPORTANT -- this recipe is an architectural illustration, not legal
// advice. Whether a given combination of settings actually removes a legal
// requirement for a consent banner depends on jurisdiction, what an app
// actually does with the data it collects, and factors entirely outside
// `typetrack`'s control (e.g. server-side logging, third-party scripts
// unrelated to this SDK). See `README.md`'s "Production notes" for the full
// disclaimer.
//
// No non-trivial pure logic is defined by this example's own code: every
// scenario below is a direct `typetrack`/`autoUTM()` API call, a stub
// provider construction, or minimal `globalThis` stubbing for a simulated
// page load -- so, per this issue's "a unit test is required only where
// non-trivial pure logic exists" rule, there is no `index.test.ts` in this
// directory. See `index.integration.test.ts`'s own header comment for the
// same note.

export interface CallLogEntry {
  verb: "track" | "identify";
  name?: string;
  properties?: Record<string, unknown>;
  eventUserId?: string;
  identifyUserId?: string;
  traits?: Record<string, unknown>;
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

// A hand-written stub provider standing in for a real analytics warehouse.
// Records every `track()`/`identify()` call it receives, both structurally
// (`callLog`, for assertions) and as a human-readable line (`sink`/console).
export function createPrivacyFirstProvider(callLog: CallLogEntry[], sink: string[]): AnalyticsProvider {
  const log = makeLog(sink);

  return {
    name: "privacy-first-warehouse",
    capabilities: {
      identify: true,
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
      callLog.push({ verb: "track", name: event.name, properties: event.properties, eventUserId: event.userId });
      log(
        `[provider] privacy-first-warehouse received track("${event.name}") ` +
          JSON.stringify({ properties: event.properties, userId: event.userId }),
      );
    },
    identify(userId, traits) {
      callLog.push({ verb: "identify", identifyUserId: userId, traits });
      log(`[provider] privacy-first-warehouse received identify("${userId}") ${JSON.stringify(traits)}`);
    },
  };
}

// `window`/`navigator`/`location`/`sessionStorage` don't exist in a plain
// Bun script, so this file simulates a "real page" by stubbing them
// directly on `globalThis` before calling into `typetrack` -- the exact
// `Object.defineProperty(globalThis, ...)` technique established by
// `src/context.test.ts` (Phase 9) and reused by every Phase 10 plugin's own
// integration test and `examples/plugins/landing-page-engagement/index.ts`'s
// `stubGlobal`.
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

// Stubs a simulated page load: `location.search` set to `search`, and a
// `sessionStorage` stub backed by the shared `sessionStorageData` object
// (so state genuinely persists *if* something writes to it) whose every
// `setItem` call is additionally recorded into `setItemCalls` -- the spy
// this recipe uses to prove `cookieless: true` never writes anything.
// Represents a *full page load* (a fresh JS context), not a client-side
// navigation -- each call site below that calls this function stands for a
// separate `createAnalytics()` construction, exactly as a real page reload
// would re-run an app's analytics setup from scratch.
function installStubPage(
  search: string,
  sessionStorageData: Record<string, string>,
  setItemCalls: { key: string; value: string }[],
): void {
  stubGlobal("window", {});
  stubGlobal("navigator", {});
  stubGlobal("location", { search });
  stubGlobal("sessionStorage", {
    getItem(key: string): string | null {
      return key in sessionStorageData ? sessionStorageData[key]! : null;
    },
    setItem(key: string, value: string): void {
      setItemCalls.push({ key, value });
      sessionStorageData[key] = value;
    },
  });
}

export interface AnonymousAndCookielessResult {
  // Every log line produced across all 5 steps, in the exact order
  // `bun run index.ts` prints them -- this is what `expected-output.txt`
  // captures verbatim.
  sink: string[];
  // What the provider(s) actually received, across both simulated page
  // loads, in call order.
  callLog: CallLogEntry[];
  // Every `sessionStorage.setItem` call recorded across both simulated page
  // loads (the spy `cookieless: true` is expected to keep empty).
  setItemCalls: { key: string; value: string }[];
}

// The example's real entry point: a visitor's full privacy-first session --
// two simulated full page loads -- walked step by step. Exported (rather
// than only run inline) so `index.integration.test.ts` runs this exact
// function.
export async function runAnonymousAndCookielessFlow(): Promise<AnonymousAndCookielessResult> {
  const sink: string[] = [];
  const log = makeLog(sink);
  const callLog: CallLogEntry[] = [];
  const setItemCalls: { key: string; value: string }[] = [];
  const sessionStorageData: Record<string, string> = {};

  console.log('=== Step 1-2: first page load, arriving via a campaign link ("?utm_source=...") ===');
  installStubPage("?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale", sessionStorageData, setItemCalls);
  const provider = createPrivacyFirstProvider(callLog, sink);
  const analytics = createAnalytics({
    anonymousMode: true,
    cookieless: true,
    plugins: [autoUTM()],
    provider,
  });
  clearStubGlobals();

  log(
    `[flow] provider calls so far: ${callLog.length} ` +
      '(expected 1 -- autoUTM()\'s "Campaign Landing" event still fires at construction)',
  );
  log(
    `[flow] sessionStorage.setItem call count: ${setItemCalls.length} ` +
      "(expected 0 -- cookieless: true skips autoUTM()'s first-touch persistence entirely)",
  );

  console.log("\n=== Step 3: application code calls identify() from a shared auth hook -- no-op under anonymousMode ===");
  await analytics.identify("user-42", { email: "jane.doe@example.com" });
  log(
    `[flow] identify() provider calls: ${callLog.filter((entry) => entry.verb === "identify").length} ` +
      "(expected 0 -- anonymousMode makes identify() a complete no-op)",
  );
  await analytics.track("Pricing Page Viewed", { plan: "pro" });
  const lastTrack = callLog[callLog.length - 1]!;
  log(
    `[flow] most recent track() call's userId: ${JSON.stringify(lastTrack.eventUserId)} ` +
      "(expected undefined -- identify() never set it)",
  );

  console.log('\n=== Step 4: a second page load, same session, no UTM params -- no further "Campaign Landing" ===');
  installStubPage("", sessionStorageData, setItemCalls);
  const provider2 = createPrivacyFirstProvider(callLog, sink);
  const analytics2 = createAnalytics({
    anonymousMode: true,
    cookieless: true,
    plugins: [autoUTM()],
    provider: provider2,
  });
  clearStubGlobals();

  const campaignLandingCount = callLog.filter((entry) => entry.name === "Campaign Landing").length;
  log(
    `[flow] total "Campaign Landing" events across both page loads: ${campaignLandingCount} ` +
      "(expected 1 -- cookieless mode has no persisted first-touch value to fall back on, per issue 006's documented trade-off)",
  );

  console.log("\n=== Step 5: analytics.destroy() -- teardown completes normally ===");
  await analytics.destroy();
  await analytics2.destroy();
  log("[flow] destroy() completed for both instances without throwing");

  return { sink, callLog, setItemCalls };
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  await runAnonymousAndCookielessFlow();
}
