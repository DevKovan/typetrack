import { describe, expect, test } from "bun:test";
import { runBunRuntimeTrackingFlow } from "./index";

// Runs the example's actual entry-point logic (`runBunRuntimeTrackingFlow`,
// the exact function `bun run index.ts` calls) end-to-end: a real
// `createSegmentFetchProvider` (`@typetrack/provider-segment`, this phase's
// new zero-vendor-dependency, `fetch()`-based adapter) issuing genuine HTTP
// requests over a real local socket to a `Bun.serve()`-backed stand-in for
// Segment's HTTP Tracking API (never real Segment infrastructure, never a
// mocked `globalThis.fetch`) -- an actual client/server HTTP round trip, so
// this test can never silently drift out of sync with what this
// directory's README/`expected-output.txt` document. Mirrors
// `examples/core/provider-switch/app.integration.test.ts`'s
// `startGA4Stub()`-based convention exactly (same shape, different vendor).
//
// See `index.test.ts` for this example's one piece of pure, non-trivial,
// no-I/O logic (`buildProductViewedProperties`/`buildCheckoutStartedProperties`)
// tested in isolation there instead.

describe("runtimes/bun example", () => {
  test("resolves without throwing, and every request reaches the local Segment-HTTP-API stub", async () => {
    const { requests } = await runBunRuntimeTrackingFlow();

    // identify -> track("Product Viewed") -> track("Checkout Started"):
    // three real HTTP requests, one per verb, none lost/retried/duplicated.
    expect(requests).toHaveLength(3);
  });

  test("every request carries a real HTTP Basic Auth Authorization header derived from the write key", async () => {
    const { requests } = await runBunRuntimeTrackingFlow();

    // `btoa("bun-runtime-example-write-key:")`, per
    // `@typetrack/provider-segment`'s `encodeBasicAuth` (`fetch.ts`) --
    // computed independently here (not imported from that module) so this
    // assertion can't accidentally pass by construction.
    const expectedAuth = `Basic ${btoa("bun-runtime-example-write-key:")}`;
    for (const request of requests) {
      expect(request.authorization).toBe(expectedAuth);
    }
  });

  test("identify() reaches /v1/identify with the correct userId and traits", async () => {
    const { requests } = await runBunRuntimeTrackingFlow();

    const identifyRequest = requests.find((r) => r.pathname === "/v1/identify");
    expect(identifyRequest).toBeDefined();
    expect(identifyRequest!.method).toBe("POST");
    expect(identifyRequest!.body).toMatchObject({
      userId: "user_bun_512",
      traits: { plan: "team" },
    });
  });

  test('track("Product Viewed") reaches /v1/track with the exact sku/price properties, event name unchanged', async () => {
    const { requests } = await runBunRuntimeTrackingFlow();

    const trackRequests = requests.filter((r) => r.pathname === "/v1/track");
    expect(trackRequests).toHaveLength(2);

    const productViewed = trackRequests.find((r) => r.body.event === "Product Viewed");
    expect(productViewed).toBeDefined();
    expect(productViewed!.body).toMatchObject({
      event: "Product Viewed",
      properties: { sku: "TT-HOODIE-CHARCOAL-L", price: 54.0 },
      // `identify()` is the only verb that updates core's current `userId`
      // (`src/index.ts`) -- every subsequent `track()` call in this flow
      // carries it, alongside the instance's own always-present
      // `anonymousId`.
      userId: "user_bun_512",
    });
    expect(typeof productViewed!.body.anonymousId).toBe("string");
  });

  test('track("Checkout Started") reaches /v1/track with the computed cartTotal/itemCount, event name unchanged', async () => {
    const { requests } = await runBunRuntimeTrackingFlow();

    const trackRequests = requests.filter((r) => r.pathname === "/v1/track");
    const checkoutStarted = trackRequests.find((r) => r.body.event === "Checkout Started");

    expect(checkoutStarted).toBeDefined();
    expect(checkoutStarted!.body).toMatchObject({
      event: "Checkout Started",
      // 54.00 (qty 1) + 14.50 * 2 (qty 2) = 83.00, itemCount = 1 + 2 = 3 --
      // the exact same computation `index.test.ts` unit-tests in isolation,
      // now verified as what actually reaches the wire.
      properties: { cartTotal: 83.0, itemCount: 3 },
    });
  });

  test("requests arrive in call order: identify, then the two track() calls", async () => {
    const { requests } = await runBunRuntimeTrackingFlow();

    expect(requests.map((r) => r.pathname)).toEqual(["/v1/identify", "/v1/track", "/v1/track"]);
  });
});
