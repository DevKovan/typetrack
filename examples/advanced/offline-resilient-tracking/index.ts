import { createAnalytics, type AnalyticsProvider, type CanonicalEvent } from "typetrack";

// A realistic e-commerce storefront's full Phase 12 reliability story, end
// to end: `reliability` (`storage`/`maxAttempts`/`backoff`/`batch`) against a
// hand-written flaky+batch-capable vendor stub ("warehouse-analytics"),
// `TrackOptions.priority` (a checkout event jumping the queue ahead of
// earlier-queued page-view events), `ProviderCapabilities.batch` +
// `trackBatch` coalescing, `maxAttempts` dead-lettering (one permanently
// invalid event genuinely dropped), offline detection + the `online`
// auto-drain, and a `pagehide` unload flush -- composed the way a real
// storefront would hit all of them in a single browsing session, not
// exercised one at a time. Every log line below (`sink`) is produced by an
// actual `typetrack` run -- nothing here is a hand-authored transcript --
// so `index.integration.test.ts` can assert against it directly and
// `expected-output.txt` is a literal capture of `bun run index.ts`'s stdout.
//
// No non-trivial pure logic is defined by this example's own code: the one
// piece of scripted behavior here -- `createWarehouseAnalyticsStub`'s
// fail-during-outage / permanently-reject-one-poison-sku logic -- is the
// same shape of hand-written stub-provider scripting every other example in
// this repo already does (e.g. `examples/recipes/*`'s `createFlakyProvider`-
// style stubs, or `src/index.test.ts`'s own `createFlakyProvider`/
// `createBatchCapableProvider`), not independently reusable pure logic
// worth isolating into its own unit-tested module -- so, per this issue's
// "a unit test is required only where non-trivial pure logic exists" rule,
// there is no `index.test.ts` in this directory. See
// `index.integration.test.ts`'s own header comment for the same note.

// The browser's real `online` event handler kicks off a fire-and-forget
// `void drainQueueOnce()` (issue 003) -- an async function whose internal
// `await`s (the provider call, then `queueEngine.recordSuccess`) need a
// few microtask turns to actually settle before `analytics.queue.size()`
// reflects the result. Mirrors `src/index.test.ts`'s own `flushAsync()`
// helper exactly (used there for the identical reason, alongside real
// `jest.advanceTimersByTime()` ticks this example doesn't need, since every
// drain here is triggered explicitly via `flush()`/`queue.drain()`/this
// listener rather than the 5s background interval).
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function makeLog(sink: string[]): (message: string) => void {
  return (message) => {
    sink.push(message);
    console.log(message);
  };
}

export interface ProviderCallLogEntry {
  kind: "track" | "trackBatch";
  eventNames: string[];
}

// A hand-written stand-in for a real `packages/provider-*` adapter talking
// to a vendor's ingestion API (never live vendor infrastructure). Two
// independent failure modes, both realistic:
//
// 1. `outageActive` -- a transient vendor-side incident: every call fails
//    while `true`, and succeeds once flipped back to `false` (toggled via
//    `setOutage()`, simulating the vendor's status page going green again).
// 2. A single "poison" SKU (`TT-RETIRED-001`) -- a discontinued product
//    whose event payload the vendor's ingestion API permanently rejects
//    (e.g. a foreign-key/validation failure on a delisted catalog entry)
//    *regardless* of the general outage above -- this is what the flow uses
//    to demonstrate `maxAttempts` exhaustion/dead-lettering, distinct from
//    (and independent of) the transient outage every other event recovers
//    from.
//
// `capabilities.batch: true` + a real `trackBatch` implementation opts this
// stub into `drainQueueOnce()`'s batch-coalescing path (issue 005). A
// `trackBatch` chunk fails as a whole if the vendor is down OR any event in
// that chunk is the poison SKU -- matching `AnalyticsProvider.trackBatch`'s
// documented all-or-nothing contract (no per-event status).
export const POISON_SKU = "TT-RETIRED-001";

export function createWarehouseAnalyticsStub(callLog: ProviderCallLogEntry[]): AnalyticsProvider & {
  setOutage(down: boolean): void;
} {
  let outageActive = true;

  function isPoisoned(events: CanonicalEvent[]): boolean {
    return events.some((event) => (event.properties as { sku?: string }).sku === POISON_SKU);
  }

  return {
    name: "warehouse-analytics",
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
      batch: true,
    },
    setOutage(down) {
      outageActive = down;
    },
    track(event) {
      callLog.push({ kind: "track", eventNames: [event.name] });
      if (outageActive || isPoisoned([event])) {
        return Promise.reject(
          new Error(
            outageActive
              ? "warehouse-analytics: ingestion endpoint unavailable (503)"
              : `warehouse-analytics: permanently rejected sku "${POISON_SKU}" (delisted product, 422)`,
          ),
        );
      }
      return Promise.resolve();
    },
    trackBatch(events) {
      callLog.push({ kind: "trackBatch", eventNames: events.map((event) => event.name) });
      if (outageActive || isPoisoned(events)) {
        return Promise.reject(
          new Error(
            outageActive
              ? "warehouse-analytics: ingestion endpoint unavailable (503)"
              : `warehouse-analytics: batch rejected -- contains permanently-invalid sku "${POISON_SKU}"`,
          ),
        );
      }
      return Promise.resolve();
    },
  };
}

// Mirrors `src/index.test.ts`'s `stubBrowserOnline`/`stubBrowserForUnload`
// stubbing technique exactly: a fake `window` (real add/remove-aware
// listener registry, so `destroy()` genuinely stops further `pagehide`/
// `online` delivery) and a fake `navigator` whose `onLine` can be flipped at
// any point in the flow via `setOnline()`.
function stubBrowserEnvironment(initialOnline: boolean): {
  setOnline(online: boolean): void;
  triggerOnline(): void;
  triggerPagehide(): void;
  restore(): void;
} {
  const listeners = new Map<string, Set<() => void>>();

  function addEventListener(type: string, listener: () => void): void {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(listener);
  }
  function removeEventListener(type: string, listener: () => void): void {
    listeners.get(type)?.delete(listener);
  }

  Object.defineProperty(globalThis, "window", {
    value: { addEventListener, removeEventListener },
    configurable: true,
    writable: true,
  });

  function setOnline(online: boolean): void {
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: online },
      configurable: true,
      writable: true,
    });
  }
  setOnline(initialOnline);

  function triggerOnline(): void {
    for (const listener of listeners.get("online") ?? []) listener();
  }
  function triggerPagehide(): void {
    for (const listener of listeners.get("pagehide") ?? []) listener();
  }
  function restore(): void {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).navigator;
  }

  return { setOnline, triggerOnline, triggerPagehide, restore };
}

export interface OfflineResilientTrackingResult {
  // Every log line produced across the whole flow, in the exact order
  // `bun run index.ts` prints them -- what `expected-output.txt` captures.
  sink: string[];
  // Every call the stub provider actually received, in call order.
  callLog: ProviderCallLogEntry[];
  // Every dead-lettered event name (populated by the `onError` middleware
  // registered below) -- expected to contain exactly `POISON_SKU`'s
  // "Product Viewed" event, once, after `maxAttempts` is exhausted.
  deadLetteredEvents: string[];
  // `analytics.queue.size()`, snapshotted at each named checkpoint of the
  // flow, in step order.
  queueSizeCheckpoints: { label: string; size: number }[];
}

// The example's real entry point: a full visitor session, walked scenario
// by scenario. Exported (rather than only run inline) so
// `index.integration.test.ts` runs this exact function.
export async function runOfflineResilientTrackingFlow(): Promise<OfflineResilientTrackingResult> {
  const sink: string[] = [];
  const log = makeLog(sink);
  const callLog: ProviderCallLogEntry[] = [];
  const deadLetteredEvents: string[] = [];
  const queueSizeCheckpoints: { label: string; size: number }[] = [];

  // The visitor's own connection starts healthy -- the failures in steps
  // 1-4 below are a *vendor-side* incident, not an offline visitor. Browser
  // globals must exist *before* `createAnalytics()` so its construction-time
  // `online`/`pagehide` listener registration (issue 003/006) actually runs.
  const browser = stubBrowserEnvironment(true);

  function checkpoint(label: string, size: number): void {
    queueSizeCheckpoints.push({ label, size });
    log(`[flow] queue.size() ${label} = ${size}`);
  }

  console.log('=== Step 1: construct with a flaky, batch-capable "warehouse-analytics" provider ===');
  const provider = createWarehouseAnalyticsStub(callLog);
  const analytics = createAnalytics({
    provider,
    reliability: {
      storage: "memory",
      maxAttempts: 3,
      backoff: { baseMs: 100, factor: 2, maxMs: 1000 },
      batch: { size: 5, intervalMs: 200 },
    },
  });
  analytics.use({
    name: "dead-letter-logger",
    onError(error, event, ctx) {
      if (ctx.source === "provider") {
        deadLetteredEvents.push(event.name);
        log(`[flow] dead-lettered: "${event.name}" (sku=${(event.properties as { sku?: string }).sku}) -- ${error}`);
      }
    },
  });
  log("[flow] instance constructed: maxAttempts=3, backoff={baseMs:100,factor:2,maxMs:1000}, batch={size:5,intervalMs:200}");
  log("[flow] warehouse-analytics is mid-incident (outageActive=true) -- every call fails until it recovers");

  console.log("\n=== Step 2: the visitor browses while the vendor's ingestion endpoint is down ===");
  const productViews: { sku: string; price: number }[] = [
    { sku: "TT-SHIRT-BLU-M", price: 24.99 },
    { sku: "TT-SHIRT-BLU-L", price: 24.99 },
    { sku: "TT-MUG-STEEL", price: 14.5 },
    { sku: "TT-HAT-CAP", price: 19.99 },
  ];
  for (const { sku, price } of productViews) {
    await analytics.track("Product Viewed", { sku, price }, { priority: 0 });
  }
  checkpoint("after 4 low-priority Product Viewed events (all failing)", analytics.queue.size());

  console.log('\n=== Step 3: the visitor reaches checkout -- a high-priority "Checkout Started" event, also failing ===');
  await analytics.track("Checkout Started", { cartTotal: 84.47, itemCount: 4 }, { priority: 10 });
  checkpoint("after Checkout Started (priority 10), also queued", analytics.queue.size());

  console.log("\n=== one more low-priority view arrives: a discontinued product the vendor will NEVER accept ===");
  await analytics.track("Product Viewed", { sku: POISON_SKU, price: 9.99 }, { priority: 0 });
  checkpoint("after the permanently-invalid Product Viewed (6 total queued)", analytics.queue.size());

  console.log("\n=== Step 4: the vendor incident resolves -- trigger analytics.flush() ===");
  provider.setOutage(false);
  log("[flow] warehouse-analytics recovers (outageActive=false) -- except the permanently-invalid sku above");
  await analytics.flush();
  log(
    `[flow] trackBatch call #1: ${JSON.stringify(callLog.filter((c) => c.kind === "trackBatch")[0]?.eventNames)} ` +
      "-- Checkout Started drains first (priority ordering), bundled with the 4 Product Viewed events in ONE " +
      "trackBatch call rather than 5 individual track() calls (batching) -- succeeds, none of these reappear.",
  );
  log(
    `[flow] trackBatch call #2: ${JSON.stringify(callLog.filter((c) => c.kind === "trackBatch")[1]?.eventNames)} ` +
      "-- the permanently-invalid event alone (a separate chunk, since batch.size: 5 caps each trackBatch call) -- fails.",
  );
  checkpoint("after flush(): only the permanently-invalid entry remains", analytics.queue.size());

  console.log("\n=== retrying the permanently-invalid event towards maxAttempts (3) ===");
  log("[flow] analytics.queue.drain() immediately after a failure respects the entry's own backoff window (not yet elapsed) -- no new attempt");
  await analytics.queue.drain();
  checkpoint("after a backoff-respecting drain() (gated, no new attempt)", analytics.queue.size());

  log("[flow] analytics.flush() bypasses that backoff gate -- attempt 2 of 3, still fails (still the same permanently-invalid sku)");
  await analytics.flush();
  checkpoint("after flush() attempt 2/3 (still queued)", analytics.queue.size());

  log("[flow] analytics.flush() -- attempt 3 of 3 -- maxAttempts exhausted -> dead-lettered and dropped");
  await analytics.flush();
  checkpoint("after flush() attempt 3/3 (dead-lettered, queue empty)", analytics.queue.size());

  console.log("\n=== Step 5: the visitor's own connection drops mid-session ===");
  browser.setOnline(false);
  const trackCallsBeforeOffline = callLog.filter((c) => c.kind === "track").length;
  await analytics.track("Product Viewed", { sku: "TT-SOCKS-WOOL", price: 12.0 }, { priority: 0 });
  const trackCallsAfterOffline = callLog.filter((c) => c.kind === "track").length;
  log(
    `[flow] offline track(): provider call count unchanged (${trackCallsBeforeOffline} -> ${trackCallsAfterOffline}) -- ` +
      "queued directly, no failed-call attempt logged",
  );
  checkpoint("while offline, one event queued", analytics.queue.size());

  console.log("\n=== the visitor's connection comes back -- the browser fires \"online\" ===");
  browser.setOnline(true);
  browser.triggerOnline();
  await flushMicrotasks();
  log("[flow] the queue drained automatically -- no explicit flush() call was made for this event");
  checkpoint("after the automatic online-triggered drain", analytics.queue.size());

  console.log("\n=== Step 6: one final event fires just as the connection drops again, then the page unloads ===");
  browser.setOnline(false);
  await analytics.track("Product Viewed", { sku: "TT-BEANIE-GRY", price: 17.5 }, { priority: 0 });
  checkpoint("one final unsent event queued, right before pagehide", analytics.queue.size());

  const trackCallsBeforePagehide = callLog.filter((c) => c.kind === "track").length;
  browser.triggerPagehide();
  const trackCallsAfterPagehide = callLog.filter((c) => c.kind === "track").length;
  log(
    `[flow] pagehide fired a best-effort, fire-and-forget provider.track() call for the queued entry ` +
      `(${trackCallsBeforePagehide} -> ${trackCallsAfterPagehide} track() calls) -- no recordSuccess/recordFailure ` +
      "bookkeeping happens from this path (at-least-once, not exactly-once, delivery)",
  );
  checkpoint("after pagehide (queue left untouched -- at-least-once, not exactly-once)", analytics.queue.size());

  await analytics.destroy();
  browser.restore();
  log("[flow] destroy() stops the background drain timer and removes the online/pagehide listeners");

  return { sink, callLog, deadLetteredEvents, queueSizeCheckpoints };
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  await runOfflineResilientTrackingFlow();
}
