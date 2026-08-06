import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Targets src/index.ts's `pagehide` + `navigator.sendBeacon` unload flush
// (`ReliabilityOptions.flushOnUnload`, ~lines 991-1152) -- the one assertion
// nothing else in this repo's test suite (happy-dom-based unit tests
// included) can make honestly, per plan/phase-16-testing-infrastructure/
// BRIEF.md's research-grounding section: `beforeunload` blocks bfcache
// eligibility and `unload` is unreliable, so core deliberately uses
// `pagehide` + `sendBeacon`, real-browser-navigation-timing behavior
// happy-dom's stand-ins cannot faithfully simulate.
//
// `sendBeacon` only fires here for typetrack's own dev-server mirror
// (`devServer` option) -- see `ReliabilityOptions.flushOnUnload`'s doc
// comment and `flushQueueOnUnload()`'s in `src/index.ts`. A queued entry
// requires `reliability` enabled *and* a provider whose `track()` actually
// fails (or the browser being offline) -- this spec uses a provider whose
// `track()` always rejects, which `callSingleProvider()` catches and
// enqueues into the offline queue (`src/reliability/queue.ts`) for retry,
// exactly the entry `flushQueueOnUnload()` later drains on `pagehide`.

test("flushes the offline queue via a real navigator.sendBeacon call on pagehide", async ({ page, request }) => {
  const requestId = randomUUID();

  await page.goto("/flush-on-unload.html");

  const queueSizeBeforeUnload = await page.evaluate(async (currentRequestId) => {
    const { createAnalytics } = (
      window as unknown as {
        Typetrack: {
          createAnalytics: (options: unknown) => {
            track: (name: string, payload: unknown) => Promise<unknown>;
            queue: { size: () => number };
          };
        };
      }
    ).Typetrack;

    // Spy on the real `navigator.sendBeacon` -- the spy itself calls
    // through to the real, original `sendBeacon` to report what it
    // observed, so the observation itself survives page teardown exactly
    // as reliably as the call it's observing (a `fetch()`-based reporter
    // here would not have that guarantee).
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit) => {
      const rawData = typeof data === "string" ? data : "";
      originalSendBeacon(
        "/log?kind=sendbeacon-spy",
        JSON.stringify({ requestId: currentRequestId, targetUrl: String(url), rawData }),
      );
      return originalSendBeacon(url, data);
    };

    const analytics = createAnalytics({
      // src/index.ts's `ReliabilityOptions.flushOnUnload` -- already
      // defaults to `true` whenever `reliability` is enabled at all; set
      // explicitly here for clarity, per this issue's own scope.
      reliability: { flushOnUnload: true },
      // `sendBeacon` on unload only fires typetrack's own dev-server
      // mirror -- see `flushQueueOnUnload()`'s doc comment in
      // `src/index.ts`. Relative URL, resolved against this page's own
      // origin, same-origin so no CORS concern either way.
      devServer: { url: "/log?kind=beacon" },
      provider: {
        name: "always-fails-provider",
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
        track() {
          return Promise.reject(new Error("simulated provider failure -- forces offline-queue enqueue"));
        },
      },
    });

    // Awaiting this resolves only once the failed provider call has
    // actually been caught and the event enqueued (`callSingleProvider()`'s
    // `handleFailure` -> `enqueueEvent()` chain in src/index.ts) -- not a
    // race against enqueue happening.
    await analytics.track("checkout_abandoned", { requestId: currentRequestId, cartValue: 99 });

    return analytics.queue.size();
  }, requestId);

  // The provider's `track()` always rejects, so the event above must have
  // landed in the offline queue rather than being delivered synchronously.
  expect(queueSizeBeforeUnload).toBe(1);

  // A real cross-document navigation -- verified empirically in this
  // package's own development (re-run 5+ times with no flakiness) to
  // reliably fire a real `pagehide` event in Playwright's Chromium.
  await page.goto("about:blank");

  await expect
    .poll(async () => {
      const res = await request.get(`/log?kind=sendbeacon-spy&requestId=${requestId}`);
      const entries = (await res.json()) as unknown[];
      return entries.length;
    })
    .toBeGreaterThan(0);

  const res = await request.get(`/log?kind=sendbeacon-spy&requestId=${requestId}`);
  const entries = (await res.json()) as Array<{
    kind: string;
    body: { requestId: string; targetUrl: string; rawData: string };
  }>;

  expect(entries).toHaveLength(1);
  const beacon = entries[0]!;
  expect(beacon.kind).toBe("sendbeacon-spy");

  // `flushQueueOnUnload()` passes the resolved `devServer.url` straight
  // through to `sendBeacon(url, data)` -- confirm it's exactly the
  // configured mirror target.
  const targetUrl = new URL(beacon.body.targetUrl, "http://localhost");
  expect(targetUrl.pathname).toBe("/log");
  expect(targetUrl.searchParams.get("kind")).toBe("beacon");

  // The exact `{ event, payload }` body shape `flushQueueOnUnload()`
  // documents (src/index.ts ~line 1050) -- `event` is the event *name*,
  // `payload` is `entry.event.properties`.
  const beaconPayload = JSON.parse(beacon.body.rawData) as {
    event: string;
    payload: { requestId: string; cartValue: number };
  };
  expect(beaconPayload.event).toBe("checkout_abandoned");
  expect(beaconPayload.payload.requestId).toBe(requestId);
  expect(beaconPayload.payload.cartValue).toBe(99);
});
