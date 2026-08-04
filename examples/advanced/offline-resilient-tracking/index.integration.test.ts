import { describe, expect, test } from "bun:test";
import { runOfflineResilientTrackingFlow } from "./index";

// Runs the example's actual entry-point logic
// (`runOfflineResilientTrackingFlow`, the exact function `bun run index.ts`
// calls) end-to-end against the real `typetrack` package and a hand-written
// flaky/batch-capable stub `AnalyticsProvider` (never a real
// `packages/provider-*` adapter), so every assertion below can never
// silently drift out of sync with what `README.md`/`expected-output.txt`
// document -- mirrors `examples/recipes/consent-gated-tracking/index
// .integration.test.ts`'s convention of asserting against the flow's own
// recorded call log rather than re-implementing the scenario.
//
// No unit test file exists in this directory: `index.ts`'s own header
// comment explains why (no non-trivial pure logic of the example's own is
// defined here -- the stub provider's fail-during-outage/permanently-reject-
// one-sku scripting is the same shape of hand-written test double every
// other example/`src/index.test.ts` already uses, not independently
// reusable pure logic worth isolating).

describe("offline-resilient-tracking example", () => {
  test("resolves without throwing, and every checkpoint's queue.size() matches hand-computed expectations", async () => {
    const { queueSizeCheckpoints } = await runOfflineResilientTrackingFlow();

    expect(queueSizeCheckpoints.map((c) => c.size)).toEqual([
      4, // 4 low-priority Product Viewed events, all failing (vendor outage)
      5, // + Checkout Started (priority 10), also failing
      6, // + the permanently-invalid Product Viewed
      1, // flush(): 5 delivered (1 batch call), only the poison entry remains
      1, // backoff-respecting drain() right after a failure: gated, unchanged
      1, // flush() bypasses backoff -- attempt 2/3, still fails, still queued
      0, // flush() -- attempt 3/3 -- maxAttempts exhausted, dead-lettered
      1, // offline: one more Product Viewed queued directly
      0, // "online" fires -- automatic drain, no explicit flush() needed
      1, // one final event queued right as the connection drops again
      1, // pagehide: fire-and-forget attempt made, but queue is left as-is
    ]);
  });

  test("step 2-3: 4 low-priority Product Viewed events + 1 high-priority Checkout Started all fail individually while the vendor is down (5 track() calls, no trackBatch yet)", async () => {
    const { callLog } = await runOfflineResilientTrackingFlow();

    const firstFive = callLog.slice(0, 6);
    expect(firstFive.every((entry) => entry.kind === "track")).toBe(true);
    expect(firstFive.map((entry) => entry.eventNames[0])).toEqual([
      "Product Viewed",
      "Product Viewed",
      "Product Viewed",
      "Product Viewed",
      "Checkout Started",
      "Product Viewed", // the permanently-invalid one
    ]);
  });

  test("step 4: recovery + flush() delivers Checkout Started before the earlier-queued Product Viewed events, bundled into ONE trackBatch call (priority ordering + batching together)", async () => {
    const { callLog } = await runOfflineResilientTrackingFlow();

    const batchCalls = callLog.filter((entry) => entry.kind === "trackBatch");
    expect(batchCalls).toHaveLength(2);

    // First chunk: the 5 events that actually succeed once the vendor
    // recovers -- Checkout Started (priority 10) is listed FIRST, ahead of
    // every Product Viewed event queued before it (priority ordering),
    // and all 5 travel in one trackBatch call rather than 5 individual
    // track() calls (batching).
    expect(batchCalls[0]!.eventNames).toEqual([
      "Checkout Started",
      "Product Viewed",
      "Product Viewed",
      "Product Viewed",
      "Product Viewed",
    ]);

    // Second chunk: the permanently-invalid event alone, in its own
    // trackBatch call (batch.size: 5 caps each call at 5 entries) -- this
    // one fails.
    expect(batchCalls[1]!.eventNames).toEqual(["Product Viewed"]);
  });

  test("maxAttempts (3) exhaustion: the permanently-invalid event is retried exactly twice more (individual track() calls) after its first batched failure, then dead-lettered exactly once", async () => {
    const { callLog, deadLetteredEvents } = await runOfflineResilientTrackingFlow();

    // After the first (batched) failure, the entry is alone in the queue --
    // `drainQueueOnce()`'s batch-capable-but-lone-entry rule means every
    // subsequent retry is an individual track() call, never trackBatch.
    const trackCalls = callLog.filter((entry) => entry.kind === "track");
    // 4 product views + checkout + poison(initial) + poison(retry 2) +
    // poison(retry 3) + offline product-view (drained on "online") +
    // final product-view (drained on pagehide) = 10.
    expect(trackCalls).toHaveLength(10);

    expect(deadLetteredEvents).toEqual(["Product Viewed"]);
  });

  test("step 5: an offline track() call never reaches the provider at all (no track()/trackBatch call recorded for it), then the browser's online event auto-drains it without an explicit flush()", async () => {
    const { callLog } = await runOfflineResilientTrackingFlow();

    // Every recorded track() call name in order -- the offline-queued
    // "TT-SOCKS-WOOL" Product Viewed only ever appears once (when it's
    // actually drained by the "online" listener), never twice (proving the
    // original offline track() call itself never touched the provider).
    const trackCallCount = callLog.filter((entry) => entry.kind === "track").length;
    expect(trackCallCount).toBe(10);
  });

  test("step 6: pagehide makes a fire-and-forget delivery attempt for the final queued entry, but the queue is left untouched (at-least-once, not exactly-once)", async () => {
    const { queueSizeCheckpoints } = await runOfflineResilientTrackingFlow();

    const beforePagehide = queueSizeCheckpoints.find((c) => c.label.includes("right before pagehide"));
    const afterPagehide = queueSizeCheckpoints.find((c) => c.label.includes("after pagehide"));
    expect(beforePagehide?.size).toBe(1);
    // No recordSuccess/recordFailure bookkeeping happens from the pagehide
    // path -- the queue's size is identical before and after, even though a
    // real delivery attempt was made (see the other test above for proof
    // the attempt itself happened).
    expect(afterPagehide?.size).toBe(1);
  });

  test("runOfflineResilientTrackingFlow resolves without throwing", async () => {
    await expect(runOfflineResilientTrackingFlow()).resolves.toBeDefined();
  });
});
